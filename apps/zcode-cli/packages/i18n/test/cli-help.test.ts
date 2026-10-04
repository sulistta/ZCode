import assert from "node:assert/strict";
import { test } from "node:test";
import { getZCodeCopy } from "../src/index.js";

test("localized headless CLI help uses the Social Harness product identity", () => {
  const helpByLocale = [
    {
      locale: "en-US",
      expected: "app-server Run the Social Harness Agent stdio server",
      internalDescription: "internal headless Agent runtime",
    },
    {
      locale: "zh-CN",
      expected: "app-server 运行 Social Harness Agent stdio 服务",
      internalDescription: "内部 headless Agent runtime",
    },
  ] as const;

  for (const { locale, expected, internalDescription } of helpByLocale) {
    const help = getZCodeCopy(locale).cli.help("test");

    assert.ok(help.includes(expected), `${locale} help should describe the internal Agent server`);
    assert.ok(!help.includes("ZCode Protocol"), `${locale} help should not expose the retired brand`);
    assert.ok(help.includes(internalDescription));
  }
});
