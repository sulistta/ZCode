/** compact 引用旧场景标记但不执行工具；在 mock HTTP 边界区分摘要与当前请求。 */
export function planLocalCompactResponse(body) {
  const message = body.messages?.[0];
  if (
    body.messages?.length !== 1 ||
    message?.role !== "user" ||
    typeof message.content !== "string" ||
    !message.content.startsWith("CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.")
  )
    return undefined;
  return {
    content:
      "<analysis>Earlier isolated fixture actions are complete.</analysis>" +
      "<summary>Continue the current account request using actual tool results. " +
      "Read the accepted project revision before changing it; preserve account isolation " +
      "and publication approval.</summary>",
  };
}
