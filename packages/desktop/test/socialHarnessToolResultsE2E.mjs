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

/** Provider-shaped fixture results retain their actual tool-call association. */
export function collectToolResults(messages) {
  const toolNamesById = new Map();
  for (const message of messages ?? []) {
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.id && toolCall.function?.name)
        toolNamesById.set(toolCall.id, toolCall.function.name);
    }
  }
  return (messages ?? [])
    .filter((message) => message.role === "tool")
    .map((message) => ({
      name: message.name ?? toolNamesById.get(message.tool_call_id),
      content: parseToolContent(message.content),
    }));
}
