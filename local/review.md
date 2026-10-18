# Connected bridge provisional security review

Date: 2026-10-18. Reviewer: Morpheus. Scope: local bridge, connected UI, provider launch boundaries. Status: review in progress; no release sign-off yet.

Initial controls observed: loopback-only listener; exact Host and optional Origin checks; per-process random token for protected APIs; JSON body/type limits; no providers on startup/link; explicit run confirmation; canonical linked directory; subscription auth check; no shell interpolation; bounded output/runtime; safe text rendering of results.

Pending implementation verification:

- Cancel or close during awaited detection/start must prevent late launch and stop a late process handle.
- Inherited alternate-provider selectors must not redirect subscription runs to Bedrock, Vertex, Foundry or other API billing.
- Provider configuration, MCP, hooks, user/project settings and model-provider override behavior require fail-closed verification rather than relying on prompt instructions.
- A selected working directory and a read-only sandbox do not guarantee reads are confined to that directory. UI/docs must accurately describe that boundary; filesystem containment requires additional enforcement.
- Launcher lock, health identity and owned-child cleanup remain to be reviewed when implemented.

Independent CLI execution was not performed. Mock-adapter tests do not establish real provider flag compatibility or Windows execution safety. Original project gate and Windows 1909 validation remain separate.

## Follow-up scoped approval

Reviewed revised bridge and `local/start.cjs` / `Start-Connected-Board.cmd`. Independently executed `node --test local/bridge.test.cjs`: **11 passed, 0 failed**.

Code-level findings addressed:

- Cancellation is registered before asynchronous detection; cancellation is rechecked before actual provider spawn, and late handles are stopped.
- Provider/API environment variables are filtered, including alternate-provider selectors; subscription login is required, unsupported isolation flags cause refusal rather than fallback.
- Codex startup requires user-config/rule isolation flags, refuses ancestor project config, and forces its OpenAI provider and ChatGPT login method. Claude startup requires safe/restricted mode and limits tools to Read/Glob/Grep, excluding MCP. These are source-level controls; actual CLI semantics remain an integration-test prerequisite.
- Link/unlink persistence failure rolls back in-memory association; run-history write failure blocks execution; bounded history prevents unbounded output retention in memory.
- Exclusive launcher lock fails closed, never reuses a foreign server and is removed only by its owner. Loopback-only Host/Origin/token protection remains intact.
- The confirmation UI explicitly states the selected path is a working directory, not a file-read isolation boundary. It does not claim filesystem containment.

**Verdict: scoped source/security review approved for the implemented bridge prototype.** No outstanding source-level finding blocks further testing. This is not a production sandbox certification or confirmation that real account-backed runs are supported on the user's PC.

Remaining validation limits: backend tests use injected mock providers and do not validate real subscription authentication, provider CLI flag semantics, absence of externally managed settings, or Windows 1909 support. Windows stop requests use taskkill `/T`; non-Windows stop currently targets the direct CLI, so descendant process cleanup is not guaranteed there. A stop request and canceled status mean termination was requested, not independently verified termination of every process. The original React/SQLite project's required gate remains separate and cannot be marked passed by these tests.

## Final incremental review — CLI discovery and config guard

Independently reread Windows npm resolution and Codex config exceptions. Resolution runs only known package entry points without invoking a shell; modern Claude native bin, wrapper and legacy entry points are supported. Native `MZ` checking is a basic format check, not an authenticity/signature verification; the installed local CLI and PATH remain trusted inputs.

The default user's Codex config is exempted only at its exact canonical home path because `--ignore-user-config` disables it; project and other ancestor configs remain refused. No broader ancestor exemption was introduced.

Read captured official package help probes for Codex 0.163.0 and Claude Code 2.1.302: required flags are present. Codex documents user-config/rules bypass; Claude documents safe mode customization disabling and restricted mode suppression of command tools/settings plus working-directory file-tool confinement. Managed policies still apply. These were help-only probes, not model requests, login verification or Windows execution tests.

Independently ran `node --test local/bridge.test.cjs local/start.test.cjs`: **16 passed, 0 failed, 0 skipped** (15 bridge tests plus 1 launcher test). Coverage now includes fake CLI subprocess arguments/stdin, unsupported flags, canceled launch, modern npm shim resolution, config guard, exclusive launcher lock, occupied port preservation and owned cleanup.

**Final scoped verdict remains approved for the connected prototype's reviewed source and local deterministic tests.** Real subscription-backed model calls, Windows 1909/Windows process-tree behavior and browser integration evidence remain separate. The original project's full required gate was attempted but failed due to unavailable installed dependencies; it is not passed by this review. Earlier 11-test counts and mock-only description above are historical and superseded by this increment; fake CLI subprocesses and official help probes now supplement mock adapters.

## Structured Claude auth classifier follow-up

Reviewed `classifyAuth` and its fixtures. Claude now parses the structured `authMethod` rather than searching the complete JSON text, so `apiKeySource: null` does not incorrectly classify a subscription login as API authentication. Explicit API/helper/third-party methods remain denied by the execution gate; logged-out, OAuth-token, malformed, failed-command and ambiguous output remain unconfirmed. Codex text classification is unchanged.

Independently ran the targeted structured-auth classifier test: passed. The coordinator's final full-suite count is now **17 passed** (16 bridge tests plus 1 launcher test); my immediately preceding independent full-suite run was 16 passed, before this additional classifier test. No broad retest was repeated for this isolated pure-function change.

Scoped source approval remains valid. Browser integration scenarios are independently reported by QA and do not constitute live-provider or Windows 1909 verification.
