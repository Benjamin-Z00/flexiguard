// S3 核验引擎演示脚本
// 构造 4 个场景的样本 task + evidences，调用 verify() 打印结果
// 不依赖 DB 和 Electron，纯 Node 运行
// 运行：先 npm run build，再 npm run verify-demo

import { verify } from '../verify/engine';
import type { Evidence, Task } from '../verify/types';

// ====== 测试数据构造辅助 ======

// 构造一个标准任务：planned_minutes=120，planned_start 为 1 小时前
function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  const planned_start = now - 60 * 60 * 1000; // 1h 前
  const planned_end = planned_start + 120 * 60 * 1000; // +2h
  return {
    id: 'task-demo',
    title: 'Demo Task',
    planned_start,
    planned_end,
    planned_minutes: 120,
    category: 'writing',
    status: 'pending',
    verified_minutes: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// 构造 window 活动证据（duration_ms 持续毫秒）
function windowEvidence(
  taskId: string,
  ts_start: number,
  durationMs: number,
  app = 'TRAE SOLO CN.exe',
  title = 'TraeWork CN',
): Evidence {
  return {
    id: `win-${ts_start}`,
    task_id: taskId,
    source: 'activitywatch',
    event_kind: 'window',
    ts_start,
    ts_end: ts_start + durationMs,
    duration_ms: durationMs,
    payload: { app, title },
    collected_at: ts_start,
  };
}

// 构造 afk 证据（status 决定是离开还是活跃）
function afkEvidence(
  taskId: string,
  ts_start: number,
  durationMs: number,
  status: 'afk' | 'not-afk',
): Evidence {
  return {
    id: `afk-${ts_start}`,
    task_id: taskId,
    source: 'activitywatch',
    event_kind: 'afk',
    ts_start,
    ts_end: ts_start + durationMs,
    duration_ms: durationMs,
    payload: { status },
    collected_at: ts_start,
  };
}

// 构造 editor 产出证据（chars_added=N）
function editorEvidence(taskId: string, ts_start: number, charsAdded: number): Evidence {
  return {
    id: `ed-${ts_start}`,
    task_id: taskId,
    source: 'editor',
    event_kind: 'chars_added',
    ts_start,
    ts_end: ts_start,
    duration_ms: -1, // 非时长类
    payload: { chars_added: charsAdded, files_modified: 1 },
    collected_at: ts_start,
  };
}

// 构造 git 产出证据（commits=N）
function gitEvidence(taskId: string, ts_start: number, count: number): Evidence {
  return {
    id: `git-${ts_start}`,
    task_id: taskId,
    source: 'git',
    event_kind: 'commits',
    ts_start,
    ts_end: ts_start,
    duration_ms: -1,
    payload: { count, hashes: ['abc123'] },
    collected_at: ts_start,
  };
}

// 打印核验结果
function printResult(label: string, task: Task, result: ReturnType<typeof verify>): void {
  console.log(`\n===== ${label} =====`);
  console.log(`Task: ${task.title} | planned_minutes=${task.planned_minutes}`);
  console.log(`  active_minutes=${result.checks.active_minutes.toFixed(2)}`);
  console.log(
    `  active_ratio=${result.checks.active_ratio.toFixed(3)} (threshold=${result.checks.threshold_ratio})`,
  );
  console.log(
    `  productive_hit=${result.checks.productive_hit} (require_productive=${result.checks.require_productive})`,
  );
  console.log(`  status=${result.status}`);
  console.log(`  verified_minutes=${result.verified_minutes.toFixed(2)}`);
  console.log(`  reasons:`);
  for (const r of result.reasons) {
    console.log(`    - ${r}`);
  }
}

// ====== 主流程 ======

export function main(): void {
  // 场景 A：高活动 + editor 产出 → 期望 done
  // planned=120min，window=100min，afk=10min → active=90min，ratio=0.75 >= 0.7
  {
    const task = makeTask({ id: 'task-a', title: 'A 高活动+产出' });
    const ts = task.planned_start + 60 * 1000;
    const evidences: Evidence[] = [
      windowEvidence(task.id, ts, 100 * 60 * 1000),
      afkEvidence(task.id, ts, 10 * 60 * 1000, 'afk'),
      editorEvidence(task.id, ts + 50 * 60 * 1000, 500),
    ];
    const result = verify(task, evidences);
    printResult('场景 A：高活动+产出 → 期望 done', task, result);
  }

  // 场景 B：中等活动 + 产出 → 期望 suspect
  // planned=120min，window=60min，afk=10min → active=50min，ratio≈0.417 ∈ [0.3, 0.7)
  {
    const task = makeTask({ id: 'task-b', title: 'B 中等活动+产出' });
    const ts = task.planned_start + 60 * 1000;
    const evidences: Evidence[] = [
      windowEvidence(task.id, ts, 60 * 60 * 1000),
      afkEvidence(task.id, ts, 10 * 60 * 1000, 'afk'),
      gitEvidence(task.id, ts + 30 * 60 * 1000, 2),
    ];
    const result = verify(task, evidences);
    printResult('场景 B：中等活动+产出 → 期望 suspect', task, result);
  }

  // 场景 C：低活动 → 期望 pending_makeup
  // planned=120min，window=20min，afk=5min → active=15min，ratio=0.125 < 0.3
  {
    const task = makeTask({ id: 'task-c', title: 'C 低活动' });
    const ts = task.planned_start + 60 * 1000;
    const evidences: Evidence[] = [
      windowEvidence(task.id, ts, 20 * 60 * 1000),
      afkEvidence(task.id, ts, 5 * 60 * 1000, 'afk'),
      editorEvidence(task.id, ts + 10 * 60 * 1000, 100),
    ];
    const result = verify(task, evidences);
    printResult('场景 C：低活动 → 期望 pending_makeup', task, result);
  }

  // 场景 D：高活动但无 editor/git 产出 → 期望 suspect（require_productive=true 失败）
  // planned=120min，window=100min，afk=10min → active=90min，ratio=0.75 >= 0.7 但无产出
  {
    const task = makeTask({ id: 'task-d', title: 'D 高活动无产出' });
    const ts = task.planned_start + 60 * 1000;
    const evidences: Evidence[] = [
      windowEvidence(task.id, ts, 100 * 60 * 1000),
      afkEvidence(task.id, ts, 10 * 60 * 1000, 'afk'),
      // 故意不放 editor/git 证据
    ];
    const result = verify(task, evidences);
    printResult('场景 D：高活动无产出 → 期望 suspect', task, result);
  }

  console.log('\n===== 完成 =====');
}

// 直接运行入口：node dist/scripts/verify-demo.js
if (require.main === module) {
  try {
    main();
  } catch (e: unknown) {
    console.error('运行失败：', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
