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

No SQL schema or configuration migration is introduced. The version-1 project file record gains optional private creation metadata; legacy records remain readable and are never rewritten merely to add this field. Existing profiles, connections, projects, exports and media jobs remain owned by their current services. The bundled headless Agent must be rebuilt together with Desktop so new tool registration and strict protocol schemas ship together. Existing conversations receive the capabilities on the next turn after Host restart; no account re-creation or Instagram reconnection is needed.

Cover strict forged account/path/policy rejection, account-bound import/job actions, safe projections, queued/failed/cancelled/completed snapshots, duplicate-source reuse, idempotent project creation under concurrency/restart, creation-key conflicts, current-revision export admission, stale revision/edit-control rejection, and supervised publication. An isolated Electron scenario must start from an empty library/project list and exercise a deterministic model through import, candidate analysis, project creation/edit/export and proposal without an external model or real Meta publication. Source download and provider acceptance with a real user model/YouTube remain separately reported pilot evidence; no fabricated success, captions or publication claim is permitted.
