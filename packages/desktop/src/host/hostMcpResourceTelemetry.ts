import type { IDisposable } from "@social-harness/rpc";
import type { IZCodeAgentService } from "@social-harness/services";
import { HostResponseTypes, type ProcessResourceRuntimeSurface } from "@social-harness/shared";

export function registerHostMcpResourceTelemetry(options: {
  agentService: Pick<IZCodeAgentService, "onDynamicMcpResourceSamples">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
}): IDisposable {
  return options.agentService.onDynamicMcpResourceSamples()((samples) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpResourceSamples,
        runtimeSurface: options.runtimeSurface,
        ...(options.environmentKey === undefined ? {} : { environmentKey: options.environmentKey }),
        samples,
      });
    } catch {
      // main 已退出或 IPC 关闭时只丢当前资源事实，不影响 MCP 生命周期。
    }
  });
}
