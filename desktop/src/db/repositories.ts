// S4 数据仓库层：Task / Evidence / DailyStats 三个仓库
// 使用 better-sqlite3 预编译语句 + 参数绑定，复用 getDb() 单例
// 与 src/db/schema/001_init.sql 字段一一对齐

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { Evidence, Task, TaskStatus } from '../verify/types';

// ====== 日期辅助（本地时区，daily_stats.date = YYYY-MM-DD）======

// 把 epoch ms 转成本地时区 YYYY-MM-DD
export function toDateStr(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 计算本地时区某日的 [00:00:00.000, 23:59:59.999] epoch ms
function dayBoundaries(date: string): { start: number; end: number } {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return { start, end };
}

// ====== 输入/输出类型 ======

// 创建任务时的输入
export interface TaskInput {
  title: string;
  planned_start: number; // epoch ms
  planned_end: number; // epoch ms
  planned_minutes: number;
  category?: string;
}

// 更新任务时的部分字段（id/created_at 不可改，updated_at 自动更新）
export interface TaskUpdate {
  title?: string;
  planned_start?: number;
  planned_end?: number;
  planned_minutes?: number;
  category?: string;
  status?: TaskStatus;
  verified_minutes?: number;
}

// daily_stats 行
export interface DailyStatsRow {
  date: string;
  target_minutes: number;
  verified_minutes: number;
  met: number;
  carried_over: number;
}

// ====== 行映射辅助 ======

// 把 DB 行映射为 Task（字段名一致，直接断言）
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    planned_start: row.planned_start as number,
    planned_end: row.planned_end as number,
    planned_minutes: row.planned_minutes as number,
    category: row.category as string,
    status: row.status as TaskStatus,
    verified_minutes: row.verified_minutes as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

// 把 DB 行映射为 Evidence（payload 需 JSON.parse）
function rowToEvidence(row: Record<string, unknown>): Evidence {
  let payload: Record<string, unknown> = {};
  const raw = row.payload;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    source: row.source as string,
    event_kind: row.event_kind as string,
    ts_start: row.ts_start as number,
    ts_end: row.ts_end as number,
    duration_ms: row.duration_ms as number,
    payload,
    collected_at: row.collected_at as number,
  };
}

// ====== TaskRepository ======

export class TaskRepository {
  constructor(private db: Database.Database) {}

  // 创建任务：id=UUID，status 默认 pending，verified_minutes=0
  create(input: TaskInput): Task {
    const now = Date.now();
    const id = crypto.randomUUID();
    const category = input.category ?? 'general';
    this.db
      .prepare(
        `INSERT INTO task (id, title, planned_start, planned_end, planned_minutes, category, status, verified_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, input.title, input.planned_start, input.planned_end, input.planned_minutes, category, now, now);
    return this.getById(id)!;
  }

  // 按日期列出任务（planned_start 落在当天本地时区范围内）
  listByDate(date: string): Task[] {
    const { start, end } = dayBoundaries(date);
    const rows = this.db
      .prepare(`SELECT * FROM task WHERE planned_start >= ? AND planned_start <= ? ORDER BY planned_start`)
      .all(start, end) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  // 按 id 取单个任务
  getById(id: string): Task | undefined {
    const row = this.db.prepare(`SELECT * FROM task WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToTask(row) : undefined;
  }

  // 部分更新：动态拼 SET，updated_at 始终刷新
  update(id: string, fields: TaskUpdate): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
    if (fields.planned_start !== undefined) { sets.push('planned_start = ?'); values.push(fields.planned_start); }
    if (fields.planned_end !== undefined) { sets.push('planned_end = ?'); values.push(fields.planned_end); }
    if (fields.planned_minutes !== undefined) { sets.push('planned_minutes = ?'); values.push(fields.planned_minutes); }
    if (fields.category !== undefined) { sets.push('category = ?'); values.push(fields.category); }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.verified_minutes !== undefined) { sets.push('verified_minutes = ?'); values.push(fields.verified_minutes); }
    if (sets.length === 0) { return false; }
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    const result = this.db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  // 删除任务（CASCADE 自动删 evidence）
  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM task WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}

// ====== EvidenceRepository ======

export class EvidenceRepository {
  constructor(private db: Database.Database) {}

  // 批量插入证据（事务），payload 用 JSON.stringify
  insertMany(evidences: Evidence[]): void {
    if (evidences.length === 0) { return; }
    const stmt = this.db.prepare(
      `INSERT INTO evidence (id, task_id, source, event_kind, ts_start, ts_end, duration_ms, payload, collected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAll = this.db.transaction((items: Evidence[]) => {
      for (const e of items) {
        stmt.run(e.id, e.task_id, e.source, e.event_kind, e.ts_start, e.ts_end, e.duration_ms, JSON.stringify(e.payload), e.collected_at);
      }
    });
    insertAll(evidences);
  }

  // 按任务列出证据（payload JSON.parse 还原）
  listByTask(taskId: string): Evidence[] {
    const rows = this.db
      .prepare(`SELECT * FROM evidence WHERE task_id = ? ORDER BY ts_start`)
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToEvidence);
  }

  // 删除某任务的全部证据（重新核验前清理，防 active_ratio 翻倍）
  deleteByTask(taskId: string): boolean {
    const result = this.db.prepare(`DELETE FROM evidence WHERE task_id = ?`).run(taskId);
    return result.changes > 0;
  }
}

// ====== DailyStatsRepository ======

// P0 默认目标工时 480 分钟（8h）
const DEFAULT_TARGET_MINUTES = 480;

export class DailyStatsRepository {
  constructor(private db: Database.Database) {}

  // 取某日统计行
  get(date: string): DailyStatsRow | undefined {
    const row = this.db.prepare(`SELECT * FROM daily_stats WHERE date = ?`).get(date) as DailyStatsRow | undefined;
    return row;
  }

  // 重算当日累计：sum(verified_minutes) where status in (done, suspect)
  // met = verified >= target ? 1 : 0；carried_over = met ? 0 : (target - verified)
  recompute(date: string): DailyStatsRow {
    const { start, end } = dayBoundaries(date);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(verified_minutes), 0) AS total
         FROM task
         WHERE status IN ('done', 'suspect')
           AND planned_start >= ? AND planned_start <= ?`,
      )
      .get(start, end) as { total: number };

    const verifiedMinutes = row.total ?? 0;
    const met = verifiedMinutes >= DEFAULT_TARGET_MINUTES ? 1 : 0;
    const carriedOver = met ? 0 : DEFAULT_TARGET_MINUTES - verifiedMinutes;

    this.db
      .prepare(
        `INSERT INTO daily_stats (date, target_minutes, verified_minutes, met, carried_over)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           target_minutes = excluded.target_minutes,
           verified_minutes = excluded.verified_minutes,
           met = excluded.met,
           carried_over = excluded.carried_over`,
      )
      .run(date, DEFAULT_TARGET_MINUTES, verifiedMinutes, met, carriedOver);

    return {
      date,
      target_minutes: DEFAULT_TARGET_MINUTES,
      verified_minutes: verifiedMinutes,
      met,
      carried_over: carriedOver,
    };
  }
}
