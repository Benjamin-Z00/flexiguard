// S3 核验引擎：纯函数 verify(task, evidences, options?)
// 按 docs/design-anchor.md §2 P0 默认规则实现
// 输入：任务 + 已采集证据 + 可选阈值；输出：核验结果（status / verified_minutes / reasons / checks）
// 纯函数：不读 DB、不写 DB、不依赖 Electron；可在 Node 脚本或主进程任意环境调用

import {
  DEFAULT_VERIFY_OPTIONS,
  type Evidence,
  type Task,
  type VerifyOptions,
  type VerifyResult,
} from './types';

// AFK event 中代表"离开键盘"的 status 值
// aw-watcher-afk 的 data.status 取值："afk"=离开键盘，"not-afk"=活跃
// 依据：ActivityWatch 官方文档 working-with-data 示例 filter_keyvals(afk_events, "status", ["not-afk"])
// 与 src/scripts/aw-verify.ts 中 AFK_AWAY_STATUS 保持一致
const AFK_AWAY_STATUS = 'afk';

// 安全读取 payload 中的数值字段（缺失/类型不符返回 undefined）
function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key];
  return typeof v === 'number' ? v : undefined;
}

// 安全读取 payload 中的字符串字段
function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

// 判断证据是否为产出性证据（P0：editor chars_added>0 或 git commits>0）
function isProductive(e: Evidence): boolean {
  if (e.source === 'editor' && e.event_kind === 'chars_added') {
    return (payloadNumber(e.payload, 'chars_added') ?? 0) > 0;
  }
  if (e.source === 'git' && e.event_kind === 'commits') {
    return (payloadNumber(e.payload, 'count') ?? 0) > 0;
  }
  return false;
}

// 核验主函数
// 步骤详见 docs/design-anchor.md §2 P0 判定规则
export function verify(
  task: Task,
  evidences: Evidence[],
  options: Partial<VerifyOptions> = {},
): VerifyResult {
  const opts: VerifyOptions = { ...DEFAULT_VERIFY_OPTIONS, ...options };
  const reasons: string[] = [];

  // 步骤 1：时间区间过滤
  // P0 简单规则：只取 ts_start 在 [planned_start, planned_end) 内的证据
  // 不做区间裁剪，留待真实数据调（design-anchor §3 已声明此条为可调项）
  const inRange = evidences.filter(
    (e) => e.ts_start >= task.planned_start && e.ts_start < task.planned_end,
  );

  // 步骤 2：活动时长累加
  // window/web 证据累加 duration_ms；afk 证据（status=afk）累加 duration_ms
  // 注：design-anchor §2 step2 表述为"扣减 afk 证据的 duration_ms"，
  // 但 aw-watcher-afk 的 event.data.status 有 afk/not-afk 两值（见 aw-verify.ts 注释），
  // 仅 status=afk 的时段才是真正离开，not-afk 时段已计入 window 活动不应再扣
  let windowTotalMs = 0;
  let afkAwayMs = 0;
  for (const e of inRange) {
    if (e.source !== 'activitywatch') {
      continue;
    }
    if (e.event_kind === 'window' || e.event_kind === 'web') {
      // duration_ms 为 -1 表示非时长类，不应出现在活动类证据里，跳过
      if (e.duration_ms > 0) {
        windowTotalMs += e.duration_ms;
      }
    } else if (e.event_kind === 'afk') {
      // 仅统计 status=afk（离开）的时长；not-afk 不扣
      if (e.duration_ms > 0 && payloadString(e.payload, 'status') === AFK_AWAY_STATUS) {
        afkAwayMs += e.duration_ms;
      }
    }
  }
  const activeMinutesRaw = (windowTotalMs - afkAwayMs) / 60000;
  const activeMinutes = activeMinutesRaw < 0 ? 0 : activeMinutesRaw;

  // 步骤 3：产出性证据命中
  const productiveHit = inRange.some(isProductive);

  // 步骤 4：判定
  // 边界：planned_minutes <= 0 → 直接 pending_makeup（避免除零）
  if (task.planned_minutes <= 0) {
    reasons.push('planned_minutes<=0，无法计算 active_ratio，直接判 pending_makeup');
    return {
      status: 'pending_makeup',
      verified_minutes: 0,
      reasons,
      checks: {
        active_minutes: activeMinutes,
        active_ratio: 0,
        productive_hit: productiveHit,
        threshold_ratio: opts.thresholdRatio,
        require_productive: opts.requireProductive,
      },
    };
  }

  const activeRatio = activeMinutes / task.planned_minutes;
  const cappedVerified = Math.min(activeMinutes, task.planned_minutes);

  // 通过条件：active_ratio >= thresholdRatio 且（不要求产出 或 已命中产出）
  const meetsActive = activeRatio >= opts.thresholdRatio;
  const meetsProductive = !opts.requireProductive || productiveHit;

  if (meetsActive && meetsProductive) {
    reasons.push(`active_ratio=${activeRatio.toFixed(3)} >= 阈值 ${opts.thresholdRatio}`);
    if (opts.requireProductive) {
      reasons.push('require_productive=true 且已命中产出性证据');
    } else {
      reasons.push('require_productive=false，跳过产出性证据检查');
    }
    return {
      status: 'done',
      verified_minutes: cappedVerified,
      reasons,
      checks: {
        active_minutes: activeMinutes,
        active_ratio: activeRatio,
        productive_hit: productiveHit,
        threshold_ratio: opts.thresholdRatio,
        require_productive: opts.requireProductive,
      },
    };
  }

  // 未通过：补 reasons
  if (!meetsActive) {
    reasons.push(`active_ratio=${activeRatio.toFixed(3)} < 阈值 ${opts.thresholdRatio}`);
  }
  if (!meetsProductive) {
    reasons.push('require_productive=true 但无 editor chars_added>0 或 git commits>0 的产出证据');
  }

  if (activeRatio >= opts.suspectRatio) {
    // 存疑：active_ratio 在 [suspectRatio, thresholdRatio) 之间
    // verified_minutes 存原值（capped），"低权重"留到 S4 daily_stats 聚合再加权
    return {
      status: 'suspect',
      verified_minutes: cappedVerified,
      reasons,
      checks: {
        active_minutes: activeMinutes,
        active_ratio: activeRatio,
        productive_hit: productiveHit,
        threshold_ratio: opts.thresholdRatio,
        require_productive: opts.requireProductive,
      },
    };
  }

  // 低于存疑阈值 → 待次日补
  reasons.push(`active_ratio=${activeRatio.toFixed(3)} < 存疑阈值 ${opts.suspectRatio}`);
  return {
    status: 'pending_makeup',
    verified_minutes: 0,
    reasons,
    checks: {
      active_minutes: activeMinutes,
      active_ratio: activeRatio,
      productive_hit: productiveHit,
      threshold_ratio: opts.thresholdRatio,
      require_productive: opts.requireProductive,
    },
  };
}
