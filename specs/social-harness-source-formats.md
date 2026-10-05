# Separate source audio/video formats

The real pilot reproduced two download failures before the first byte. The installed standalone yt-dlp and existing public HTTPS proxy rejected both selected sources with `Requested format is not available` under `best[ext=mp4]/best`. One metadata probe returned 37 video-only formats, 7 audio-only formats and zero combined formats; `bv*+ba/b` selected video/audio successfully. This establishes a format-selection failure, not a router, credential or Convex failure. It does not establish a full successful download or publication.

Keep the existing Host media service, queue, staging, catalog and explicit retry owners. Select best video/audio with `bv*+ba/b`, merging separate tracks without re-encoding through bundled FFmpeg. Use Matroska for the merged original to retain codec/quality without silently restricting resolution or codec. Already combined sources may download directly. The managed library supports `.mkv` and the scene/export renderer reads originals through FFmpeg. Instagram delivery remains the separately rendered/approved MP4 export with its existing 1 GiB limit; source intake retains the 4 GiB cap. No billing, configuration or data migration is introduced.

Host composition passes the resolved existing FFmpeg executable through `--ffmpeg-location`; packaged execution must not require an external installation. Preserve validated URLs, public-address HTTPS pinning, Node runtime, cancellation/process ownership and output validation. Temporary separate tracks are never catalog assets: only the validated complete merge is committed. Retry reuses the durable job and resumable parts.

```mermaid
sequenceDiagram
  participant User as Desktop/Agent
  participant Host as Media job owner
  participant Downloader as Bundled yt-dlp
  participant FFmpeg as Bundled FFmpeg
  User->>Host: import URL / explicitly retry
  Host->>Downloader: validated source; HTTPS proxy; best tracks
  Downloader->>FFmpeg: merge audio/video without re-encoding
  FFmpeg-->>Downloader: complete container in private staging
  Downloader-->>Host: validated original and metadata
  Host->>Host: commit account asset and job atomically
  Host-->>User: durable mediaId and actual state
```

Acceptance: tests reject the old combined-only selector and require the resolved FFmpeg path, best-track selection and merge container. Existing tests retain failure/retry, cancellation, restart, original preservation, isolation and output rejection. Test a real source in an isolated temporary directory with bundled tools and probe the completed file for audio/video. Do not mutate the pilot catalog or infer publication success. Report any remaining provider access/rate-limit failure separately.

Official reference: [yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection).

Isolated real-source validation (2026-10-03): with the corrected arguments and the verified packaged `ffmpeg/bin/ffmpeg`, the adapter downloaded, merged and accepted a 205,446,624-byte original. Bundled ffprobe found AV1 video at 3000×2160, Opus audio and 229.301 seconds duration. No subtitles were available in that check. Temporary artifacts were removed and the pilot catalog remained untouched. This verifies intake/merge/output validation; it does not verify the user's model, a real edited Reel, captions, upload or Instagram publication.

The isolated full-download probe also exposed output-template incompatibility: `video:` is not yt-dlp's default output type and became a literal staging subdirectory; an info template ending in `.info.json` gained a second `.info.json` suffix. Use the unprefixed default video template and the recognized `infojson:` template with `%(ext)s`. Keep the parser strict and flat; do not search arbitrary nested files to mask bad argument construction. The fake executable must emulate the upstream default and info filename rules, and tests must assert those templates. A successful transfer alone is insufficient: acceptance requires the parser to return the verified merged original.
