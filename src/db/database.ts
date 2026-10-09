import Database from 'better-sqlite3';
import path from 'path';

// 数据库单例
let dbInstance: Database.Database | null = null;

// 解析数据库文件路径：Electron 环境用 userData 目录，非 Electron 环境回退到本地开发文件
function resolveDbPath(): string {
  try {
    // 动态 require，避免非 Electron 环境下静态导入失败
    const electron = require('electron') as { app?: { getPath: (name: string) => string } };
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'flex-work.db');
    }
  } catch {
    // electron 模块不可用，说明在普通 Node 脚本中运行
  }
  // 非 Electron 环境（脚本测试）回退到当前工作目录
  return path.join(process.cwd(), 'dev-flex-work.db');
}

// 获取数据库单例：首次调用时初始化并开启 PRAGMA
export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }
  const dbPath = resolveDbPath();
  dbInstance = new Database(dbPath);
  // 开启 WAL 模式，提升读并发性能
  dbInstance.pragma('journal_mode = WAL');
  // 开启外键约束，使 ON DELETE CASCADE 等生效
  dbInstance.pragma('foreign_keys = ON');
  return dbInstance;
}
