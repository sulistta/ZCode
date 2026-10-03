# Account-scoped Agent production commands

This amendment completes the conversational source-to-review flow in [the migration spec](social-harness.md). The pilot showed that search/read/edit/publication tools alone cannot import a source, create an empty project or start its export. Keep all current Host owners and approval rules. This is capability completion, not a new processing runtime or an alternative timeline.

## Product rules and state owners

When the user asks the conversation to prepare a Reel, the Agent may import the selected supported HTTPS source into that conversation's account, observe the existing media job, analyze the managed original, create a project, edit it through the existing revisioned project commands, start an immutable export and observe its result. Search remains read-only and never downloads automatically; a separate explicit import command admits the download. Publication remains a separate policy-gated request and supervised approval remains the default. The Agent cannot enable autonomy, approve its proposal, change edit control or introduce a local file path, credential or account override.

| State                                       | Owner                                        | Agent access                                                        |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Conversation/account binding                | Existing Host session/workspace validation   | No model-provided account or workspace ID                           |
| Source jobs, bytes, catalog and processing  | Existing social-media service/store/queue    | Admit URL, read bounded safe job snapshots, explicitly cancel/retry |
| Project, history, revision and edit control | Existing social-project service/store        | Idempotent creation plus existing read/command path                 |
| Export snapshot, progress and artifact      | Existing social-project export service/store | Admit exact revision with stable request ID; read safe jobs         |
| Approval and publication                    | Existing social-publishing workflow          | Existing policy-gated proposal/request only                         |

## Interfaces and event order

Add strict discriminated actions to the existing `socialAgent/query` protocol and its Host scope: `import-source`, `list-media-jobs` (optional job ID), `media-job-command` (cancel/retry), `create-project`, `start-export` and `list-exports` (optional project/export ID). Matching model tools are `SocialMediaImportUrl`, `SocialMediaJobs`, `SocialMediaJobCommand`, `SocialProjectCreate`, `SocialProjectExport` and `SocialProjectExports`. They require the account-scoped Social Agent port; no generic programming or third-party tools are restored. Private Host adapters remain inaccessible to the CLI and Renderer.

Mutation tools declare write/network/workspace effects accurately, reject unknown input fields and derive creation/export request IDs from the runtime tool-call ID. Tool trace input is omitted for source imports, so raw URL text is not logged. Source validation, HTTPS egress pinning, source-key deduplication, cancellable process ownership and recovery use the existing media service. Job results omit account IDs, source URLs/keys and local paths. Export summaries omit request IDs, account IDs and artifact hashes/paths. These transient projections are not another job queue or cache; the Agent must inspect their actual state before claiming completion. A media original may already be available during transcription, so music preparation can use it without requiring speech recognition. Failed jobs expose safe error codes and require an explicit retry; cancelling a tool request never implies the admitted Host job was cancelled.

Project creation accepts an optional stable request ID through the existing project service. The service derives an account-scoped deterministic project ID and records the creation request ID/fingerprint in the private project record. Under the existing catalog lock, repeating the same request returns the existing project, even after editing/restart; using that request ID with different creation content fails. Different accounts use different IDs. Existing UI creation without a request ID remains unchanged. Export admission already deduplicates the request ID and validates the exact revision. Agent edits still require current revision and agent edit control; taking user control cannot be bypassed by these preparation tools.

```mermaid
sequenceDiagram
    participant Agent as Account conversation Agent
    participant Host as Host scope/protocol facade
    participant Media as Media owner/queue
    participant Project as Project/export owner
    participant User as Desktop user
    Agent->>Host: read context; search; import selected URL
    Host->>Media: downloadSourceUrl(bound account)
    Media->>Media: persist/deduplicate job; process original
    Host-->>Agent: safe admitted job snapshot
    Agent->>Host: read actual job/media state
    Agent->>Host: analyze managed media; create project(stable request)
    Host->>Project: create once; apply revisioned Agent edits
    Agent->>Host: start export(project, exact revision, stable request)
    Host->>Project: persist/deduplicate export; render existing scene
    Agent->>Host: read actual export state
    Agent->>Host: request publication only for completed export
    Host-->>User: supervised proposal for explicit review/approval
```

