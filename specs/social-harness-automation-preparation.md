# Clip-preparation automation completion

This closes the stale built-in clip template in Phase 5 of [the migration spec](social-harness.md), using the existing [account-scoped production commands](social-harness-agent-production.md). The template still asks the user to create a missing project in Player and never requests export, even though the Host now supports both operations. Preparation must produce a reviewable export through the same services used by account conversations.

## Rules and owners

The clip-preparation template starts from media already in the selected account's library. It reads the current editorial profile, memory and policy, chooses podcast or music analysis using available evidence, and preserves actual candidate timestamps. No usable media/evidence requires an honest explanation; source discovery/import is a separate explicit action. Missing transcript or heatmap is unknown, never fabricated.

Use a suitable existing project or create a new Reel project when none fits. Ask the user when the existing project choice is ambiguous. Apply edits through the revisioned project contract, respecting user edit control. Export the accepted revision and inspect the actual job result before claiming the file is ready. Failed or cancelled export is reported as such. Preparation never requests or approves publication or changes account autonomy. Publication remains a separate workflow with the existing export/account/caption-bound approval and policy rules.

The UI supplies only a human-readable template draft. `AutomationRepo` remains the owner of saved instructions, schedule, claims and run history. Manual execution uses the existing `runAutomationNow` claim/Host dispatch and scheduled execution uses the existing Desktop Scheduler. The window Host derives account scope from the validated workspace identity; the Agent supplies no account, path, credentials or owner override. The media, project and export services retain their existing single write paths, queue/process ownership, stable admission keys and stale-revision protections. No new workflow engine, scheduler, accepted-state cache or polling queue is introduced.

## Interface and order

The existing account form selects the `clips` template with `mode: build`. Saving uses the current account-scoped automation interface. Runtime preparation uses `SocialAgentGetContext`, `SocialMediaList`, `SocialClipCandidates`, project list/read/create/command and exact-revision export/start/read tools already registered in the Social Agent. Tool permission requests remain separate from publication approval. The template and its translated title/description describe preparation and export for review without exposing internal tool names in the saved user instructions.

```mermaid
sequenceDiagram
    participant User as Desktop user
    participant UI as Account automation form
    participant Repo as Existing AutomationRepo
    participant Host as Window Host / validated account scope
    participant Agent as Existing account Agent
    participant Media as Media owner
    participant Project as Project/export owner
    User->>UI: choose clip-preparation template; save
    UI->>Repo: existing scoped createAutomation
    User->>Host: Run now for saved automation
    Host->>Repo: atomically claim one manual run
    Host->>Agent: dispatch saved instructions in bound workspace
    Agent->>Host: read current account and managed media
    Host->>Media: measured podcast/music candidates
    Agent->>Host: create when needed; read and edit expected revision
    Host->>Project: existing project admission/command path
    Agent->>Host: export accepted revision; read actual export state
    Host->>Project: existing immutable export worker
    Agent-->>Host: ready for review / explicit failure
    Host->>Repo: existing terminal outcome settles claim and history
    UI->>Repo: existing run-history projection
    User->>UI: review project and completed export in Player
```

Existing automation configuration is not rewritten. New drafts receive the updated template; user-authored or previously saved instructions, schedules and permissions stay intact. Users can edit saved instructions or create a new automation from the updated template. There is no protocol, database or credential migration. Both manual and scheduled dispatch continue to use the same saved prompt; desktop-active scheduling and five-minute misfire semantics remain unchanged.

## Acceptance

An isolated Electron case must create an account with managed music media but no project, select the actual clip template in the UI, save it, and invoke **Run now**. A deterministic local model must follow those saved instructions through current Host tools, create/edit a project and render a completed exact-revision export with bundled FFmpeg. Verify one account-bound manual run with successful terminal outcome, the actual persisted project/export, unchanged other-account assets/projects, and zero publication requests. Inspect the completed export in Player and the saved run history. The model fixture must not force preparation when the saved instructions only request manual setup or omit export. No real model, Meta upload or publication is claimed by this case.

Retain the existing source-to-proposal conversation E2E, scheduled success/rejection, permissions, project takeover, preview/export parity, isolation and relaunch coverage. Run root typecheck/lint, formatting and changed architecture validation. This amendment does not close the two real podcast/music publication acceptances or the strict third-party release-material gate.

## Validation evidence — 2026-10-03

The final isolated Linux Electron account E2E passed. Its fourth account has managed synthetic music media and no project. The actual UI template is saved unchanged except for a local model scenario marker, paused, and dispatched with Run now. The model receives the saved instructions, measures candidates, creates/reads/edits a project, renders a real exact-revision MP4 with bundled FFmpeg and inspects completion. One account-bound manual run records success; Player shows the completed export and the automation history shows Completed. Other-account media and projects are unchanged. The preparation case makes no source-import or publication request. The existing empty-account conversation import/failure/retry-to-proposal, scheduled rejection/success, editing permissions, audiovisual preview/export parity and relaunch scenarios also pass. No real Meta publication is claimed.

A prior attempt failed in the new test selector after selecting a prefilled template: React writes a controlled textarea's default value into its enclosing label's text content, so exact `getByLabel` no longer matches. A separate real Chromium probe reproduced zero exact-label matches and one accessible textbox match. The test now uses the textbox's accessible name. The final full retest passed; the failed attempt is not counted as a pass. An earlier run was intentionally interrupted to reload changed test code.

Twenty-one focused download/search and automation-admission tests passed. Root typecheck, formatting and changed architecture checks passed (zero baseline/new violations). Lint passed with 54 existing warnings and zero errors after reducing the test entry to the repository's 400-line limit; its first run had that new line-limit error. The Host, scheduler, protocol, dependencies and persisted configuration schema are unchanged.
