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

## 第二批静态检查（2026-10-11）
读取基线：a9eb3bb001efaa4009b3a770ba37c674e13692f5。未运行服务器或任何 Agent。

### 锁文件依赖矩阵
以下版本来自 package-lock.json；Node engines 只代表包声明，不等同目标 Windows 版本通过。
| 依赖 | 锁定版本 | Node engines | 基础版关系 | 当前状态 |
|---|---|---|---|---|
| Vite | 8.0.16 | ^20.19.0 或 >=22.12.0 | 开发/构建 | 原生链路待实测 |
| rolldown | 1.0.3 | ^20.19.0 或 >=22.12.0 | Vite 构建 | Windows 二进制待实测 |
| lightningcss | 1.32.0 | >=12 | 样式构建 | 待实测 |
| @tailwindcss/oxide | 4.3.1 | >=20 | 样式构建 | 待实测 |
| better-sqlite3 | 12.6.2 | 20/22/23/24/25.x | 本地数据库必需 | 有安装脚本，预编译/ABI待验证 |
| agent-sdk-core | 0.7.0 | >=22 | 当前服务静态导入 | 基础版需要隔离 |
| copilot-sdk | 1.0.1 | ^20.19.0 或 >=22.12.0 | AI 可选能力，当前普通依赖 | 待解耦 |
| claude-agent-sdk | 0.3.177 | >=18 | AI 可选能力 | 订阅/CLI/OS待验证 |
| codex-sdk | 0.139.0 | >=18 | AI 可选能力 | 订阅/CLI/OS待验证 |

Node 22.x 官方 BUILDING.md 的平台表列 Windows 10/Server 2016 起，同时明确排除操作系统厂商已终止支持的平台。不能仅据平台表保证 1909 官方受支持或可运行。来源：https://github.com/nodejs/node/blob/v22.x/BUILDING.md （读取日期 2026-10-11）。尚未核实目标 Windows 版本/版本类型及 Node 24 的对应声明；不要求升级系统，也不承诺通过降级解决。

### 启动与执行边界
1. AgentManager.initialize() 创建所有 Provider 并检测 CLI，之后才读取 AGENTBOARD_DISABLE_AGENT_STARTUP。开关避免该方法内 provider.start()，不能避免静态 SDK 导入、构造或检测。
2. refresh() 没有相同开关，检测到可用 Provider 后会调用 start()。因此现有开关不能当作完整基础模式或授权控制。
3. index.ts 在 listen 前恢复 pending runs，运行后每15秒再扫描。基础模式需在调度入口及真正执行入口统一拒绝，不能只隐藏按钮。
4. Provider.start() 异常在 initialize() 中逐个捕获，但 SDK 导入、构造、检测等更早错误仍可能阻塞启动；实际库副作用未执行验证。
5. 基础模式禁止执行时，应保留 pending 请求和现有任务记录，不将其误标为完成、失败或清除授权历史。

### 数据与文件保护
- config.ts：AGENTBOARD_HOME 默认 os.homedir()/agentboard；首次创建 config.json 和 projects。读取损坏配置时会写默认配置，原始内容未备份。M2 应保留损坏文件并提示。
- db.ts：DB_PATH 默认 process.cwd()/data/agentboard.db；initDatabase 会自动迁移，并启用 WAL。启动工作目录不同可能产生不同数据库；应明确固定目录，不自动搬移旧数据。
- SQLite 备份需使用可靠在线备份接口，或完全停服后处理数据库及其 WAL/SHM 状态，不能直接复制运行中的主文件声称完整。
- worktree-cleanup.ts：reconcileManagedWorktrees 对 done/archived 任务及符合管理路径规则的孤立 worktree 执行清理。存在安全检查，但基础模式启动应先只报告，不自动删除或修复业务 worktree。
- 测试脚本已有隔离 DB_PATH 和 AGENTBOARD_HOME，但实际测试前仍须核对 dotenv、上传目录、仓库白名单与继承环境，防止接到真实业务数据。

### Windows 脚本
run-required-gate.cjs 已区分 Windows PowerShell 与 Unix sh；e2e-server/client.cjs 已区分 Windows shell 启动。不能说项目完全没有 Windows 支持。
现有 signal 转发不能证明 Windows 子进程树完整退出；M2 需按本实例进程身份验证，不能 taskkill 全部 node.exe。
数字端口校验不等于1–65535范围校验；启动器应补充范围、占用与健康响应身份检查。

### M2 建议路线
先实现默认禁止 Agent 执行的基础模式，再制作启动入口。预构建前端可减少用户机器的构建依赖，但仍需验证 Node 与 SQLite，不能把预构建等同1909兼容。
如关键二进制在目标机器失败，保存实际错误并评估替代依赖/存储实现；不自动要求系统升级、付费API或安装大型编译工具。
详细排序和验收见 M1_TASKS.md。

### 本批验证
已复核源文件和锁文件、读取官方 Node 文档。没有 npm install、构建、E2E 或目标实机结果。本批仅补充文档。
M1 保持进行中：完整命令路径审计、原生依赖验证和目标实机验证仍未完成。

## M2 基础模式第一批实现
2026-10-11：默认禁止Agent执行；初始化/刷新延迟加载SDK；路由和运行时统一拒绝；基础模式跳过启动worktree清理、pending恢复和orphan状态改写。统一策略见 execution-policy.ts。
当前Linux Node24.19.0：npm ci成功；前后端构建通过；服务端81项测试通过。required gate浏览器验收失败，Chromium下载为无效zip，未取得UI通过证据。Windows1909未验，M1/M2均不标完成。
