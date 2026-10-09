// 按任务时间窗口采集 ActivityWatch 证据，转换为 Evidence 格式
// 流程：探活 → 发现 bucket → 并行取 window + afk events → 转 Evidence
// 关键转换：AW duration 是秒（浮点），Evidence.duration_ms 是毫秒（整数）→ Math.round(duration * 1000)

import crypto from 'crypto';
import type { AwEvent } from './client';
import { discoverBuckets, fetchEvents, pingServer } from './client';
import type { Evidence, Task } from '../verify/types';

// 单条 AW event → Evidence
// 注意：AW duration 单位是秒，Evidence.duration_ms 单位是毫秒 → 乘 1000 取整
function toEvidence(
  awEvent: AwEvent,
  taskId: string,
  kind: 'window' | 'afk',
): Evidence {
  const ts_start = Date.parse(awEvent.timestamp);
  const duration_ms = Math.round(awEvent.duration * 1000); // 秒 → 毫秒
  return {
    id: crypto.randomUUID(),
    task_id: taskId,
    source: 'activitywatch',
    event_kind: kind,
    ts_start,
    ts_end: ts_start + duration_ms,
    duration_ms,
    payload: awEvent.data, // window: {app, title}；afk: {status}
    collected_at: Date.now(),
  };
}

// 采集任务时间窗口内的 AW 证据
// 返回 window + afk 证据数组；AW 不可达时抛异常（由调用方捕获）
export async function collectEvidence(task: Task): Promise<Evidence[]> {
  await pingServer();
  const buckets = await discoverBuckets();
  // 并行取 window + afk events
  const [windowEvents, afkEvents] = await Promise.all([
    fetchEvents(buckets.window.id, task.planned_start, task.planned_end),
    fetchEvents(buckets.afk.id, task.planned_start, task.planned_end),
  ]);
  const windowEvidences = windowEvents.map((e) => toEvidence(e, task.id, 'window'));
  const afkEvidences = afkEvents.map((e) => toEvidence(e, task.id, 'afk'));
  return [...windowEvidences, ...afkEvidences];
}
