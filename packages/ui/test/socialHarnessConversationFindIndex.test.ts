import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantTextRow } from "@social-harness/shared/zcode-protocol-v4";
import type { ConversationTurnRenderUnit } from "../src/v4/conversationTurnRenderUnits.js";
import { buildConversationFindIndex } from "../src/v4/conversationFindIndex.js";

test("assistant review directives remain visible in conversation search", () => {
  const assistantText =
    ':::code-comment{title="Review" body="Keep this scoped prompt visible." file="src/social.ts" start="14"}';
  const row = {
    kind: "assistantText",
    rowId: 7,
    text: assistantText,
    state: "complete",
  } as AssistantTextRow;
  const unit = {
    visibleUserInputs: [],
    assistantTextRows: [row],
  } as unknown as ConversationTurnRenderUnit;

  const index = buildConversationFindIndex([unit], "scoped prompt");

  assert.equal(index.matchCount, 1);
  assert.equal(index.matches[0]?.sourceText, assistantText);
});
