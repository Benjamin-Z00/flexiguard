// IPC 处理器注册：主进程接收渲染进程的 invoke 调用
// 所有通道用 ipcMain.handle（异步，返回 Promise）

import { ipcMain } from 'electron';
import { getDb } from '../db/database';
import {
  DailyStatsRepository,
  EvidenceRepository,
  TaskRepository,
  type TaskInput,
  type TaskUpdate,
} from '../db/repositories';
import { VerifyService } from '../services/verify-service';

// 注册全部 IPC 处理器
export function registerIpcHandlers(): void {
  const db = getDb();
  const taskRepo = new TaskRepository(db);
  const evidenceRepo = new EvidenceRepository(db);
  const dailyStatsRepo = new DailyStatsRepository(db);
  const verifyService = new VerifyService(taskRepo, evidenceRepo, dailyStatsRepo);

  // 任务 CRUD
  ipcMain.handle('task:list-by-date', (_, date: string) => taskRepo.listByDate(date));
  ipcMain.handle('task:create', (_, input: TaskInput) => taskRepo.create(input));
  ipcMain.handle('task:update', (_, id: string, fields: TaskUpdate) => taskRepo.update(id, fields));
  ipcMain.handle('task:delete', (_, id: string) => taskRepo.delete(id));

  // 核验
  ipcMain.handle('verify:task', async (_, taskId: string) => {
    try {
      return await verifyService.verifyTask(taskId);
    } catch (e) {
      // 返回结构化错误，不抛到渲染进程
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // 日统计
  ipcMain.handle('daily-stats:get', (_, date: string) => dailyStatsRepo.get(date));

  // 证据
  ipcMain.handle('evidence:list-by-task', (_, taskId: string) => evidenceRepo.listByTask(taskId));
}
