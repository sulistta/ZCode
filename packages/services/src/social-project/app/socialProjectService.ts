import { createHash, randomUUID } from "node:crypto";
import { Emitter } from "@social-harness/rpc";
import {
  createSocialProjectRequestSchema,
  socialAccountIdSchema,
  socialProjectCommandRequestSchema,
  socialProjectIdSchema,
  socialProjectOperationSchema,
  socialProjectSchema,
  isSocialProjectAgentOperation,
  type SocialProject,
  type SocialProjectCommandRequest,
} from "@social-harness/shared";
import type { ISocialAccountService } from "../../social-account/contract.js";
import type { ISocialMediaService } from "../../social-media/contract.js";
import type {
  ISocialProjectService,
  SocialProjectChange,
  SocialProjectAgentCommand,
  SocialProjectAgentScope,
  SocialProjectReadModel,
} from "../contract.js";
import type { SocialProjectStore } from "./ports/socialProjectStore.js";
import type { SocialProjectExportStore } from "./ports/socialProjectExportStore.js";
import { toSocialProjectSummary } from "./ports/socialProjectStore.js";
import {
  createSocialProjectExportOperations,
  type SocialProjectExportRenderer,
} from "./socialProjectExportService.js";
import {
  SocialProjectAccountNotFoundError,
  SocialProjectAgentEditSuspendedError,
  SocialProjectIdempotencyConflictError,
  SocialProjectMediaNotFoundError,
  SocialProjectNotFoundError,
  SocialProjectRevisionConflictError,
} from "./errors.js";
import { SocialProjectInvalidOperationError } from "../domain/errors.js";
import {
  applySocialProjectOperation,
  projectOperationChangesContent,
  projectOperationRequiresUser,
} from "../domain/projectOperations.js";
import {
  restoreSocialProjectContent,
  snapshotSocialProjectContent,
  type SocialProjectRecord,
} from "../domain/projectRecord.js";

