import assert from "node:assert/strict";
import test from "node:test";
import { indicatorDataUrl } from "./windowsCuaOperationIndicatorContent.js";

test("the Windows operation indicator uses Social Harness copy", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const url = indicatorDataUrl(locale);
    const html = Buffer.from(url.slice("data:text/html;base64,".length), "base64").toString("utf8");
    assert.match(html, /Social Harness/u);
    assert.doesNotMatch(html, /ZCode/u);
  }
});
