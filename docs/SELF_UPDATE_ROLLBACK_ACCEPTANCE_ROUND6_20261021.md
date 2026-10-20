# Isolated Windows Rollback Acceptance — Round 6

This documentation-only commit is the deliberate GitHub update target for the isolated 8876/8877 test installation.

- Prior checkout: `0db502df6aeb37e280bf65c6cd2ad054a74f56ef`
- Fault trigger: one-shot `updates/rollback-test-once.json` in `AI-Agent-Board-SelfUpdate-Test/data`
- Inject after the updater changes Git HEAD and rebuilds the new checkout, but before restarting Board.
- Expected outcome: `phase = rolled-back`, `HEAD = 0db502df6aeb37e280bf65c6cd2ad054a74f56ef`, original Board health checks pass and original SQLite database stays accessible.
- The marker is never placed in the production 8776 data folder.
- Reject update in the event of any unexpected version, dirty worktree, port mismatch, lock, or stale stop request.

No runtime source or npm dependency files are changed by this commit.
