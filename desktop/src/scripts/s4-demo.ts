// S4 CRUD + 累计演示脚本
// 不依赖 Electron，用 dev-flex-work.db 测试仓库层 + 核验编排
// 运行：npm run build && npm run s4-demo

import { getDb } from '../db/database';
import { runMigrations } from '../db/migrate';
import {
  DailyStatsRepository,
  EvidenceRepository,
  TaskRepository,
  toDateStr,
} from '../db/repositories';
import { VerifyService } from '../services/verify-service';

// 把任意错误规整成可读字符串
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function main(): Promise<void> {
  const db = getDb();
  runMigrations(db);
  // 清空旧数据（demo 脚本可重复跑）
  db.exec('DELETE FROM evidence; DELETE FROM task; DELETE FROM daily_stats;');

  const taskRepo = new TaskRepository(db);
  const evidenceRepo = new EvidenceRepository(db);
  const dailyStatsRepo = new DailyStatsRepository(db);
  const verifyService = new VerifyService(taskRepo, evidenceRepo, dailyStatsRepo);

  const today = toDateStr(Date.now());
  console.log(`今日日期：${today}\n`);

  // ====== 1. CRUD 测试 ======
  console.log('===== 1. CRUD 测试 =====');

  // 创建
  const task1 = taskRepo.create({
    title: '写需求文档',
    planned_start: Date.now(),
    planned_end: Date.now() + 2 * 60 * 60 * 1000,
    planned_minutes: 120,
    category: 'writing',
  });
  console.log(`创建任务: id=${task1.id}, title="${task1.title}"`);

  // 查询
  const list = taskRepo.listByDate(today);
  console.log(`按日期查询: ${list.length} 条任务`);

  // 更新
  taskRepo.update(task1.id, { title: '写需求文档(已改)', verified_minutes: 90, status: 'done' });
  const updated = taskRepo.getById(task1.id)!;
  console.log(`更新后: title="${updated.title}", status=${updated.status}, verified=${updated.verified_minutes}`);

  // 删除 + CASCADE 验证
  const task2 = taskRepo.create({
    title: '待删除任务',
    planned_start: Date.now(),
    planned_end: Date.now() + 60 * 60 * 1000,
    planned_minutes: 60,
  });
  evidenceRepo.insertMany([{
    id: 'ev-test-1',
    task_id: task2.id,
    source: 'activitywatch',
    event_kind: 'window',
    ts_start: Date.now(),
    ts_end: Date.now() + 60000,
    duration_ms: 60000,
    payload: { app: 'test', title: 'test' },
    collected_at: Date.now(),
  }]);
  console.log(`插入证据: evidence list 长度=${evidenceRepo.listByTask(task2.id).length}`);
  taskRepo.delete(task2.id);
  console.log(`删除 task2 后: evidence list 长度=${evidenceRepo.listByTask(task2.id).length} (CASCADE 应为 0)`);

  // ====== 2. 累计测试 ======
  console.log('\n===== 2. 8h 累计测试 =====');

  // 已有 task1: done, verified=90
  // 再加一条 done verified=200 → 合计 290 < 480 → 未达标
  taskRepo.create({
    title: '写代码',
    planned_start: Date.now(),
    planned_end: Date.now() + 3 * 60 * 60 * 1000,
    planned_minutes: 180,
  });
  const task3 = taskRepo.getById(
    taskRepo.listByDate(today).find((t) => t.title === '写代码')!.id,
  )!;
  taskRepo.update(task3.id, { status: 'done', verified_minutes: 200 });

  let stats = dailyStatsRepo.recompute(today);
  console.log(`两条 done (90+200=290): verified=${stats.verified_minutes}, met=${stats.met}, carried_over=${stats.carried_over}`);

  // 加一条 pending_makeup → 不计入，verified 不变
  const task4 = taskRepo.create({
    title: '摸鱼任务',
    planned_start: Date.now(),
    planned_end: Date.now() + 30 * 60 * 1000,
    planned_minutes: 30,
  });
  taskRepo.update(task4.id, { status: 'pending_makeup', verified_minutes: 0 });
  stats = dailyStatsRepo.recompute(today);
  console.log(`加 pending_makeup (verified=0): verified=${stats.verified_minutes} (不变), met=${stats.met}, carried_over=${stats.carried_over}`);

  // 加一条 done verified=200 → 合计 490 >= 480 → 达标
  const task5 = taskRepo.create({
    title: '写测试',
    planned_start: Date.now(),
    planned_end: Date.now() + 2 * 60 * 60 * 1000,
    planned_minutes: 120,
  });
  taskRepo.update(task5.id, { status: 'done', verified_minutes: 200 });
  stats = dailyStatsRepo.recompute(today);
  console.log(`再加 done (verified=200): verified=${stats.verified_minutes} (490), met=${stats.met} (应=1), carried_over=${stats.carried_over} (应=0)`);

  // ====== 3. AW 集成测试（可选）======
  console.log('\n===== 3. AW 核验测试 =====');
  const awTask = taskRepo.create({
    title: 'AW 核验测试',
    planned_start: Date.now() - 60 * 60 * 1000, // 1h 前
    planned_end: Date.now(), // 现在
    planned_minutes: 60,
  });
  try {
    const result = await verifyService.verifyTask(awTask.id);
    console.log(`核验成功: status=${result.result.status}, verified=${Math.round(result.result.verified_minutes)}分, 证据${result.evidenceCount}条`);
    console.log(`  active_ratio=${result.result.checks.active_ratio.toFixed(3)}, productive_hit=${result.result.checks.productive_hit}`);
    stats = dailyStatsRepo.recompute(today);
    console.log(`核验后当日累计: verified=${stats.verified_minutes}, met=${stats.met}`);
  } catch (e) {
    console.log(`核验跳过（AW 不可达）: ${errMsg(e)}`);
  }

  console.log('\n===== 完成 =====');
}

// 直接运行入口
if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('运行失败:', errMsg(e));
    process.exitCode = 1;
  });
}
