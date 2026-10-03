# User-owned Convex Instagram bridge

This amendment supersedes the maintainer-operated bridge and build-time bridge URL in the migration spec. Keep account deletion deferred and retain the internal headless Agent; terminal product distribution stays retired.

## Product and ownership

Each user owns a dedicated Convex project and their own Meta Instagram Login application. One production deployment serves that user's accounts. Desktop installs all provisioning tools. Every connection uses outbound HTTPS; no router, incoming local port, tunnel, Docker, external Node or CLI is required. There is no maintainer-operated service, shared secret, billing enrollment or automatic upgrade.

| State                                                              | Single owner                     | Persistence / interface                                                            |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| Accounts, projects, conversations, approvals, publication attempts | Existing Desktop Host services   | Existing revisioned contracts and local stores                                     |
| Non-secret deployment identity and setup progress                  | Social-publishing Host           | Versioned local bridge configuration; setup RPC projection                         |
| Installation credential and Meta account tokens                    | Host through Main secure adapter | OS encrypted vault; never Renderer/Agent/settings/log persistence                  |
| Provisioning credential                                            | Host for one setup operation     | Memory only; discarded after deployment; user supplies again for updates           |
| Meta App Secret                                                    | User's Convex deployment         | Environment variable set through Host provisioning or directly in Convex dashboard |
| OAuth state, callback claim, ticket, account media credential      | Convex mutations                 | Expiring transactional tables, hashes and installation/account binding             |
| Approved temporary media and upload reservations                   | Convex                           | Storage + lease records; scheduled cleanup and orphan sweep                        |

The setup RPC carries non-secret project/deployment data, an ephemeral provisioning credential input, safe stage/error codes and copyable callback/variable names. Secrets are never returned. Renderer uses an uncontrolled password input cleared on submission, with no store, configuration persistence or error logging. Agent contracts do not expose setup. Main secure-storage failure fails closed. Daily requests authenticate with a random installation credential, never a Convex administrative/deploy token. Account media credentials remain separately scoped to that installation/account. Provisioning serializes with itself; configuration changes cannot race a pending OAuth or publication. Switching deployments while accounts are connected requires disconnecting them first; reconnecting the same deployment keeps valid business data and account tokens.

## Assistant and provisioning

1. Explain Free quotas and dedicated project ownership; open the Convex dashboard in the system browser. Accept a production deployment key with only `deployment:deploy`, `deployment:env:write`, `deployment:data:view`, `deployment:functions:runInternalQueries`, `deployment:functions:runInternalMutations`. Alternatively a temporary team token lets the official Management API create a dedicated project and production deployment and mint an expiring deployment-scoped key. No team token is retained. Project creation with an uncertain response is reconciled by listing projects before retry rather than blindly duplicating it.
2. Deploy the bundled, pinned backend through the bundled official Convex CLI using the Desktop's existing embedded Node runtime. No dependency install or runtime download is performed on the user's machine. Deploy only to the selected dedicated project; refuse a deployment with unrelated tables/functions. Bootstrap/rotate the installation through an internal mutation authorized by the temporary deploy key. Commit local configuration only after deployment and secure installation-credential storage succeed. Failures retain the last working configuration and offer retry. Administrative credentials never become daily authorization.
3. Open Meta's application dashboard and instruct the user to select Instagram → API setup with Instagram Login → Business login settings. Copy the exact `https://<deployment>.convex.site/v1/instagram/callback` into Valid OAuth redirect URIs. Use Instagram App ID/Secret from that section, which can differ from the parent Facebook app. Configure `META_INSTAGRAM_APP_ID` and `META_INSTAGRAM_APP_SECRET` in the Convex deployment's Environment Variables panel. The user may enter the App Secret and provisioning key in transient password fields cleared on submission. Host writes the variables through the official Deployment API and retains neither secret. Alternatively configure the variables directly in the Convex dashboard; no secret is returned to Desktop. Provide specific dashboard links and copy buttons for callback and variable names.
4. Validate backend version, authenticated installation and required Meta variables. This verifies configuration presence and bridge access, not valid Meta credentials or App Review. Start Instagram Login in the system browser; only successful code exchange + verified profile + secure local token commit prove authentication. Display final OAuth success separately from provisioning readiness. Development-mode accounts need app roles/tester acceptance; accounts outside app roles require Meta review/Advanced Access. Publication validation needs a real approved export and real Meta response.

