import { app, BrowserWindow } from 'electron';

// P0 占位页面：仅用于启动一个可见窗口，后续步骤替换为真实 UI
const PLACEHOLDER_URL = 'data:text/html,<h1>S1 OK</h1>';

// 创建主窗口（800x600），加载占位页面
function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
  });
  void win.loadURL(PLACEHOLDER_URL);
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
