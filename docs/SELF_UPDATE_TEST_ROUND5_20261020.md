# Windows Self-Update Round 5 — File State Persistence

Documentation-only target commit for the isolated Windows updater acceptance test.

- Starting baseline: `5f44951956e1636afe60940f2bc66d4996826d77`
- Verify `state.json` stays readable and updater finishes with `complete`
- Verify UI elapsed time, reconnect and completion notice
- Run only against the isolated test installation on ports 8876/8877
- Leave the production installation on port 8776 untouched

No npm dependency or application runtime files are changed by this marker.
