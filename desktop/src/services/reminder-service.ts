// S5 到点提醒 + 次日欠债提醒
// 主进程定时器：每 30s 扫描今日到点未核验任务 → 发系统通知
// 启动时一次性：查昨日 daily_stats，未达标则提醒补 carried_over 分钟
// 点击通知聚焦主窗口。已提醒 taskId 用内存 Set 去重（P0 不持久化）

import { BrowserWindow, Notification } from 'electron';
import { DailyStatsRepository, TaskRepository, toDateStr } from '../db/repositories';

// 扫描间隔：30 秒（P0 够用，到点后 30s 内必通知）
const SCAN_INTERVAL_MS = 30 * 1000;
// 一天的毫秒数，用于算昨日日期串
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class ReminderService {
  // 已发到点提醒的 taskId 集合（防重复通知；重启清空可接受）
  private notifiedTaskIds = new Set<string>();
  // 持有 Notification 对象引用，防 GC 导致通知不显示
  private activeNotifications = new Set<Notification>();
  private timer: NodeJS.Timeout | null = null;
  // 次日欠债提醒是否已跑（启动时一次性）
  private yesterdayDebtChecked = false;

  constructor(
    private taskRepo: TaskRepository,
    private dailyStatsRepo: DailyStatsRepository,
    private getWindow: () => BrowserWindow | null,
  ) {}

  // 启动：立即查昨日欠债 + 开 30s 定时扫描
  start(): void {
    this.checkYesterdayDebt();
    this.scanDueTasks();
    this.timer = setInterval(() => {
      this.scanDueTasks();
    }, SCAN_INTERVAL_MS);
  }

  // 停止：清 interval（窗口全关时调）
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 到点提醒：扫今日 pending/running 任务，到点未核验 → 通知
  private scanDueTasks(): void {
    const today = toDateStr(Date.now());
    const tasks = this.taskRepo.listByDate(today);
    const now = Date.now();
    const due = tasks.filter(
      (t) => (t.status === 'pending' || t.status === 'running') && now >= t.planned_end,
    );
    for (const t of due) {
      if (this.notifiedTaskIds.has(t.id)) continue;
      this.notifiedTaskIds.add(t.id);
      const notif = new Notification({
        title: 'FlexiGuard 到点提醒',
        body: `任务"${t.title}"已到点，请打卡核验`,
        silent: false,
      });
      notif.on('click', () => {
        const win = this.getWindow();
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      });
      // 持有引用防 GC；通知关闭后释放
      this.activeNotifications.add(notif);
      notif.once('close', () => this.activeNotifications.delete(notif));
      notif.show();
    }
  }

  // 次日提醒补：查昨日 daily_stats，met=0 且有欠债 → 通知
  private checkYesterdayDebt(): void {
    if (this.yesterdayDebtChecked) return;
    this.yesterdayDebtChecked = true;

    const yesterday = toDateStr(Date.now() - ONE_DAY_MS);
    const stats = this.dailyStatsRepo.get(yesterday);
    // 无记录或已达标或无欠债 → 不提醒
    if (!stats || stats.met === 1 || stats.carried_over <= 0) return;

    const notif = new Notification({
      title: 'FlexiGuard 昨日欠债提醒',
      body: `昨日未达标 ${stats.carried_over} 分钟，今日请补`,
      silent: false,
    });
    notif.on('click', () => {
      const win = this.getWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    notif.show();
  }
}
