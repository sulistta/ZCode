# Social Harness Instagram bridge

The Desktop deploys `src/adapters/convex` into a dedicated Convex project owned by each user. The user also owns the Meta application. There is no central bridge, shared maintainer secret or infrastructure billing operated by Social Harness. The current rules, ownership diagram, migration and acceptance scenarios are in [the Convex specification](../../specs/social-harness-convex.md) and [this package's contract](CONTRACT.md).

## Setup through Desktop

1. Open the Instagram setup assistant on Accounts. Choose an existing dedicated production deployment and supply its temporary deployment key, or supply a temporary team access token to create/reconcile a dedicated project through the official Convex Management API. Use the Free plan initially; provisioning never enrolls billing or upgrades a plan.
2. The Desktop deploys the bundled backend with its embedded runtime and bundled official CLI. It bootstraps a random installation credential, stores it through Main's OS vault and saves only non-secret deployment configuration. The provisioning credential is discarded and is not used for daily operations. No external Node, CLI, Docker or tunnel is required.
3. In the user's Meta app, open Instagram → API setup with Instagram Login → Business login settings. Register the exact callback shown by the assistant: `https://<deployment>.convex.site/v1/instagram/callback`. Use the Instagram App ID/Secret from that section. Configure `META_INSTAGRAM_APP_ID` and `META_INSTAGRAM_APP_SECRET` in the user's Convex deployment, either through the assistant's transient inputs or directly in its Environment Variables panel. Do not put the App Secret in Desktop build variables, settings or repository files.
4. Validate the bridge and required variables, then connect the account in the system browser. Development-mode accounts need accepted tester/app roles; accounts outside those roles require the permissions/review Meta specifies. Successful bridge validation alone does not prove valid Meta credentials, OAuth or publication.

The assistant links [Convex's dashboard](https://dashboard.convex.dev/) and [Meta's app dashboard](https://developers.facebook.com/apps/), supplies copyable callback/environment names and distinguishes provisioning readiness from an authenticated Instagram account. An eligible Creator or Business account is required. All Desktop traffic uses outgoing HTTPS; users do not configure their router or expose a local port.

## Security, media and Free capacity

Convex stores only temporary OAuth flows/tickets, hashed installation/account credentials and approved temporary media. Tickets expire after five minutes and validation/consumption is atomic, installation/account/PKCE-bound and single-use. Meta account tokens and all business state remain with the Host and OS vault.

The Desktop uploads an approved MP4 directly to an authorized Convex storage URL. Finalization validates ownership, size, MIME and SHA-256 before returning a public HTTPS read URL for Meta. Publication/disconnect cleanup, lease expiry and an orphan sweep remove temporary objects. A provider outage can delay physical deletion; URLs are revoked by deleting their storage objects.

The product accepts up to 1,073,741,824 bytes per file. This is separate from available team capacity. Convex documents Free allowances of 1 GB file storage and 1 GB monthly file egress shared by the team; a maximum-size video can exhaust or exceed that allowance. Direct uploads also have a two-minute POST timeout. The app never silently reduces video quality or enables paid usage. Capacity errors explain the obstruction and allow retry when capacity is available. See the dated official-source assessment in [the specification](../../specs/social-harness-convex.md).

## Repository validation and legacy fixture

From the repository root, `pnpm --filter @social-harness/social-auth-bridge test` runs the legacy Node tests and transactional Convex tests. `pnpm --filter @social-harness/desktop test:convex-runtime` checks the bundled CLI/backend; `test:instagram-setup-e2e` checks the assistant in an isolated Electron fixture. These do not replace a real user-owned deployment, Meta OAuth and approved Reel publication.

The original Node/Hono server, Docker Compose files and `/healthz` smoke remain migration/regression fixtures. They are not used by the Desktop integration and are not an installation or hosting requirement. Earlier central-bridge build configuration is superseded.
