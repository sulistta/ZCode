# Social Agent context contract

The Host resolves every Agent request from the current validated account workspace identity. A
resolved scope exposes only that account's editorial profile and policy, project summaries, local
publication history, media summaries, YouTube search, and measured clip-candidate evidence. It
contains no filesystem paths, credentials, or write operations.

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
