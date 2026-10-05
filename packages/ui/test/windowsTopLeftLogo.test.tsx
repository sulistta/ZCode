import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WindowsTopLeftLogo } from "../src/WindowsTopLeftLogo.js";

test("Windows titlebar identifies the Social Harness product instead of a provider", () => {
  const markup = renderToStaticMarkup(createElement(WindowsTopLeftLogo));

  assert.match(markup, /Social Harness/);
  assert.doesNotMatch(markup, /<img\b/);
});
