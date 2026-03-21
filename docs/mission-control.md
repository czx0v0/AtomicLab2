# 投稿与进度（Mission Control）

全局悬浮入口 **🚩**（右下角，位于原子助手机器人左侧）用于查看当前学术课题的截稿进度、阶段时间线与快捷入口。

## 功能概览

| 能力 | 说明 |
|------|------|
| Zustand 状态 | `projects[]`、`activeProjectId`；单条课题含 `id`、`title`、`target_journal`、`deadline`（ISO 8601）、`status` |
| 阶段枚举 | `Plan` → `Reading` → `Drafting` → `Reviewing` → `Submitted` → `Rebuttal`（见 `PROJECT_STATUS_LABELS` 中文展示） |
| Mock 数据 | 默认一条「大模型图检索综述 / KDD 2026」、`Drafting`、约 **5 天后**截稿 |
| 任务浮层 | Pastel Pixel 风格；截稿 **不足 7 天** 顶部红色 **Urgent** 横幅（呼吸动画） |
| AI 催更 | 展开右侧助手时，若不足 7 天，在聊天列表**最前**插入一条 **MISSION** 系统消息（同标签页仅一次，`sessionStorage`） |

## 前端文件

- `frontend/src/store/useStore.js`：`PROJECT_STATUSES`、`daysUntilDeadline`、`ensureProjectDeadlineReminder`、`startOver` 时重置课题与催更标记
- `frontend/src/components/MissionControlFab.jsx`：🚩 按钮与居中浮层（`Escape` 关闭）
- `frontend/src/App.jsx`：挂载 `<MissionControlFab />`
- `frontend/src/components/CopilotSidebar.jsx`：挂载时调用 `ensureProjectDeadlineReminder()`
- `frontend/src/components/MiddleColumn.jsx`：`ChatMessage` 对 `projectReminder` 显示 MISSION 样式

## 开发者说明

1. **截止日期**：用 `deadline` 的 ISO 字符串与 `daysUntilDeadline()` 计算剩余自然日；与展示「距离今天还有 N 天」一致。
2. **催更只出现一次**：键名 `PROJECT_REMINDER_SESSION_KEY`（`atomiclab_project_deadline_reminder`）。调用 **重新开始**（`startOver`）会清除该键并恢复默认 Mock 课题，可再次触发催更逻辑。
3. **清空对话**：`clearMessages` 会清空消息列表，但若已写入 `sessionStorage`，不会再次自动插入催更（除非 `startOver` 或手动清 `sessionStorage`）。
4. **无效 `status`**：`indexOf` 为 `-1` 时回退为第 0 步；无激活课题时时间线全部置灰（`currentIdx === -1`）。

## 后续可扩展

- 「生成 LaTeX 压缩包」按钮已预留置灰，可与 `exportLatexZip`（写作区同款）打通。
- 多课题切换 UI、`projects` CRUD 与后端持久化。
