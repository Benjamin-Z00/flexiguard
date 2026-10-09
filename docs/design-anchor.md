# P0 最小设计锚点

> 目的：只定死"会返工的两件事"，其余阈值/规则先占位默认值，跑通后用真实数据调。
> 锁定项：① 任务与证据数据结构；② 核验接口契约。
> 不锁定项：核验阈值、规则严格度、提醒文案、UI 布局、同步协议细节。

---

## 1. 数据结构（本地 SQLite，字段稳定后不再大改）

### task 任务
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | 任务标题 |
| planned_start | INTEGER | 计划开始（epoch ms） |
| planned_end | INTEGER | 计划结束（epoch ms） |
| planned_minutes | INTEGER | 预估时长（分钟），= end-start 折算 |
| category | TEXT | 任务类别（writing/code/admin/...），用于证据类型匹配，先占位 |
| status | TEXT | pending / running / done / suspect / pending_makeup |
| verified_minutes | INTEGER | 核验通过的有效工时（分钟），核验后回写 |
| created_at | INTEGER | 创建时间 |
| updated_at | INTEGER | 更新时间 |

> status 的 suspect=核验存疑、pending_makeup=待次日补，是后续"累计达标+次日提醒补"的承接点。

### evidence 证据（一条核验可产生多条证据）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| task_id | TEXT FK | 关联任务 |
| source | TEXT | activitywatch / editor / git / screenshot |
| event_kind | TEXT | aw: window/afk/web；editor: chars_added/files_modified；git: commits；screenshot: count |
| ts_start | INTEGER | 证据起始（epoch ms） |
| ts_end | INTEGER | 证据结束（epoch ms） |
| duration_ms | INTEGER | 持续毫秒（活动类）；-1 表示非时长类（如 commit 计数） |
| payload | TEXT(JSON) | 原始字段快照（app、title、chars、commit_hash 等），用于审计 |
| collected_at | INTEGER | 采集时间 |

> 索引：(task_id, ts_start)、(source, ts_start)。

### daily_stats 当日累计
| 字段 | 类型 | 说明 |
|---|---|---|
| date | TEXT PK | YYYY-MM-DD（本地时区） |
| target_minutes | INTEGER | 默认 480（8h） |
| verified_minutes | INTEGER | 当日所有任务核验通过工时累计 |
| met | INTEGER | 0/1，是否达标 |
| carried_over | INTEGER | 昨日未达标需补的分钟数（次日提醒用） |

---

## 2. 核验接口契约（输入证据，输出判定）

```
verify(task, evidences) -> {
  status: "done" | "suspect" | "pending_makeup",
  verified_minutes: int,          // 核验通过的有效工时
  reasons: [str],                 // 判定依据，供日志/审计
  checks: {                        // 各检查项明细，便于调参
    active_minutes: int,          // 扣除AFK后的活动时长
    active_ratio: float,          // active_minutes / planned_minutes
    productive_hit: bool,         // 是否至少1类产出性证据
    threshold_ratio: float,       // 当前阈值（先占位0.7，可调）
    require_productive: bool      // 是否要求产出性证据（先true）
  }
}
```

### P0 判定规则（中等严格，先占位默认值，后调）
1. 取该任务 [planned_start, planned_end] 内的所有 evidence。
2. 活动类证据（source=activitywatch，event_kind=window/web）：累加 duration_ms，**扣减 afk 证据的 duration_ms** → 得 active_minutes。
3. 判定（P0 默认阈值，写入配置可调）：
   - `active_ratio = active_minutes / planned_minutes`
   - 通过条件：`active_ratio >= 0.7` **且** `productive_hit == true`（产出性证据：editor chars_added>0 或 git commits>0）
   - 通过 → status=done，verified_minutes=active_minutes（封顶 planned_minutes）
   - 不通过但 active_ratio >= 0.3 → status=suspect（标记存疑，计入但低权重）
   - active_ratio < 0.3 → status=pending_makeup（待次日补）
4. 产出性证据要求 `require_productive=true` 是为了防"只挂机不产出"。P0 先开，后续可关。

### 与 8h 累计的衔接
- 任务核验为 done/suspect 的 verified_minutes 计入当日 daily_stats.verified_minutes。
- pending_makeup 不计入当日，转入次日 carried_over。
- 当 verified_minutes >= target_minutes → met=1；否则次日提醒补 carried_over 分钟。

---

## 3. 不在锚点内（先占位，跑通后调）
- 核验阈值 0.7 / 0.3、require_productive 开关 → 配置项，先默认值。
- category→证据类型映射表 → 先空表，P0 用通用规则。
- ActivityWatch API 查询的具体 query 写法 → 写代码时对着真实 events 调。
- 提醒文案、UI、同步协议 → P0 各自先占位。
