# CHECKPOINT_SHORT.md

日期：2026-10-19
分支：windows-m1
用途：低 Token 当前断点；新会话优先读本文件而不是完整 WORK_CHECKPOINT.md。

## 当前阶段
M1/M2：原版 Windows 本地基础版实机验收阶段。

## 已完成
- 原版 Windows 启动、安装、诊断、验证、备份、恢复入口已实现并保存。
- Linux 环境下完整 required gate 已有通过证据。
- 原版本地数据隔离、loopback、AI 默认禁用、迁移前备份等基础保护已实现。
- 已确认 windows-m1 是当前 Windows 开发分支。
- 已建立低 Token 开发协议：AI_CONTEXT.md + LOW_TOKEN_TASK_TEMPLATE.md + CHECKPOINT_SHORT.md。

## 当前阻碍
- Windows 10 1909 实机尚未完成最终验收。
- Windows 上 Node/原生模块/CMD/浏览器启动/进程停止仍需真实验证。
- M3–M6 不应被误标为完成。

## 下一步唯一任务
在目标 Windows 10 1909 电脑按顺序运行：
Setup-Original-Board.cmd → Diagnose-Original-Board.cmd → Verify-Original-Board.cmd → Start-Original-Board.cmd

收集诊断与 CRUD / 持久化 / 备份恢复 / 停止结果，再决定是否进入 M3。

## 默认读取规则
新会话先读 AI_CONTEXT.md 和本文件；只有当前任务需要时才读 WINDOWS_PLAN.md / M1_TASKS.md / WORK_CHECKPOINT.md。

## 本轮不做
- 不运行真实 AI。
- 不修改 main。
- 不全仓扫描。
- 不推进 M3–M6。


## 2026-10-19 实机闭环与修复
- Windows 10 1909 已实际启动原版 Board，基础界面和 Agent-enabled 启动均成功。
- 私有仓库 LBM 已通过本机 GitHub 认证并接入 Board。
- Agent 已在独立 worktree/branch 修改 README，Review 流程通过，PR 经人工补 commit 后成功并已合并。
- 暴露两个问题：
  1. GitHub URL 创建项目时同步 git clone 会在 Windows 私有仓库认证场景表现为长时间 Cloning。
  2. Agent 完成后 worktree 可能仍有未提交修改，Create PR 直接 push/gh pr create 会出现 No commits between。
- 已修：
  - clone 改为异步执行，并先做 20 秒 ls-remote 访问预检；私有仓库未认证时返回明确错误，不阻塞 Node 事件循环。
  - Create PR 前仅对 Board 管理的独立 task worktree 自动 git add -A + commit，再 push/Create PR；主 checkout 不自动提交。
- 新增针对测试 packages/server/tests/windows-pr-clone-flow.test.ts。
- 这些新修复尚未在用户 Windows 机器重新下载后复测；下一步先 Setup/Build 后做一次最小 clone + Agent + Create PR 回归。


## 2026-10-19 Board 原生新建 Git 项目
- New Project 新增三种来源：New Project / Local Path / GitHub URL。
- New Project 模式由 Board Server 在 cloneRoot 下创建项目目录、git init、切到 main、创建 README.md、完成 Initial commit。
- 可选勾选同时创建 GitHub Repository（Private/Public）；使用本机已登录的 gh CLI 创建 origin 并首次 push。
- 保留现有 Local Path 与 GitHub URL 导入流程。
- 本轮修改：shared/types.ts、packages/server/src/routes/projects.ts、packages/client/src/components/ProjectDialog.tsx。
- 尚未在用户 Windows 10 1909 机器重新执行 Setup/build；下一步只做这一项实机编译与 New Project 冒烟测试。


## 2026-10-20 Windows Setup 编译错误修复
- 删除 agent-detection.ts 中无引用的 appendSdkReason，修复 TS6133 导致的服务端构建失败。
- 保留现有 Windows Codex/Copilot 检测逻辑；同步两处旧版错误文案测试期望。
- 验证：build:shared、build:server、build:client 均通过；agent-detection.test.ts 12/12 通过。
- 验证环境为 Linux；Windows 实机 Setup/Start 尚待更新后复测。
- 修改文件：packages/server/src/services/agent-detection.ts、packages/server/tests/agent-detection.test.ts、本短检查点。
- 下一步：本机拉取 windows-m1 最新提交，重新运行 Setup-Original-Board.cmd。
