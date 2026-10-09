# Code 模式 AI 交接文档

> 本文是给"切到 TraeWork Code 模式 / TraeCode 打开本项目后的新会话 AI"的接力说明。
> 读这份文件 + [design-anchor.md](./design-anchor.md) + [README.md](../README.md) 即可完全接上。
> 最后更新：2026-10-09

---

## 0. 给 Code 模式 AI 的第一句话

你好。这是一个跨端项目 `flexiguard`（弹性工作 8h 取证核验），当前在 **P0 电脑端** 阶段，进度到 **S2 ActivityWatch 接入验证**。前一个 AI 会话把代码和设计都写进了这个仓库，但因为前一会话跑在**远程沙箱**，够不到用户本地 Windows 电脑的 aw-server，所以 S2 的 3a/3b 真实数据验证还没跑通。**你的任务：在用户本地把 S2 跑通，看 3a/3b 输出判断链路是否成立。**

关键：不要推翻前一会话已锁定的设计。所有"为什么这样"的依据都写在本文件和 design-anchor.md 里。如有质疑，先读依据再决定。

---

## 1. 项目本质

自由职业者每天规划弹性工作 8 小时。问题：缺乏监督容易拖沓，关掉闹钟不代表真完成。
本系统：**用电脑活动日志/写作内容/git 提交等真实证据核验打卡**，未达标则限制娱乐 App。

## 2. 关键决策（已锁定，不要推翻）

