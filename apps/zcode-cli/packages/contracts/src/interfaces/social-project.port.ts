import type {
  SocialProjectAgentOperation,
  SocialProjectCommandResult,
  SocialProjectReadModel,
  SocialProjectSummary,
} from "@social-harness/shared";
import type { TraceContext } from "../tracing/tracer.js";

export interface SocialProjectCommandInput {
  commandId: string;
  expectedRevision: number;
  operation: SocialProjectAgentOperation;
  projectId: string;
}

export interface SocialProjectPort {
  list(options?: { signal?: AbortSignal; traceContext?: TraceContext }): Promise<SocialProjectSummary[]>;
  get(
    projectId: string,
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialProjectReadModel | null>;
  executeCommand(
    input: SocialProjectCommandInput,
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialProjectCommandResult>;
}
