# Windows Self Update — UI Acceptance Test, Round 4

Documentation-only commit to validate the progress, elapsed-time, reconnection and completion notification UI of the isolated Windows Board.

Starting branch commit: `1807aed51266f80043a7dc8d8be67dce727ecd49`.

Test instance: 127.0.0.1:8876; local data under `AI-Agent-Board-SelfUpdate-Test`.

Acceptance criteria:
1. Display real stage changes and elapsed time from state timestamps.
2. Disable repeated installation while an update is active.
3. After restart, reconnect and display the completed-update notice.
4. Keep the regular Board on port 8776 untouched.

This commit changes no runtime code or npm dependencies.
