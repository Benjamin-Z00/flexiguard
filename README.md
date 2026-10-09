# FlexiGuard

弹性工作制达标守卫 —— 自由职业 8 小时高效完成系统。

核心理念：**不是关掉闹钟就算完成，而是用电脑活动日志/写作内容/git 提交等真实证据核验打卡**，防止偷懒。

## 解决的问题
自由职业者每天规划弹性工作 8 小时，但缺乏监督容易拖沓。本系统通过取证核验（不是闹钟一键关闭）确保规划内容真正完成，未达标则限制娱乐 App。

## 架构

```
flexiguard/
├── desktop/       # 电脑端（Electron+TS+SQLite）：ActivityWatch 取证 + 核验引擎 + 8h 累计提醒
├── harmony/       # 鸿蒙端（ArkTS）：Screen Time Guard Kit 实现娱乐屏蔽（P1 优先）
├── ios/           # iOS 端（Swift）：Family Controls 娱乐限制（P2）
├── android/       # Android 端（Kotlin）：推广覆盖（P3）
├── sync-server/   # 跨网络同步服务器（后续，P0 用局域网直连）
└── docs/          # 设计文档、架构、调研
```

## 取证核验链路（核心）
1. ActivityWatch（后台运行）记录前台应用/窗口/AFK 时间戳
2. 用户打卡某任务时，桌面 App 调 ActivityWatch API 取该时段 events
3. 判定：活动时长 ≥ 阈值 **且** 至少 1 类产出性证据（写作字数增长 / git commit）→ 真完成
4. 当日核验通过工时累计 ≥ 8h → 达标；未达标 → 次日提醒补 + 限制娱乐 App

## 阶段规划
| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 方案与最小设计锚点 | ✅ |
| S1 | 电脑端项目骨架 + SQLite 落地 | ✅ |
| S2 | ActivityWatch 接入验证 | 🔄 |
| S3 | 核验引擎（verify 接口契约） | ⬜ |
| S4 | 任务 CRUD + 8h 累计 + 极简 UI | ⬜ |
| S5 | 到点提醒 + 打卡核验（P0 完成） | ⬜ |
| P1 | 鸿蒙端 + 局域网同步 | ⬜ |
| P2 | iOS 端 | ⬜ |
| P3 | Android 端 | ⬜ |

## 本地开发
电脑端见 [desktop/README.md](desktop/README.md)。

## 依据
- 取证层：[ActivityWatch](https://activitywatch.net/)（开源，本地数据）
- 鸿蒙屏蔽：[Screen Time Guard Kit](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/screentimeguard-introduction)
- iOS 屏蔽：[Family Controls](https://developer.apple.com/documentation/familycontrols)
