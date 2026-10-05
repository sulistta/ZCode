import type { Event } from "@social-harness/rpc";
import type {
  CreateSocialProjectRequest,
  SocialProject,
  SocialProjectAgentCommand,
  SocialProjectAgentScope,
  SocialProjectCommandRequest,
  SocialProjectCommandResult,
  SocialProjectExportCancelRequest,
  SocialProjectExportDownload,
  SocialProjectExportDownloadRequest,
  SocialProjectExportJob,
  SocialProjectExportRequest,
  SocialProjectAgentOperation,
  SocialProjectHistoryEntry,
  SocialProjectReadModel,
  SocialProjectSummary,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type {
  CreateSocialProjectRequest,
  SocialProject,
  SocialProjectAgentCommand,
  SocialProjectAgentScope,
  SocialProjectClip,
  SocialProjectCommandRequest,
  SocialProjectCommandResult,
  SocialProjectAgentOperation,
  SocialProjectHistoryEntry,
  SocialProjectReadModel,
  SocialProjectKeyframe,
  SocialProjectSettings,
  SocialProjectSummary,
  SocialProjectTrack,
  SocialProjectExportCancelRequest,
  SocialProjectExportDownload,
  SocialProjectExportDownloadRequest,
  SocialProjectExportJob,
  SocialProjectExportRequest,
} from "@social-harness/shared";

export type SocialProjectChange = {
  accountId: string;
  projectId: string;
  revision: number;
  editControlOwner: SocialProject["editControlOwner"];
};

export type SocialProjectExportChange = {
  accountId: string;
  exportId: string;
  projectId: string;
  status: SocialProjectExportJob["status"];
  progressPercent: number;
};

export interface ISocialProjectService {
  list(accountId: string): Promise<SocialProjectSummary[]>;
  get(accountId: string, projectId: string): Promise<SocialProjectReadModel | null>;
  create(request: CreateSocialProjectRequest): Promise<SocialProjectReadModel>;
  executeCommand(request: SocialProjectCommandRequest): Promise<SocialProjectCommandResult>;
  startExport(request: SocialProjectExportRequest): Promise<SocialProjectExportJob>;
  getExport(accountId: string, exportId: string): Promise<SocialProjectExportJob | null>;
  listExports(accountId: string, projectId?: string): Promise<SocialProjectExportJob[]>;
  cancelExport(request: SocialProjectExportCancelRequest): Promise<SocialProjectExportJob>;
  prepareExportDownload(
    request: SocialProjectExportDownloadRequest,
  ): Promise<SocialProjectExportDownload>;
  agentScope(workspaceIdentity: string): Promise<SocialProjectAgentScope | null>;
  onChanged: Event<SocialProjectChange>;
  onExportChanged: Event<SocialProjectExportChange>;
}

export const ISocialProjectService = createServiceDescriptor<ISocialProjectService>(
  ServiceChannels.SocialProject,
);