## Event order and authentication

```mermaid
sequenceDiagram
    participant UI as Desktop assistant (drafts)
    participant Host as Host (business + config)
    participant Vault as Main / OS vault
    participant CV as User Convex (bridge only)
    participant Browser as System browser
    participant Meta as User Meta app
    UI->>Host: provision dedicated project (temporary credential)
    Host->>CV: deploy bundled backend; internal bootstrap mutation
    Host->>Vault: store installation credential
    Host->>Host: commit non-secret deployment identity
    UI->>Browser: open Meta and Convex settings + copy callback
    Host->>CV: authenticated setup validation
    UI->>Host: connect account
    Host->>CV: installation auth + account + state + S256 challenge
    CV->>CV: mutation inserts expiring state
    Host-->>UI: authorization URL + opaque state
    UI->>Browser: register state; open Instagram Login
    Browser->>Meta: consent
    Meta->>CV: HTTPS callback with code/state
    CV->>CV: mutation atomically claims state once
    CV->>Meta: code exchange using user's App Secret
    CV->>CV: mutation creates expiring ticket
    CV->>Browser: social-harness deep link with opaque ticket
    Browser->>Host: existing Desktop callback route
    Host->>CV: installation auth + ticket + verifier
    CV->>CV: atomic expiry/binding/PKCE validation + consume + issue account key
    CV-->>Host: Meta token + account upload credential
    Host->>Meta: verify profile
    Host->>Vault: commit secure account credentials
    Host->>Host: persist profile; revoke previous key after commit
```

Five-minute states and tickets survive Convex workers but expire by timestamp. Callback claims atomically before exchanging codes; a failed external exchange requires a new flow. Ticket consumption and account-key creation are one mutation: concurrent redemption has exactly one winner. Wrong installation, wrong verifier, expiry and replay fail without issuing a key. Random bearer credentials are stored as SHA-256 hashes only. All public mutations/HTTP routes authenticate installation or account credentials; internal mutations are not public. Reconnect preserves prior key until Host commit and then revokes it; failed profile/persistence revokes only the new key. Disconnect revokes that installation/account's keys and leases. Redeploying the same project reuses its securely stored installation credential and preserves account bindings. Host account credentials carry the deployment origin and a hash of the installation identity. If the installation identity is lost/replaced, old account tokens remain secure but project as reconnection required; origin equality alone cannot validate a different installation. No other installation/account can redeem, finalize, delete or revoke these resources.

## Media and capacity

Host validates approval, immutable completed export, digest, MP4 metadata and existing 1,073,741,824-byte product ceiling. Convex authenticates account + installation and reserves one active upload per account with an idempotency key, expected SHA-256, size and a two-hour lease. Desktop sends the Blob directly to `storage.generateUploadUrl()` (POST), then finalizes with storage ID. Finalization atomically checks reservation, ownership, expiry, `_storage` metadata size/type/SHA-256, and returns the HTTPS storage URL only to Host. Refuse a storage ID already bound to another lease; never delete a foreign object on an invalid finalization. Failed/abandoned uploads, expired reservations, disconnected accounts and terminal publication delete associated media; an internal sweep removes unassociated storage objects after the upload URL's one-hour lifetime plus margin. Idempotent retry returns a finalized lease without uploading again. Direct storage URLs remain readable until storage deletion; scheduled deletion is the expiry enforcement and cannot promise exact revocation while the provider is unavailable. Failed cleanup is retried and surfaced safely.

