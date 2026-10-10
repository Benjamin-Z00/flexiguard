import { app, BrowserWindow } from 'electron';
import path from 'path';
import { getDb } from '../db/database';
import { runMigrations } from '../db/migrate';
import { registerIpcHandlers } from './ipc';
import { DailyStatsRepository, TaskRepository } from '../db/repositories';
import { ReminderService } from '../services/reminder-service';

// 初始化数据库 + 迁移 + IPC（主进程模块加载时执行）
const db = getDb();
runMigrations(db);
registerIpcHandlers();

// 创建主窗口（900x700），加载极简 UI
function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      // preload 编译后在 dist/preload/preload.js（__dirname = dist/main）
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // renderer 目录在 src/ 外（tsc 不编译原生 HTML/JS）
  void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
}

// 提醒服务实例（whenReady 后初始化，window-all-closed 时 stop）
let reminder: ReminderService | null = null;

// 应用就绪后创建主窗口 + 启动到点提醒
app.whenReady().then(() => {
  // Windows 必须 setAppUserModelId，否则系统通知静默不弹
  app.setAppUserModelId('com.flexiguard.desktop');
  createWindow();
  reminder = new ReminderService(
    new TaskRepository(db),
    new DailyStatsRepository(db),
    () => BrowserWindow.getAllWindows()[0] ?? null,
  );
  reminder.start();
});

// 全部窗口关闭时停止提醒并退出（macOS 除外，符合平台习惯）
app.on('window-all-closed', () => {
  reminder?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
