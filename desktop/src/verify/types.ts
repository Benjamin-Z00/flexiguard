// S3 核验引擎类型定义
// 与 src/db/schema/001_init.sql 字段一一对齐，方便 S4/S5 从 DB 查询结果直接传入 verify()

// 任务状态（与 task.status 列枚举对齐）
// pending=未开始 / running=进行中 / done=核验通过 / suspect=核验存疑 / pending_makeup=待次日补
export type TaskStatus = 'pending' | 'running' | 'done' | 'suspect' | 'pending_makeup';

// 任务：与 task 表字段对齐
export interface Task {
  id: string;
  title: string;
  planned_start: number; // epoch ms
  planned_end: number; // epoch ms
  planned_minutes: number;
  category: string;
  status: TaskStatus;
  verified_minutes: number;
  created_at: number;
  updated_at: number;
}

// 证据：与 evidence 表字段对齐
// source 取值：activitywatch / editor / git / screenshot
// event_kind 取值：aw: window/afk/web；editor: chars_added/files_modified；git: commits；screenshot: count
// payload 为 JSON 文本解析后的对象，结构因 source/event_kind 而异
export interface Evidence {
  id: string;
  task_id: string;
  source: string;
  event_kind: string;
  ts_start: number; // epoch ms
  ts_end: number; // epoch ms
  duration_ms: number; // 活动类：持续毫秒；非时长类（如 commit 计数）用 -1
  payload: Record<string, unknown>;
  collected_at: number; // epoch ms
}

// 核验阈值与开关（P0 默认值见 DEFAULT_VERIFY_OPTIONS）
export interface VerifyOptions {
  // 通过阈值：active_ratio >= thresholdRatio 即视为时长达标
  thresholdRatio: number; // 默认 0.7
  // 存疑阈值：active_ratio 在 [suspectRatio, thresholdRatio) 之间 → status=suspect
  suspectRatio: number; // 默认 0.3
  // 是否要求至少 1 类产出性证据（editor chars_added>0 或 git commits>0）
  requireProductive: boolean; // 默认 true
}

// P0 默认阈值，依据 docs/design-anchor.md §2
export const DEFAULT_VERIFY_OPTIONS: VerifyOptions = {
  thresholdRatio: 0.7,
  suspectRatio: 0.3,
  requireProductive: true,
};

// 核验检查项明细，便于调参
export interface VerifyChecks {
  active_minutes: number; // 扣 AFK 后的活动时长（分钟）
  active_ratio: number; // active_minutes / planned_minutes
  productive_hit: boolean; // 是否至少 1 类产出性证据
  threshold_ratio: number; // 当前通过阈值
  require_productive: boolean; // 是否要求产出性证据
}

// 核验结果：按 docs/design-anchor.md §2 契约
export interface VerifyResult {
  status: 'done' | 'suspect' | 'pending_makeup';
  verified_minutes: number; // 核验通过的有效工时（分钟）
  reasons: string[]; // 判定依据，供日志/审计
  checks: VerifyChecks;
}
