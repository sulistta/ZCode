import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalMediaPreviewCapabilityUrl } from "@social-harness/shared";
import {
  createLocalMediaPreviewPathRegistry,
  installLocalMediaPreviewProtocol,
} from "./localMediaPreviewProtocol.js";

const TOKEN = "550e8400-e29b-41d4-a716-446655440000";

test("opaque media preview URLs do not expose paths and expire at the registry boundary", async () => {
  let now = 10_000;
  const registry = createLocalMediaPreviewPathRegistry({
    isAbsolutePath: () => true,
    realpath: async (path) => `/canonical${path}`,
    realpathSync: (path) => path,
    isRegularFileSync: () => true,
    now: () => now,
    createToken: () => TOKEN,
  });

  const preview = await registry.createPreviewUrl("/private/social-media/original.mp4");
  assert.equal(preview.url, buildLocalMediaPreviewCapabilityUrl(TOKEN));
  assert.equal(preview.url.includes("social-media"), false);
  assert.equal(preview.expiresAt, 10_000 + 30 * 60 * 1000);
  assert.equal(registry.isAuthorized("/canonical/private/social-media/original.mp4"), false);
  assert.equal(
    registry.resolveCapabilityToken(TOKEN),
    "/canonical/private/social-media/original.mp4",
  );

  now = preview.expiresAt;
  assert.equal(registry.resolveCapabilityToken(TOKEN), null);
});

test("media protocol resolves opaque tokens and authorized paths through the Social Harness scheme", async () => {
  const registry = createLocalMediaPreviewPathRegistry({
    isAbsolutePath: () => true,
    realpath: async (path) => `/canonical${path}`,
    realpathSync: (path) => path,
    isRegularFileSync: () => true,
    now: () => 100,
    createToken: () => TOKEN,
  });
  const issued = await registry.createPreviewUrl("/private/media.mp4");
  assert.equal(issued.url, `social-harness-media://local/preview/${TOKEN}`);
  const legacyPath = await registry.authorize("/legacy/attachment.mp4");
  let handler:
    | ((request: { url: string }, callback: (response: string | { error: number }) => void) => void)
    | undefined;
  const protocol = {
    registerFileProtocol(
      _scheme: string,
      nextHandler: (
        request: { url: string },
        callback: (response: string | { error: number }) => void,
      ) => void,
    ) {
      handler = nextHandler;
      return true;
    },
  };
  installLocalMediaPreviewProtocol(protocol, {
    isPathAuthorized: registry.isAuthorized,
    resolveCapabilityToken: registry.resolveCapabilityToken,
  });
  assert.ok(handler);

  const invoke = (url: string) =>
    new Promise<string | { error: number }>((resolve) => handler!({ url }, resolve));
  assert.equal(await invoke(issued.url), "/canonical/private/media.mp4");
  assert.deepEqual(
    await invoke(buildLocalMediaPreviewCapabilityUrl("550e8400-e29b-41d4-a716-446655440001")),
    {
      error: -300,
    },
  );
  assert.equal(
    await invoke(`social-harness-media://local/preview?path=${encodeURIComponent(legacyPath)}`),
    legacyPath,
  );
});
