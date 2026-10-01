import assert from "node:assert/strict";
import test from "node:test";
import { createClientConfigService } from "../src/client-config/clientConfigService.js";

test("client config uses the bundled plugin order and needs no remote endpoint", async () => {
  const service = createClientConfigService();

  assert.deepEqual(await service.getSnapshot(), { pluginStoreOrder: null });
  assert.deepEqual(await service.getSnapshot({ forceRefresh: true }), { pluginStoreOrder: null });
});
