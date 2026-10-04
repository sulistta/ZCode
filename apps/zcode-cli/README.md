# Internal Agent runtime

This workspace contains the headless Agent process used by Social Harness Desktop and server orchestration. It is not a user-facing terminal product and has no standalone installer or release pipeline.

Run workspace commands from the repository root:

```sh
pnpm --filter @social-harness/cli dev -- app-server
pnpm --filter @social-harness/cli... build
```

The build produces the internal CommonJS bundle consumed by Desktop and server hosts. Product UI, account state, and user configuration belong to the host application; this package provides Agent execution and protocol handling.