interface SocialProjectServiceOptions {
  store: SocialProjectStore;
  exportStore: SocialProjectExportStore;
  exportRenderer: SocialProjectExportRenderer;
  socialAccountService: ISocialAccountService;
  socialMediaService: ISocialMediaService;
  now?: () => number;
  createProjectId?: () => string;
  createTrackId?: () => string;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function commandFingerprint(request: SocialProjectCommandRequest): string {
  return createHash("sha256").update(canonicalize(request)).digest("hex");
}

function readModel(record: SocialProjectRecord): SocialProjectReadModel {
  return {
    project: record.project,
    history: record.history,
    canUndo: record.undoStack.length > 0,
    canRedo: record.redoStack.length > 0,
  };
}

function nextUpdatedAt(project: SocialProject, now: number): number {
  return Math.max(project.updatedAt + 1, Math.trunc(now));
}

async function validateMediaReference(
  mediaService: ISocialMediaService,
  accountId: string,
  request: SocialProjectCommandRequest,
): Promise<void> {
  if (request.operation.type !== "put-clip" || request.operation.clip.kind === "text") return;
  const clip = request.operation.clip;
  const asset = (await mediaService.list(accountId)).find((item) => item.mediaId === clip.mediaId);
  if (!asset || asset.mediaKind !== clip.kind) {
    throw new SocialProjectMediaNotFoundError(accountId, clip.mediaId);
  }
  const sourceDurationSeconds = asset.sourceDurationSeconds;
  if (sourceDurationSeconds != null && clip.sourceEndMs > sourceDurationSeconds * 1000 + 100) {
    throw new SocialProjectInvalidOperationError("Clip source range exceeds the source duration");
  }
}

function defaultProject(input: {
  accountId: string;
  projectId: string;
  trackId: () => string;
  displayName: string;
  createdAt: number;
}): SocialProject {
  return socialProjectSchema.parse({
    projectId: input.projectId,
    accountId: input.accountId,
    displayName: input.displayName,
    revision: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    editControlOwner: "agent",
    settings: {
      width: 1080,
      height: 1920,
      frameRate: { numerator: 30, denominator: 1 },
      backgroundColor: "#000000",
    },
    tracks: [
      {
        trackId: input.trackId(),
        name: "Video 1",
        type: "video",
        muted: false,
        hidden: false,
        clips: [],
      },
      {
        trackId: input.trackId(),
        name: "Audio 1",
        type: "audio",
        muted: false,
        hidden: false,
        clips: [],
      },
    ],
  });
}

export function createSocialProjectService(
  options: SocialProjectServiceOptions,
): ISocialProjectService {
  const now = options.now ?? Date.now;
  const createProjectId = options.createProjectId ?? randomUUID;
  const createTrackId = options.createTrackId ?? randomUUID;
  const changed = new Emitter<SocialProjectChange>();

  async function requireAccount(accountId: string): Promise<void> {
    const account = await options.socialAccountService.get(accountId);
    if (!account) throw new SocialProjectAccountNotFoundError(accountId);
  }

  function emit(project: SocialProject): void {
    changed.fire({
      accountId: project.accountId,
      projectId: project.projectId,
      revision: project.revision,
      editControlOwner: project.editControlOwner,
    });
  }

  let service: ISocialProjectService;
  const projectServiceMethods: Pick<
    ISocialProjectService,
    "list" | "get" | "create" | "executeCommand" | "agentScope" | "onChanged"
  > = {
    async list(accountId) {
      const validatedAccountId = socialAccountIdSchema.parse(accountId);
      await requireAccount(validatedAccountId);
      return (await options.store.list(validatedAccountId))
        .sort((left, right) => right.project.updatedAt - left.project.updatedAt)
        .map(toSocialProjectSummary);
    },
    async get(accountId, projectId) {
      const validatedAccountId = socialAccountIdSchema.parse(accountId);
      const validatedProjectId = socialProjectIdSchema.parse(projectId);
      await requireAccount(validatedAccountId);
      const record = await options.store.get(validatedAccountId, validatedProjectId);
      return record ? readModel(record) : null;
    },
    async create(request) {
      const input = createSocialProjectRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const project = defaultProject({
        accountId: input.accountId,
        projectId: socialProjectIdSchema.parse(createProjectId()),
        trackId: () => socialProjectIdSchema.parse(createTrackId()),
        displayName: input.displayName,
        createdAt: Math.max(0, Math.trunc(now())),
      });
      const record = await options.store.create({
        project,
        history: [],
        undoStack: [],
        redoStack: [],
        appliedCommands: [],
      });
      emit(record.project);
      return readModel(record);
    },
    async executeCommand(request) {
      const input = socialProjectCommandRequestSchema.parse(request);
      await requireAccount(input.accountId);
      await validateMediaReference(options.socialMediaService, input.accountId, input);
      const fingerprint = commandFingerprint(input);
      let duplicate = false;
      const record = await options.store.update(input.accountId, input.projectId, (current) => {
        const previous = current.appliedCommands.find(
          (command) => command.commandId === input.commandId,
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw new SocialProjectIdempotencyConflictError(input.commandId);
          }
          duplicate = true;
          return current;
        }
        if (current.project.revision !== input.expectedRevision) {
          throw new SocialProjectRevisionConflictError(input.projectId, current.project.revision);
        }
        if (input.author === "agent" && current.project.editControlOwner === "user") {
          throw new SocialProjectAgentEditSuspendedError(input.projectId);
        }
        if (projectOperationRequiresUser(input.operation) && input.author !== "user") {
          throw new SocialProjectInvalidOperationError("Only the user can hand off edit control");
        }

        const updatedAt = nextUpdatedAt(current.project, now());
        const revision = current.project.revision + 1;
        let nextProject: SocialProject;
        let undoStack = current.undoStack;
        let redoStack = current.redoStack;
        if (input.operation.type === "undo") {
          const prior = undoStack.at(-1);
          if (!prior) throw new SocialProjectInvalidOperationError("There is no edit to undo");
          undoStack = undoStack.slice(0, -1);
          redoStack = [...redoStack, snapshotSocialProjectContent(current.project)];
          nextProject = restoreSocialProjectContent(current.project, prior, revision, updatedAt);
        } else if (input.operation.type === "redo") {
          const next = redoStack.at(-1);
          if (!next) throw new SocialProjectInvalidOperationError("There is no edit to redo");
          redoStack = redoStack.slice(0, -1);
          undoStack = [...undoStack, snapshotSocialProjectContent(current.project)];
          nextProject = restoreSocialProjectContent(current.project, next, revision, updatedAt);
        } else {
          if (projectOperationChangesContent(input.operation)) {
            undoStack = [...undoStack, snapshotSocialProjectContent(current.project)];
            redoStack = [];
          }
          nextProject = socialProjectSchema.parse({
            ...applySocialProjectOperation(current.project, input.operation),
            revision,
            updatedAt,
          });
        }
        return {
          ...current,
          project: nextProject,
          history: [
            ...current.history,
            {
              revision,
              commandId: input.commandId,
              author: input.author,
              operation: input.operation.type,
              updatedAt,
            },
          ],
          undoStack,
          redoStack,
          appliedCommands: [
            ...current.appliedCommands,
            { commandId: input.commandId, fingerprint, revision },
          ],
        };
      });
      if (!record) throw new SocialProjectNotFoundError(input.accountId, input.projectId);
      if (!duplicate) emit(record.project);
      return { ...readModel(record), duplicate };
    },
    async agentScope(workspaceIdentity): Promise<SocialProjectAgentScope | null> {
      const identity = workspaceIdentity.trim();
      if (!identity) return null;
      const matches = (await options.socialAccountService.list()).filter(
        (account) => account.workspaceIdentity === identity,
      );
      if (matches.length !== 1) return null;
      const accountId = matches[0]!.accountId;
      return {
        list: () => service.list(accountId),
        get: (projectId) => service.get(accountId, projectId),
        executeCommand: (request: SocialProjectAgentCommand) => {
          const operation = socialProjectOperationSchema.parse(request.operation);
          if (!isSocialProjectAgentOperation(operation)) {
            throw new SocialProjectInvalidOperationError(
              "Agent project tools cannot change edit control or history state",
            );
          }
          return service.executeCommand({
            projectId: request.projectId,
            commandId: request.commandId,
            expectedRevision: request.expectedRevision,
            operation,
            accountId,
            author: "agent",
          });
        },
      };
    },
    onChanged: changed.event,
  };
  const exportOperations = createSocialProjectExportOperations({
    projectService: projectServiceMethods,
    socialAccountService: options.socialAccountService,
    socialMediaService: options.socialMediaService,
    store: options.exportStore,
    renderer: options.exportRenderer,
    now,
  });
  service = Object.assign(projectServiceMethods, exportOperations);
  return service;
}
