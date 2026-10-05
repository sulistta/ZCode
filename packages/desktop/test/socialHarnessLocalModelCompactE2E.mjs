import { collectToolResults, serializeFixtureContext } from "./socialHarnessToolResultsE2E.mjs";

/** compact 会携带完整旧历史；只看末尾摘要指令，避免再次规划其中的场景工具。 */
export function planLocalCompactResponse(body, scenarioMarkers = []) {
  const message = body.messages?.at(-1);
  if (
    message?.role !== "user" ||
    typeof message.content !== "string" ||
    !message.content.startsWith("CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.")
  )
    return undefined;
  const history = body.messages.slice(0, -1);
  const requestStart = history.findLastIndex(
    (entry) =>
      entry.role === "user" &&
      scenarioMarkers.some((marker) => JSON.stringify(entry).includes(marker)),
  );
  const facts =
    requestStart < 0
      ? ""
      : serializeFixtureContext(
          typeof history[requestStart].content === "string"
            ? history[requestStart].content
            : JSON.stringify(history[requestStart].content),
          collectToolResults(history.slice(requestStart)),
        );
  return {
    content:
      "<analysis>Earlier isolated fixture actions are complete.</analysis>" +
      "<summary>Continue the current account request using actual tool results. " +
      "Read the accepted project revision before changing it; preserve account isolation " +
      `and publication approval. ${facts}</summary>`,
  };
}
