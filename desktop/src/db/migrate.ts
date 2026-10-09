import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// schema 脚本位于源码目录（tsc 不会拷贝 .sql 资源到 dist，故指向 src）
const SCHEMA_DIR = path.join(__dirname, '..', '..', 'src', 'db', 'schema');

// 执行数据库迁移：P0 仅顺序执行 001_init.sql
// 用 CREATE TABLE IF NOT EXISTS 幂等处理，P0 暂不做迁移版本表与文件遍历器
export function runMigrations(db: Database.Database): void {
  const sqlPath = path.join(SCHEMA_DIR, '001_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  // better-sqlite3 的 exec 支持一次执行多条语句
  db.exec(sql);
}
