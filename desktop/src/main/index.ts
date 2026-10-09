import { app, BrowserWindow } from 'electron';
import path from 'path';
import { getDb } from '../db/database';
import { runMigrations } from '../db/migrate';
import { registerIpcHandlers } from './ipc';

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

// 应用就绪后创建主窗口
app.whenReady().then(() => {
  createWindow();
});

// 全部窗口关闭时退出（macOS 除外，符合平台习惯）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
