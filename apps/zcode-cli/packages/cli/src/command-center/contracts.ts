import type { ModelSelection, ZCodeModelOption } from "@social-harness/shared";
import type { SupportedLocale } from "@social-harness/i18n";
import type {
  CollaborationMode,
  InputDelivery,
  ModelUsageSummary,
  PermissionBrokerRequest,
  PermissionBrokerRequestOptions,
  PermissionBrokerResult,
  SessionEvent,
  SessionProjection,
  ToolResultDisplayPayload,
  TurnId,
  TurnSteerResult,
  UiThemePreference,
} from "@social-harness/contracts";

export type CommandCenterMode = CollaborationMode;
export type SwitchableCommandCenterMode = Extract<
  CollaborationMode,
  "plan" | "build" | "edit" | "yolo"
>;

export type CommandCenterPromptAttachment = {
  type: "file" | "image" | "pdf" | "url";
  path?: string;
  content?: string;
};

export type CommandCenterPromptInput =
  | string
  | {
      text: string;
      attachments?: CommandCenterPromptAttachment[];
      modelSelection?: ModelSelection;
    };

export type CommandCenterEffortOption = {
  description?: string;
  id: string;
  label: string;
};

export type CommandCenterSelectionItem = {
  command: string;
  disabledReason?: string;
  id: string;
  input?: {
    cancelStatus?: string;
    clearStatus?: string;
    emptyStatus?: string;
    help?: string;
    mask?: boolean;
    placeholder?: string;
    primary: string;
    secondary?: string;
    status?: string;
    submitStatus?: string;
  };
  keywords?: readonly string[];
  meta?: string;
  pending?: {
    cancelStatus?: string;
    help?: string;
    primary: string;
    secondary?: string;
    status?: string;
  };
  primary: string;
  secondary?: string;
};

export type CommandCenterSelection = {
  emptyMessage: string;
  filterable?: boolean;
  help?: string;
  items: CommandCenterSelectionItem[];
  placement?: "action" | "composer";
  prompt: string;
  selectedIndex?: number;
  title: string;
};

export type CommandCenterRestoredTranscriptPart =
  | { text: string; type: "text" | "thought" }
  | {
      error?: string;
      input: Record<string, unknown>;
      output?: string;
      resultDisplay?: ToolResultDisplayPayload;
      status: "pending" | "running" | "completed" | "failed";
      title?: string;
      toolCallId: string;
      toolName: string;
      type: "tool";
    };

export type CommandCenterSubmitPromptResult = {
  effortOptions?: readonly CommandCenterEffortOption[];
  modelOptions?: readonly ZCodeModelOption[];
  locale?: SupportedLocale;
  loginRequired?: boolean;
  mode?: CollaborationMode;
  model?: string;
  theme?: UiThemePreference;
  projection?: Partial<Pick<SessionProjection, "contextUsed" | "contextWindow">>;
  response: string;
  resetSessionProjection?: boolean;
  restoredMessages?: Array<{
    id?: string;
    content: string;
    parts?: CommandCenterRestoredTranscriptPart[];
    role: "agent" | "system" | "user";
  }>;
  selection?: CommandCenterSelection;
  sessionId?: string;
  thoughtLevel?: string;
  traceId?: string;
  turnId?: string;
  usage?: ModelUsageSummary;
};

export type CommandCenterRequestPermission = (
  request: PermissionBrokerRequest,
  options?: PermissionBrokerRequestOptions,
) => Promise<PermissionBrokerResult>;

export type CommandCenterSubmitPromptOptions = {
  abortSignal: AbortSignal;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
  requestPermission?: CommandCenterRequestPermission;
};

export type CommandCenterSubmitPrompt = (
  prompt: CommandCenterPromptInput,
  options: CommandCenterSubmitPromptOptions,
) => Promise<CommandCenterSubmitPromptResult>;

export type CommandCenterSendInputOptions = {
  abortSignal?: AbortSignal;
  delivery?: InputDelivery;
  expectedTurnId?: TurnId;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
  requestPermission?: CommandCenterRequestPermission;
};

export type CommandCenterSendInputResult =
  | { kind: "started_turn"; result: CommandCenterSubmitPromptResult }
  | { kind: "command_result"; result: CommandCenterSubmitPromptResult }
  | TurnSteerResult;

export type CommandCenterSlashCommandSuggestion = {
  aliases?: readonly string[];
  name: string;
  summary: string;
  usage: string;
};
