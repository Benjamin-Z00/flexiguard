// 核验编排服务：取任务 → 采集 AW 证据 → 存库 → 调 verify() → 回写 → 重算当日累计
// 串联 S3 核验引擎 + S4 数据仓库 + AW 采集，完成端到端核验

import { collectEvidence } from '../aw/collect';
import {
  DailyStatsRepository,
  EvidenceRepository,
  TaskRepository,
  toDateStr,
} from '../db/repositories';
import { verify } from '../verify/engine';
import { DEFAULT_VERIFY_OPTIONS } from '../verify/types';
import type { Task, VerifyResult } from '../verify/types';

// 核验编排返回值
export interface VerifyServiceResult {
  task: Task; // 更新后的任务
  result: VerifyResult; // 核验引擎返回值
  evidenceCount: number; // 存入的证据条数
}

export class VerifyService {
  constructor(
    private taskRepo: TaskRepository,
    private evidenceRepo: EvidenceRepository,
    private dailyStatsRepo: DailyStatsRepository,
  ) {}

  // 核验单个任务
  async verifyTask(taskId: string): Promise<VerifyServiceResult> {
    // 1. 取任务
    const task = this.taskRepo.getById(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    // 2. 清理旧证据（重新核验应替换，不累加，防 active_ratio 翻倍）
    this.evidenceRepo.deleteByTask(taskId);

    // 3. 采集 AW 证据（AW 不可达时抛异常，由 IPC 层捕获）
    const newEvidences = await collectEvidence(task);

    // 4. 存入 evidence 表
    if (newEvidences.length > 0) {
      this.evidenceRepo.insertMany(newEvidences);
    }

    // 5. 从 DB 加载全部证据（确认写入一致）
    const allEvidences = this.evidenceRepo.listByTask(taskId);

    // 6. 调用纯函数 verify()
    const result = verify(task, allEvidences, DEFAULT_VERIFY_OPTIONS);

    // 7. 回写 task.status + task.verified_minutes
    this.taskRepo.update(taskId, {
      status: result.status,
      verified_minutes: Math.round(result.verified_minutes),
    });

    // 8. 重算当日 daily_stats
    const dateStr = toDateStr(task.planned_start);
    this.dailyStatsRepo.recompute(dateStr);

    // 9. 返回结果（带更新后的 task）
    const updatedTask = this.taskRepo.getById(taskId)!;
    return { task: updatedTask, result, evidenceCount: allEvidences.length };
  }
}
