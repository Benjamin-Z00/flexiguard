-- 任务表
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  planned_start INTEGER NOT NULL,
  planned_end INTEGER NOT NULL,
  planned_minutes INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'pending',
  verified_minutes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 证据表（一条核验可产生多条证据）
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  ts_start INTEGER NOT NULL,
  ts_end INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  payload TEXT,
  collected_at INTEGER NOT NULL
);

-- 当日累计统计表
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  target_minutes INTEGER NOT NULL DEFAULT 480,
  verified_minutes INTEGER NOT NULL DEFAULT 0,
  met INTEGER NOT NULL DEFAULT 0,
  carried_over INTEGER NOT NULL DEFAULT 0
);

-- 证据表索引：按任务+起始时间、按来源+起始时间
CREATE INDEX IF NOT EXISTS idx_evidence_task_ts ON evidence(task_id, ts_start);
CREATE INDEX IF NOT EXISTS idx_evidence_source_ts ON evidence(source, ts_start);
