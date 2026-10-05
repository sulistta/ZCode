function parseToolContent(content) {
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  if (Array.isArray(content)) {
    const text = content.find((item) => item && typeof item.text === "string")?.text;
    return text === undefined ? content : parseToolContent(text);
  }
  if (content && typeof content === "object" && typeof content.text === "string")
    return parseToolContent(content.text);
  return content;
}

const contextOpen = "<social-harness-fixture-context>";
const contextClose = "</social-harness-fixture-context>";
const maxContextCharacters = 256_000;

/** 摘要只携带本次请求已读事实；不能靠 mock 服务端缓存补造 tool 结果。 */
export function serializeFixtureContext(request, results) {
  const payload = JSON.stringify({ request, results })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  if (payload.length > maxContextCharacters) throw new Error("Fixture summary exceeds its bound");
  return `${contextOpen}${payload}${contextClose}`;
}

function summarizedResults(content) {
  if (typeof content !== "string") return [];
  const start = content.indexOf(contextOpen);
  const end = content.indexOf(contextClose, start);
  if (start < 0 || end < 0 || end - start > maxContextCharacters + contextOpen.length) return [];
  try {
    const payload = JSON.parse(content.slice(start + contextOpen.length, end));
    if (typeof payload.request !== "string" || !Array.isArray(payload.results)) return [];
    return payload.results.filter((result) => result && typeof result.name === "string");
  } catch {
    return [];
  }
}

/** Provider-shaped fixture results retain their actual tool-call association. */
export function collectToolResults(messages) {
  const toolNamesById = new Map();
  for (const message of messages ?? []) {
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.id && toolCall.function?.name)
        toolNamesById.set(toolCall.id, toolCall.function.name);
    }
  }
  return (messages ?? []).flatMap((message) =>
    message.role === "tool"
      ? [
          {
            name: message.name ?? toolNamesById.get(message.tool_call_id),
            content: parseToolContent(message.content),
          },
        ]
      : message.role === "user"
        ? summarizedResults(message.content)
        : [],
  );
}
