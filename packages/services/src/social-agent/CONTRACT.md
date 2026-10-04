# Social Agent context contract

The Host resolves every Agent request from the current validated account workspace identity. A
resolved scope exposes only that account's editorial profile and policy, project summaries, local
publication history, media summaries, YouTube search, and measured clip-candidate evidence. It
contains no filesystem paths or credentials. Account-scoped preparation commands delegate URL
import/job control to the existing media owner, idempotent project creation to the project owner,
and exact-revision export admission to the export owner. Job/export projections omit private source
URLs, account IDs, paths and credential/artifact material. See [the production-command amendment](../../../../specs/social-harness-agent-production.md).

Candidate analysis is transient and read-only. Catalog mutation, project edits, and publication
remain owned by their existing services and contracts. Publication history is marked unavailable
when its owner cannot be read; callers must not replace that state with an invented empty history.

The model performs semantic candidate ranking: it reads this account context before requesting the
media service's measured candidate evidence, then compares that evidence with the editorial profile,
editable memory, and available publication outcomes. The candidate service score is an evidence
shortlist score, not editorial suitability. Recommendations separate measured facts from editorial
judgment, cite timestamps and returned evidence, and preserve unavailable inputs as unknown. Podcast
judgments use measured phrase, context, and pause evidence; music judgments use measured audio
structure/rhythm and sparse visual evidence without requiring speech. Analysis remains read-only and
does not persist learned preferences or project changes.
