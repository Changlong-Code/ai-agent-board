# M1 Windows 兼容性初步报告
日期：2026-10-11
分析基线：a5c7560859c18525e3a625900393bf8d3503b2fc（windows-m1）
状态：进行中；仅静态检查，未安装依赖、未运行软件、未做 Windows 10 1909 实机测试。

## 已核对文件
package.json、package-lock.json、packages/client/package.json、packages/server/package.json、packages/client/vite.config.ts、packages/server/src/index.ts、packages/server/src/services/agent-detection.ts。

## 已确认事实
| 检查项 | 证据 | 结论 |
|---|---|---|
| Node 要求 | 锁定 Vite 8.0.16 engines 为 ^20.19.0 或 >=22.12.0；Agent SDK core 0.7.0 为 >=22 | 当前组合最低满足条件为 Node 22.12.0；README 的 22+ 不够精确。此为包版本约束，不代表 OS 支持 |
| SQLite | better-sqlite3 12.6.2 有安装脚本，支持声明含 Node 24.x | 原生模块安装与运行必须实测，不能保证在 1909 可用 |
| 前端原生工具 | Tailwind oxide 4.3.1 带 Windows x64/arm64 可选包；Vite 依赖 rolldown/lightningcss | Windows 包存在不等于支持 1909，需继续核实 |
| AI 依赖 | server 将多个 Agent SDK 声明为普通 dependencies | 基础看板安装仍会拉取 Agent 依赖；后续评估解耦 |
| 服务启动 | index.ts 在 server.listen 前 await agentManager.initialize() | 需检查初始化失败是否影响看板启动 |
| 自动执行 | index.ts 启动时恢复 pending runs，且每 15 秒扫描并调用 startAgentForTask | 基础模式必须有统一的执行禁用规则，覆盖启动恢复与定时扫描 |
| 文件操作 | 启动会 loadConfig，初始化数据库，并调用 reconcileManagedWorktrees | 启动不是纯只读；需核实配置目录与清理范围，示例测试不得接真实项目 |
| 网络绑定 | 后端和 Vite 默认 127.0.0.1，端口 8080/8081 | 静态配置符合本机访问方向；环境变量仍可覆盖 |
| 双击入口 | 已读取分支目录未发现 .cmd/.bat 启动入口 | M2 需新增，当前不能声明双击即用 |
| Windows 探测 | agent-detection.ts 已使用 where.exe、PowerShell 和 PATH 探测 Copilot | 原版已有部分 Windows 适配；不能当作 1909 全面验证 |

## 下一批检查
1. 核实 Node 与关键原生依赖的官方目标系统支持信息。
2. 读取 AgentManager 初始化、loadConfig、数据库与 worktree 清理实现。
3. 完整核对启动/测试脚本及 Agent 进程调用的 Windows 行为。
4. 补充完整依赖矩阵、M1_TASKS.md 和 WORK_CHECKPOINT.md。
5. 提出 M2 修改范围，明确需要 Windows 10 1909 实机验证的步骤。

## 当前限制
历史记录中的 Node.js 24.19.0 只作为用户环境线索；未读取目标电脑，未核实其安装和运行。
未调用 AI Provider，未修改软件代码，未启动付费服务。
M1 尚未完成；本文件为已有证据的阶段记录。
