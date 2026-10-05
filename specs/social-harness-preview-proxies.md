# On-demand video preview proxies

## Rules and owners

The user selected on-demand proxies on 2026-10-03. Player first tries the immutable managed original. A video decoder failure requests a compatible preview; imports do not automatically transcode. Never change originals or accepted project revisions, or use proxies for analysis, export or publication. Profile v1 uses MP4, H.264/yuv420p, AAC when audio exists, maximum 1280-pixel edge without upscaling, source frame rate, aspect ratio, orientation, timestamps and duration. Reduced resolution belongs only to preview; the export quality and file-size contracts are unchanged.

The existing Host media store owns metadata, managed bytes and durable jobs in its single catalog. The existing cross-process media queue owns admission, recovery, cancellation and subprocess lifetime. Main owns only ephemeral file capabilities. Renderer owns decoder observations and derived job views. Other windows reconcile durable snapshots; continuous events belong to the running Host. Mobile retains the existing replayable Host attachment, without a new Agent or queue.

```mermaid
sequenceDiagram
    participant UI as Player decoder
    participant Host as Media service
    participant Catalog as Existing catalog
    participant Queue as Existing locked queue
    participant FFmpeg as Bundled FFmpeg
    participant Main as File capability protocol
    UI->>Host: prepare(accountId, mediaId)
    Host->>Catalog: validate ownership
    Host->>Main: original capability
    Main-->>UI: opaque URL
    UI->>Host: requestProxy after video decode failure
    Host->>Catalog: atomic create/get account + media + profile job
    Catalog-->>Queue: queued, durable before event
    Queue->>FFmpeg: transcode managed original in private staging
    FFmpeg-->>Queue: bounded progress and output
    Queue->>Catalog: validate original hash, output and active state; commit
    Catalog-->>UI: event / durable snapshot
    UI->>Host: prepare(accountId, mediaId)
    Host->>Main: validated proxy capability
    Main-->>UI: opaque URL, same source timeline
```

## Interfaces and migration

Extend `ISocialMediaPreviewService` with `requestProxy` using the existing account/media request schema and returning a public media job. `prepare` prefers a valid stored proxy, otherwise the original; its representation discriminator prevents automatic decode-error loops on a proxy. No public filesystem paths or subprocess output. Use existing injected services/hooks; list/cancel/retry retain existing media commands.

Extend the existing job schema with source kind `preview-proxy`, state `proxying`, bounded conversion progress and safe errors. Proxy jobs have a stable `preview-<mediaId>` key and immutable media ID, without a fabricated remote URL. Existing download validation stays strict. Assets gain optional proxy metadata: profile version, source/output SHA-256, size and creation time. Derive private paths from validated account/media IDs. Version-1 catalogs and legacy arrays remain readable, without eager migration or user-media rewriting.

Admission validates the account/video and atomically creates or gets one job. Concurrent requests reuse it, including failed/cancelled states which require explicit Retry. Queue recovery includes `proxying`. Shutdown leaves work queued; recovery removes incomplete output before restarting conversion. Cancellation persisted by another Host wins over process completion. Commit only while the same job is `proxying`, its media belongs to the same account and original hash remains unchanged. Validate a regular nonsymlink output in staging, bounded size, H.264/AAC MP4 streams and matching duration before committing metadata and completion under one lock. Failure removes incomplete/unreferenced proxy bytes and retains originals, transcripts and projects.

FFmpeg uses no shell, file-only protocols, fixed stream mappings, bounded execution/output and existing process-tree cancellation. Store private bytes. `prepare` checks source association, size/hash and regular-file containment before creating the existing 30-minute capability. Export continues calling `getManagedOriginalPath` exclusively.

Shutdown may begin while the owner is resolving source bytes, before the cancellable process handle exists. When that handle is registered, the same queue observer must check its shutdown state, persist cancellation and cancel immediately, then await completion before releasing ownership. It must not rely on the earlier shutdown snapshot or a timeout. The interrupted job returns to `queued` through the existing terminal handler. Verify both an already registered process and this pre-registration interval deterministically.

## Acceptance

- Compatible originals admit no proxy job. An incompatible video creates one, shows conversion progress, switches to a playable/seeking proxy without changing project revision or source time, and reuses it after restart.
- Two Hosts reuse one account/media job. Another account cannot request/read/cancel/prepare it. Nonvideo requests fail before catalog mutation.
- Cancellation cannot commit a completed proxy. Failure/cancellation requires explicit retry. Shutdown/restart recovers without stale output or another queue.
- Wrong hash, corrupt/symlink output, missing tools and failed conversion expose safe errors and retain byte-identical originals. Existing download/transcription cases still pass.
- Test actual bundled FFmpeg with synthetic incompatible media through Electron, including persistence, seeking and original-based export; integration tests cover races/isolation. Execute root typecheck/lint/format and changed architecture checks. Real Meta publication remains separate and unproven.

The focused Electron fixture must start with an existing selected project as well as the new-project form. Project creation targets the form's `New Reel` input, never the selected editor's separate `Project name` field. The expanded account run on 2026-10-05 completed conversation production, manual template execution and visual/audio export parity before its global `Project name` selector matched both fields and failed. This is a confirmed test selector ambiguity; do not change project state ownership, disable strict selectors or raise deadlines to address it.

After the selector correction, the expanded Linux account suite passed with an existing selected project: actual FFv1/AVI decoder failure, H.264/AAC proxy generation, seeking, immutable original bytes, export while the fixture proxy was corrupted, and persisted proxy playback after app relaunch without another conversion. The run used synthetic media and an isolated virtual display/data root; it made no real Meta publication. Root typecheck, lint/pre-push (54 warnings, zero errors), format and changed architecture passed on the corrected source.