Official validation on 2026-10-02: [Free/Starter limits](https://docs.convex.dev/production/state/limits) distinguish hard Free caps from Starter pay-as-you-go. Free includes 1 GB file storage (including backups), 1 GB file egress/month, 0.5 GB database, 1 GB database I/O/month, 1M function calls/month, 20 GB-hours actions/month, 40 deployments, up to 6 developers. Limits apply to the team. [Convex's own article](https://stack.convex.dev/matrix-building-a-real-time-rpg-game-with-convex) describes starting without a card; [Starter announcement](https://news.convex.dev/introducing-the-new-convex-starter-plan-pay-for-only-what-you-need/) requires card registration for paid excess. Free is the default path; dashboard signup/eligibility remains a live pilot check. No SLA is promised for Free.

[Upload URLs](https://docs.convex.dev/file-storage/upload-files) permit arbitrary file size with a two-minute POST timeout and expire after one hour. There is no separate 1 GB per-file Convex ceiling. The 1 GiB Social Harness maximum cannot be guaranteed to fit the nominal 1 GB Free team allowance and may require user-provided capacity. The limits page does not specify byte accounting for GB; interpreting GB as decimal puts the 1 GiB maximum above the allowance, while even binary accounting leaves no room for other files/backups. This is a capacity inference, not a separate provider per-file restriction; even smaller videos can exhaust monthly egress after Meta fetches/retries. The wizard and publication UI must distinguish supported file size from available capacity. Never silently change the size contract, compress quality or activate a paid plan. No authoritative team-wide remaining-capacity value is invented from this project's lease counter. Provider quota/disabled responses become actionable `capacity-unavailable`; network timeout/upload failure remains distinct. The user can retry after deleting temporary files or after the provider restores/monthly renews capacity. Link the team's Usage panel; do not label a local estimate as team capacity.

## Migration and acceptance

Stop embedding/reading the central bridge origin. Production Desktop can build without a bridge URL. Existing business state is preserved. Legacy account credentials remain local until explicit disconnect/reconnect; they cannot authorize the new project. The Host projects reconnection required when the credential belongs to an obsolete bridge. No automatic remote import or deletion occurs. Old Node bridge code may remain as a migration reference/test fixture but is not a shipped hosting requirement.

Required evidence: setup from empty config; existing dedicated project; optional project creation; retry/relaunch without duplicate creation; invalid/revoked provisioning key; failed deployment/bootstrap/vault leaves prior config; no secrets in projections/config/logs; installed runtime assets without external tools; connected-account guard on switching; same-project reconnect and credential rotation; absent/invalid Meta setup; cross-installation/account rejection; atomic parallel redemption; expired/wrong-verifier/replayed tickets; failed/timeout/quota upload; wrong size/hash/type/storage ownership; idempotent upload; account disconnect and publication cleanup; scheduled expiry and orphan sweep; wizard desktop E2E with copyable callback and clear stages; typecheck/lint/architecture checks. Real Convex deployment, real Meta authentication and real publication remain explicitly unproven until run with user-owned pilot credentials.

Provisioning uses the separate `ISocialInstagramSetupService` RPC channel. Publishing/Agent contracts expose no setup command. Desktop continuous events and mobile replayable attachment semantics are unchanged; remote clients without the secure Desktop adapter expose neither setup nor publishing. Both read the same Host business owner. Failed or denied Meta exchange returns a denial ticket to Desktop so the Host immediately clears pending authorization and permits retry.

Assistant readiness is published only after the connection owner refreshes bridge availability; an enabled login button must not race stale availability. Local runtime preparation verifies the backend template fingerprint and target-native bundler, rather than accepting a stale manifest from a previous checkout. UI acceptance uses an isolated Electron profile: deployment error/retry, creation mode, copied callback, cleared secret fields, Meta-variable configuration, capacity error/retry, and distinct bridge-ready versus OAuth-connected states. Fixture services establish interaction semantics, not real cloud deployment or Meta validation.

Bundled runtime dependencies resolve relative to their actual parent package, including binary-only optional packages. The esbuild JavaScript API and native executable must have the same pinned version. Notice generation lists only supported optional targets (Windows/macOS/Linux, x64/arm64); excluded optional architectures are recorded separately and cannot hide a missing supported dependency.

Native package acceptance also runs the same Convex CLI/backend smoke against the packaged executable and its actual `resources/convex-provisioner` directory. It must not resolve CLI dependencies from the repository's `node_modules`. On Linux the runtime smoke uses the unpacked payload produced by the same installer build; the AppImage is separately launched for account/assistant persistence. Windows/macOS use the executable installed/copied by the native package smoke. The packaged account surface must expose the Convex setup assistant and its deployment action before and after relaunch.

Provisioner runtime dependencies are an explicit installer resource mapping rooted at their staged dependency directory. The packager's generic resource filter omits a child directory named `node_modules`; copying only the parent manifest/template is insufficient. `afterPack` must verify the complete provisioner against the pinned template/native target and refuse missing or stale dependencies before producing an installer.

Host setup admission blocks throughout authorization command admission/profile commit and publication admission/background runners, including startup recovery. Publication activity is read from the existing workflow owner; no second publication queue or business-state copy is added. Once setup is admitted, new authorization/publication writes fail with `bridge-setup-busy` until the operation finishes.

## Validation evidence — 2026-10-02

- Focused unit/contract coverage passed: 25 bridge tests (16 legacy and 9 transactional Convex), 57 service/vault/identity/runtime-dependency tests, and 16 Desktop deep-link tests. Coverage includes provisioning reconciliation/retry, safe invalid-credential/capacity errors, admission races, installation replacement, atomic ticket consumption, account isolation, direct upload failures, foreign-storage rejection and cleanup. External API responses in these suites are controlled fixtures.
- `test:convex-runtime` passed using the embedded Electron Node runtime, pinned Convex CLI and target-native esbuild, compiling all five backend modules. No external user-installed tool is needed for this smoke.
- Current-source Linux x64 Preview AppImage and Debian packages built successfully. The packaged runtime smoke passed against the unpacked installer payload and separately against the extracted Debian payload. Both AppImage and Debian payload passed account/assistant/relaunch smoke under Xvfb, including the deployment action and untouched legacy sentinel. This is package-payload execution, not package-manager installation or a signed production release. The first package test detected the omitted CLI dependency directory; the explicit resource mapping and `afterPack` gate corrected it and the rebuilt packages passed.
- `test:instagram-setup-e2e` passed in an isolated Electron profile under Xvfb. It verifies creation/deployment retry, quota retry, callback copying, transient secret clearing, Meta setup, readiness ordering and a separate simulated OAuth completion.
- The full `test:social-harness-e2e` passed all three isolated Electron launches on Linux, including account/media/project isolation, automation and local-model settlement, Agent editing, preview/export visual and audio parity, and persisted state after relaunch. The legacy data sentinel stayed unchanged. A prior run encountered translation hot-reload context invalidation while UI source was being edited; another exposed the combined publication-limit paragraph, which was separated and retested successfully.
- Root `pnpm typecheck`, `pnpm fmt:check`, `pnpm architecture:check --changed` and `git diff --check` passed. Architecture reports zero violations. `pnpm lint` passes with the same 54 existing warnings and zero errors.
- Regular third-party inventory validation passed. Strict production material review still fails on the same 11 previously recorded gaps, with no new production gap introduced by Convex; five development-only reviews remain separately recorded. This work does not claim that production release gate is closed.
- Not executed: actual Convex account signup/card eligibility, Management API provisioning/deployment against a real team, Meta dashboard callback acceptance, real OAuth/code exchange/profile and Reel publication, actual large-file transfer/free-capacity exhaustion, or current-change Windows/macOS installer/native execution. The user-owned pilot project and Meta app credentials are not ready. Backend-presence validation is not proof of a working Meta app.
