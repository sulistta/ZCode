import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDynamicWorkflowClientConfig,
  SOCIAL_HARNESS_DYNAMIC_WORKFLOW_MODE_ENV,
} from "../src/dynamic-workflow-feature.js";

test("dynamic workflow mode uses only the Social Harness local override", () => {
  assert.deepEqual(resolveDynamicWorkflowClientConfig({}), {
    mode: "disabled",
    enabled: false,
    source: "default",
  });
  assert.deepEqual(
    resolveDynamicWorkflowClientConfig({
      env: {
        [SOCIAL_HARNESS_DYNAMIC_WORKFLOW_MODE_ENV]: "alwaysOn",
        ZCODE_DYNAMIC_WORKFLOW_MODE: "onDemand",
      },
    }),
    { mode: "alwaysOn", enabled: true, source: "override" },
  );
});
