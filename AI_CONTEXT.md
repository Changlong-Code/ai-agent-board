# AI_CONTEXT.md

> AI Agent Board — 低 Token 默认上下文入口
> 分支：windows-m1
> 用途：任何新的 Codex / Claude Code / Copilot 开发会话，默认先读本文件；不要先全仓扫描。

## 1. 当前目标

在现有 AI Agent Board 基础上开发适用于 Windows 10 1909 的本地版，保留任务看板与项目管理，并逐步接入用户已有的 Codex / Claude Code 订阅能力。

当前主线不是重写整个项目，而是：
1. 完成原版 Windows M1/M2 实机兼容与基础运行闭环；
2. 再推进 M3 授权隔离；
3. 再推进 M4 Codex / Claude Code CLI 接入；
4. 之后才做 M5 断点恢复和 M6 自动开发管理。

完整历史与细节见：
- WINDOWS_PLAN.md
- WORK_CHECKPOINT.md
- M1_TASKS.md

除非当前任务明确需要，不要默认全文读取以上三个长文档。

## 2. 当前分支与状态

- Repo: Changlong-Code/ai-agent-board
- Working branch: windows-m1
- Main branch: main
- 原版 React/Express/SQLite Windows 本地版仍在 M1/M2。
- Linux 完整 required gate 已有通过证据，但不能替代 Windows 10 1909 实机验收。
- 原版 Windows 启动/诊断/验证/备份/恢复入口已经实现并保存。
- 独立 portable/local 版本仅作辅助历史，不等于原版 M2 完成。
- 不自动运行真实 AI，不自动读取用户真实业务项目，不自动调用付费 API。

## 3. 当前最优先下一步

默认优先级：
1. Windows 10 1909 实机执行 Setup / Diagnose / Verify / Start。
2. 核对 Node / npm / Git / better-sqlite3 / Chromium / CMD / 进程生命周期。
3. 核对原版看板 CRUD、SQLite 持久化、备份/恢复、端口冲突和正常停止。
4. 实机通过后，才更新 M1/M2 状态。
5. M3/M4 不应在 M1/M2 未确认前被大范围展开。

## 4. 默认低 Token 工作协议

### 4.1 启动时只读
新会话默认只读：
1. AI_CONTEXT.md
2. 当前任务明确点名的 1–3 个文件

不要默认读取：
- 全部 README
- 全部 package-lock.json
- 整个 packages/
- 整个 .squad/
- 整个 .copilot/skills/
- 全部历史 checkpoint
- 全部 git 历史

### 4.2 何时允许扩大读取
仅当出现以下情况之一时，才扩大范围：
- 当前文件引用了未知接口/类型；
- 构建或测试报错指向其他文件；
- 修改涉及安全边界、agent runtime、git/worktree、auth/path safety、数据库迁移；
- 任务明确要求跨模块改动。

扩大读取时，每次只增加最相关的 1–3 个文件，不做无目的递归扫描。

### 4.3 默认禁止
除非任务明确要求，不要：
- 全仓架构重分析；
- 重写已稳定模块；
- 搜索所有 TODO；
- 一次性修所有低优先级问题；
- 自动跑完整 required gate；
- 自动跑真实 Agent；
- 自动读取用户业务仓库；
- 自动切换付费 API；
- 自动生成大段新设计文档。

## 5. 开发任务最小闭环

每一轮开发只处理一个明确目标，并记录：
- Goal：本轮唯一目标
- Files：允许读取/修改的文件
- Done when：验收条件
- Do not touch：明确禁止区域
- Tests：仅执行与本轮相关的最小测试

如果用户只说“继续开发”，默认解释为：
1. 先读 AI_CONTEXT.md；
2. 找到最近未完成的最高优先级任务；
3. 只推进一个最小可验证增量；
4. 完成后更新短检查点，不扩展到下一个里程碑。

## 6. 检查点规则

短检查点使用 CHECKPOINT_SHORT.md。
只记录：
- 当前版本/阶段
- 本轮完成
- 当前阻碍
- 下一步唯一任务
- 修改文件
- 测试结果

WORK_CHECKPOINT.md 继续保留完整历史，但默认不作为每轮输入。

## 7. 测试策略

默认：
- 文档改动：不跑代码测试。
- 单文件逻辑改动：先跑最相关单测。
- 前端交互：跑对应 E2E/组件测试。
- 服务端接口：跑对应 route/service 测试。
- 跨模块或准备合并：再跑 npm run gate:required。

不要把完整 gate 当作每个小修改的默认动作。

## 8. 安全边界

- 不修改 main，除非用户明确要求合并。
- 不覆盖未知的新提交。
- 写 GitHub 文件前获取当前 SHA。
- 真实 Agent、真实订阅、真实业务项目执行需要对应授权。
- 不将密码、Cookie、Token 或账号凭据写入仓库。
- 不自动购买 API 或云资源。

## 9. 当前关键文件

优先级从高到低：
- AI_CONTEXT.md — 默认上下文入口
- CHECKPOINT_SHORT.md — 当前短断点
- WINDOWS_PLAN.md — 完整阶段规划
- M1_TASKS.md — M1/M2详细任务
- WORK_CHECKPOINT.md — 完整历史断点
- AGENTS.md — 仓库通用工程规则

## 10. 会话结束格式

完成一轮后只输出：
- Asked:
- Completed:
- Tests:
- Open issues:
- Next:

避免重复长篇回顾整个项目。
