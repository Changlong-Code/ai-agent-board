# 项目接入版 0.2.0 测试记录

日期：2026-10-18。环境：Linux Node24.19.0、Chromium153.0.8010.0。

## 当前源码结果

- `node --test local/bridge.test.cjs local/start.test.cjs`：17项通过（16项后端+1项启动器）。覆盖Host/Origin/token、JSON/大小限制、目录校验/持久化/解除、确认与认证拒绝、并发/停止/关闭竞态、历史重启不续跑、损坏保护、环境清理、伪CLI限制参数/stdin输入、Windows npm入口fixture、Codex配置例外、认证JSON分类、重复启动/独立锁清理/端口冲突。
- `local/integration-ui.test.cjs`：13组真实Chromium本地HTTP场景通过，**模拟Provider**。关联中文示例目录、检测不执行、显式任务参数、普通文本输出、确认追加但状态不变、完成与运行中历史重载、停止、并发与token拒绝、API认证拒绝、无脚本错误/外部请求。
- `portable/test-portable.cjs`：18组真实file://浏览器回归通过。拖动测试从卡片空白处抓取，避免抓到新增菜单原生控件。
- `local/review.md`：独立源代码/安全范围审查通过。
- 实际下载的官方Codex0.163.0与ClaudeCode2.1.302仅执行版本/帮助命令：确认所需限制参数存在。没有真实登录、模型任务、付费API调用或真实业务项目访问。

原始浏览器结果：local/integration-ui-results.json 与 portable/browser-test-results.json。开发者浏览器测试需要Playwright与Chromium；实际连接程序不需要这些测试依赖。

## 未通过的整体门禁与实机待测

原项目 `npm run gate:required` 已尝试，因未安装原工程依赖而在缺少tsx处失败；没有把此门禁标为通过。此次新增的是独立本地连接服务，不是原版React/SQLite全量移植。

Windows1909、CMD、真实Node/CLI兼容性、用户订阅认证、真实项目分析及完整子进程终止未实机验证。读写权限受CLI/系统原有策略影响；只读分析参数不是独立操作系统隔离保证。所有Provider行为的自动化测试均为伪CLI或注入模拟，不把它们视为真实账号接入成功。
