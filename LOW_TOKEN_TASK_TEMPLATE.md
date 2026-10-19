# LOW_TOKEN_TASK_TEMPLATE.md

用于 Codex / Claude Code / Copilot 的低 Token 单轮任务模板。

复制下面模板，每轮只填一个目标：

## Task

Goal:
<本轮唯一目标>

Read first:
- AI_CONTEXT.md
- <必要文件1>
- <必要文件2，可选>

Allowed changes:
- <允许修改文件1>
- <允许修改文件2，可选>

Do not touch:
- main branch
- unrelated modules
- package-lock.json unless dependency change is required
- long historical documents unless status must be updated

Done when:
1. <验收条件1>
2. <验收条件2>

Tests:
- <只跑本轮相关测试>

Token discipline:
- Do not scan the whole repository.
- Do not inspect unrelated history.
- Do not read WORK_CHECKPOINT.md unless AI_CONTEXT.md is insufficient.
- Expand scope only when an error or explicit dependency requires it.
- Stop after the requested goal is complete.
- Update CHECKPOINT_SHORT.md with only the new delta.

## 推荐示例

Goal:
修复 Windows 原版启动器在目标端口被占用时的提示，不终止占用端口的其他项目。

Read first:
- AI_CONTEXT.md
- windows/original-start.cjs
- ORIGINAL_PORTS.json

Allowed changes:
- windows/original-start.cjs
- 对应启动器测试

Do not touch:
- packages/client
- packages/server agent runtime
- provider code
- main branch

Done when:
1. 端口冲突时返回清晰中文提示。
2. 不 kill 其他进程。
3. 自定义端口仍正常工作。

Tests:
- 只运行启动器相关测试，不运行完整 gate。
