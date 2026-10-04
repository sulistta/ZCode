# debug

Development-only trace and context viewer for the Social Harness headless Agent.

Run from the repository root:

```sh
pnpm --filter debug dev
```

The Hono API reads existing local diagnostics only:

- `~/.social-harness/v1/cli/log/*.jsonl`
- `~/.social-harness/v1/cli/db/db.sqlite`
- an optional session event JSONL file or directory selected in the UI

It does not modify agent runtime behavior or write back to the agent database.

The debug server also starts a local network capture proxy by default:

- API/UI: `http://127.0.0.1:4174`
- Proxy: `http://127.0.0.1:4184`
- Local CA: `apps/zcode-cli/packages/debug/certs/network-ca/certs/ca.pem`

Run the CLI you want to inspect with the environment values shown in the Network panel, usually `SOCIAL_HARNESS_HTTP_PROXY` and `SOCIAL_HARNESS_AGENT_CA_CERT`. The agent derives standard proxy and CA variables only inside controlled subprocess boundaries. Disable the proxy with `SOCIAL_HARNESS_DEBUG_NETWORK_CAPTURE=0` when you only want log/DB inspection.
