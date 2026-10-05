/** 只记录隔离 fixture 的协议形状，不保存正文、参数、凭据或请求头。 */
export function describeFixtureModelRequests(requests) {
  return requests.map((request, index) => ({
    index,
    compact:
      request.messages?.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.startsWith("CRITICAL: Respond with TEXT ONLY. Do NOT call any tools."),
      ) ?? false,
    messages: (request.messages ?? []).map((message) => ({
      role: message.role,
      contentCharacters: typeof message.content === "string" ? message.content.length : undefined,
      toolCallId: message.tool_call_id,
      toolName: message.name,
      calls: message.tool_calls?.map((call) => ({ id: call.id, name: call.function?.name })),
    })),
  }));
}
