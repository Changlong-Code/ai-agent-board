# Default Low Token mode (feature branch)

## Status
Backend foundation implemented; Windows build and end-to-end UI tests are **not yet verified**. This feature does not change provider-level reasoning effort, model IDs, or API billing. Do not merge until tests and approval UI are completed.

## Persistence and inheritance
Development defaults are stored in `%LOCALAPPDATA%/AI-Agent-Board/development-policy/policy.json` on Windows (or an OS home fallback elsewhere). Initial global default is `low`. A task gets a durable snapshot when created or first executed, and reuses that snapshot after restart. Switching the global default does not silently change existing tasks.

## Routes
- `GET /api/development-settings`: current global default and mandatory approval policy
- `PATCH /api/development-settings` body `{"defaultMode":"low"}`
- `GET /api/tasks/:id/development-mode`: task snapshot
- `POST /api/tasks/:id/development-mode/request` body `{"mode":"balanced"}`
- `POST /api/tasks/:id/development-mode/decision` body `{"approve":true}` or `{"approve":false}`

Upgrade request and decision reject while a task is running; pause it first. All changes must go through the local authenticated Board API. Approval is scoped to the requested task. The API does not automatically infer need for an upgrade.

## Limits and next work
1. Add authenticated settings and upgrade-decision UI, visible pending approval and paused task states.
2. Add provider-capability adapter that applies LOW reasoning effort only on providers that support it; test fallback without silently switching to paid APIs. Present implementation enforces **prompt discipline**, not model-level compute.
3. Move per-task state into the existing SQLite/PostgreSQL repository with transactions and migrations for production/multi-instance robustness. Current file storage is local single-instance only.
4. Handle group/orchestration child creation, bulk task import, task deletion, and restart reconciliation; ensure all task codepaths retain snapshots.
5. Add audit events, automated concurrency/race tests, restart tests, Windows build and regression tests before merge.

## Manual smoke test (after successful build)
1. GET default settings; expect `low`.
2. Create a task; GET its mode; expect `low`.
3. Request `balanced`; verify current mode stays `low` until approved.
4. Reject it; verify mode stays `low`.
5. Request and approve it; verify mode becomes `balanced`.
6. Restart Board and re-read mode; verify it persists.
7. Create a second task; it should still default to `low`.
8. Test Codex on a simple task and inspect actual context and provider configuration, not just an expected output.
