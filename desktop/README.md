# flexiguard-desktop

FlexiGuard 电脑端 —— P0 阶段。

## 技术栈
Electron + TypeScript + better-sqlite3（SQLite 本地存储）

## 当前阶段 (S0-S2)
- S0 方案与设计锚点（见仓库根 docs/）
- S1 项目骨架 + SQLite 三表落地（task/evidence/daily_stats）
- S2 ActivityWatch 接入验证脚本（aw-verify，取 events→扣 AFK→算有效工时）

## 常用命令
```bash
cd desktop
npm install        # 首次：装依赖（better-sqlite3 需 npm approve-scripts + npm rebuild）
npm run build     # TypeScript 编译
npm run aw-verify # ActivityWatch 链路验证（需 aw-server 在 localhost:5600 运行）
npm start         # 启动 Electron（P0 仅占位窗口）
```

## 后续阶段
- S3 核验引擎（落实 verify 接口契约）
- S4 任务 CRUD + 8h 累计 + 极简 UI
- S5 到点提醒 + 打卡核验