| 项 | 决策 | 依据 |
|---|---|---|
| 取证层 | 复用 ActivityWatch（开源、本地数据） | [activitywatch.net](https://activitywatch.net/) |
| 电脑端技术栈 | Electron + TypeScript + better-sqlite3 | 跨 Win/macOS/Linux |
| 手机端 MVP 平台 | **先鸿蒙，后 iOS，最后 Android** | 鸿蒙 [Screen Time Guard Kit](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/screentimeguard-introduction) 支持娱乐屏蔽且权限流程化；iOS Family Controls entitlement 审核慢；Android 为推广（全球 75%）放最后 |
| 同步方式 | **P0 局域网直连，后续 sync-server** | 用户已确认 |
| 仓库结构 | 单 monorepo，目录分端（desktop/harmony/ios/android/sync-server/docs） | 跨语言项目，不用 npm workspaces |
| 鸿蒙屏蔽限制 | 仅中国境内、仅 Phone/Tablet | Screen Time Guard Kit 硬约束 |

## 3. 当前进度（git log 历史）

```
c18fa6f refactor: monorepo 结构重组 flexiguard
67188af fix(S2): limit=0 改为 10000 + 加无参数对照取数
7f9dab5 fix(S2): 修正 bucket type 判定 + 消除 Windows libuv assertion 崩溃
91c37f1 S1+S2: 项目骨架 + ActivityWatch 验证脚本
```

| 阶段 | 状态 |
|---|---|
| S0 方案 + 最小设计锚点 | ✅ 已完成（见 design-anchor.md） |
| S1 项目骨架 + SQLite 三表 | ✅ 已完成 |
| **S2 ActivityWatch 接入验证** | 🔄 **代码写完，3a/3b 真实数据未验证** |
| S3 核验引擎 | ⬜ |
| S4 任务 CRUD + 8h 累计 + 极简 UI | ⬜ |
| S5 到点提醒 + 打卡核验（P0 完成） | ⬜ |

## 4. 当前卡点（你的首要任务）

S2 脚本 `desktop/src/scripts/aw-verify.ts` 已写完，用户已在自己电脑跑过一次，结果是：
- 探活 ✓、buckets 识别 ✓（type=`currentwindow`/`afkstatus`）
- 但**最近 2 小时 events 条数 = 0**

前一会话已修了两个 bug：
1. bucket.type 用真实值 `currentwindow`/`afkstatus`（非臆测的 `window`/`afk`）——依据 ActivityWatch bucket.type 是 Event 数据结构类型名
2. `limit=0` 改为 `limit=10000`（`limit=0` 被 aw-server 理解为"返回 0 条"）——依据官方示例用 `limit=100000`、Python 客户端默认 `limit=-1`

还加了 **3a 步**：无参数取 events，对照确认 watcher 是否真产生数据。

**你要做的**：让用户在 `D:\DeepBlue\flexiguard\desktop` 跑 `npm run build && npm run aw-verify`，把 3a/3b 输出贴回来（或你在 Code 模式直接跑、直接看输出）。判断：
- 若 3a 全量条数 = 0 → watcher 没产生数据，需检查 ActivityWatch 设置里 aw-watcher-window/afk 是否启用
- 若 3a 有数据、3b = 0 → 时间区间问题（时区/时间戳对不上）

## 5. 关键路径与配置

| 项 | 值 |
|---|---|
| GitHub 远程 | `https://github.com/Benjamin-Z00/flexiguard.git` |
| 本地路径 | `D:\DeepBlue\flexiguard` |
| 电脑端子包 | `D:\DeepBlue\flexiguard\desktop` |
| aw-server | `http://localhost:5600`（用户已安装 ActivityWatch v0.14.0，主机名 LAPTOP-TL633EFV） |
| 主机 bucket id | `aw-watcher-window_LAPTOP-TL633EFV`、`aw-watcher-afk_LAPTOP-TL633EFV` |
| AW_URL 环境变量覆盖 | `AW_URL=http://127.0.0.1:5600` |
| 默认分支 | `main` |

## 6. 已知非阻塞项（不属当前任务）

- `desktop/src/db/migrate.ts` 从 `src/db/schema/` 读 .sql，tsc 不拷资源；打包发布时需补资源拷贝步骤
- Electron GUI 实际开窗未在沙箱验证（沙箱无显示服务器）

## 7. 已修正的关键 bug（不要回退）

| bug | 修正 | 不要做 |
|---|---|---|
| `/api/0/` 返回 404 | 改成 `/api/0/info` | 不要改回 `/api/0/` |
| bucket.type=`window`/`afk` 漏匹配 | 改成 `currentwindow`/`afkstatus` | 不要改回简称 |
| `process.exit(1)` 在 Windows 触发 libuv assertion | 改成 `throw` + `process.exitCode=1` | 不要改回 `process.exit` |
| `limit=0` 返回 0 条 | 改成 `limit=10000` | 不要改回 0 |

## 8. 本地操作（你可直接在 Code 模式执行）

```powershell
# 1. 关联远程并 push（用户已建空仓库，本地已有 4 个 commit）
cd D:\DeepBlue\flexiguard
git remote add origin https://github.com/Benjamin-Z00/flexiguard.git
git push -u origin main

# 2. 电脑端装依赖（路径变了，需重装；better-sqlite3 原生模块需 approve + rebuild）
cd desktop
npm install
npm approve-scripts better-sqlite3   # 若提示 allow-scripts
npm rebuild better-sqlite3

# 3. 编译 + 跑 S2 验证
npm run build
npm run aw-verify
```

跑完 aw-verify 看 3a/3b 输出，按第 4 节判断。

## 9. 设计依据汇总（防止推翻）

- **bucket.type 用 `currentwindow`/`afkstatus`**：用户 aw-server 实测返回值（铁证）
- **AFK 离开 status = `"afk"`**：[官方 working-with-data 示例](https://docs.activitywatch.net/en/latest/_sources/examples/working-with-data.rst.txt) `filter_keyvals(afk_events, "status", ["not-afk"])`，故 `afk`=离开、`not-afk`=活跃
- **端点 `/api/0/info`**：[REST API 文档](https://docs.activitywatch.net/en/latest/api/rest.html) + API playground 在 `http://localhost:5600/api/`
- **`limit=10000`**：官方示例 `limit=100000`、Python 默认 `limit=-1`
- **鸿蒙优先**：[Screen Time Guard Kit](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/screentimeguard-introduction) 支持娱乐屏蔽，[权限流程化](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/restricted-permissions)
- **iOS 排后**：[Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement) 需 Apple 单独审批，审核慢

## 10. 接下来若 S2 跑通

按执行清单继续：
- **S3 核验引擎**：落实 `verify(task, evidences)` 接口契约（见 design-anchor.md 第 2 节），P0 默认阈值 active_ratio≥0.7 且 require_productive=true
- **S4 任务 CRUD + 8h 累计 + 极简 UI**（列表+按钮+弹窗，不做布局美化，正式 UI 放 P1 鸿蒙端）
- **S5 到点提醒 + 打卡核验** = P0 完成

P0 完成后进入 P1 鸿蒙端 + 局域网同步。