## Migration and acceptance

The existing CLI permission mode remains in force for preparation commands. The Electron production scenario must explicitly answer each permission request for its fixed preparation-tool allowlist, including the policy-gated proposal request, rather than assuming one permission covers all mutations. It must never click the separate `Approve and publish proposal` control. Actual job/export state, not an elapsed delay, determines the next model command.

Consecutive permission requests may replace each other without hiding the shared dialog. The existing permission owner and response command retain the request ID. Render that existing ID on the permission list, so the E2E answers one identified request and waits for that ID to disappear or change before answering the next. Do not infer response consumption from dialog visibility or add delays; no extra permission state or persistence is introduced.

Installed Preview process validation follows [the packaged validation amendment](social-harness-packaged-validation.md).

No SQL schema or configuration migration is introduced. The version-1 project file record gains optional private creation metadata; legacy records remain readable and are never rewritten merely to add this field. Existing profiles, connections, projects, exports and media jobs remain owned by their current services. The bundled headless Agent must be rebuilt together with Desktop so new tool registration and strict protocol schemas ship together. Existing conversations receive the capabilities on the next turn after Host restart; no account re-creation or Instagram reconnection is needed.

Cover strict forged account/path/policy rejection, account-bound import/job actions, safe projections, queued/failed/cancelled/completed snapshots, duplicate-source reuse, idempotent project creation under concurrency/restart, creation-key conflicts, current-revision export admission, stale revision/edit-control rejection, and supervised publication. An isolated Electron scenario must start from an empty library/project list and exercise a deterministic model through import, candidate analysis, project creation/edit/export and proposal without an external model or real Meta publication. Source download and provider acceptance with a real user model/YouTube remain separately reported pilot evidence; no fabricated success, captions or publication claim is permitted.

## Validation evidence — 2026-10-03

Fifty-eight focused service tests and ten CLI tool/runtime tests passed, covering scope, safe projections, strict inputs, stable keys, project creation concurrency/restart, media retry and publication policy. Root typecheck, lint (54 existing warnings, zero errors), formatting and changed architecture checks passed. The internal Agent workspace typecheck passed 33 tasks and lint passed 18 tasks. No package/dependency change was needed for the new capabilities.

The expanded isolated account Electron E2E passed twice on Linux. It starts with a third account with no media or project, uses a deterministic local model to import a synthetic source, observes a deliberate actual job failure, explicitly retries, analyzes measured candidates, creates/edits a project, renders through bundled FFmpeg, observes a completed exact-revision export and requests a supervised proposal. It never approves publication. Existing account isolation, scheduled Host rejection/success, preview/export visual and audio parity and persisted state after relaunch also passed. Following a Windows fixture failure, the second passing local run observes permission request identity rather than shared dialog visibility. [Hosted run 37154285433](https://github.com/sulistta/ZCode/actions/runs/37154285433) passed all five jobs on implementation commit `42bbee3`: static checks, bridge container fixture, and account E2E plus native packaging/installed smoke on Linux, Windows and macOS.

The separate assistant Electron E2E passed provisioning/creation retry, quota states, safe secret clearing, callback readiness/replay and actual Host-side media-reader fixtures. The isolated real-source adapter downloaded and validated the 205,446,624-byte original described in [source format evidence](social-harness-source-formats.md). These checks do not prove the user's real model prepares the desired cut, a live post refresh, an approved cloud upload or real Instagram publication.

The final Linux x64 Preview was rebuilt from `42bbee3`: AppImage 328,555,301 bytes and Debian package 266,058,024 bytes, under `packages/desktop/dist/agent-production-final-verification`. The final AppImage passed the isolated installed-package smoke: account/assistant surface, actual secondary-process callback, replay rejection, saved profile after relaunch and unchanged legacy sentinel. Package assertions verified all bundled media/provisioning resources. At that build, the strict release-material check reported eleven outstanding production records. Subsequent notice-only attribution work and the current open gate are recorded in [release-material validation](social-harness-release-materials.md) and the current inventory; these Preview results do not authorize a production release or close that gate.
