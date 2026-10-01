import type {
  ZCodeAutomation,
  ZCodeAutomationRun,
  ZCodeAutomationScheduleRule,
} from "@social-harness/shared";

export type AutomationFrequency = "daily" | "weekly";
export type AutomationMode = "plan" | "build";
export type WorkspaceTarget = { workspacePath: string; workspaceIdentity: string };

export interface AutomationDraft {
  automationId?: string;
  title: string;
  prompt: string;
  mode: AutomationMode;
  frequency: AutomationFrequency;
  time: string;
  weekday: number;
  scheduleEditable: boolean;
  scheduleDirty: boolean;
}

export const WEEKDAY_MESSAGE_IDS = [
  "socialAccounts.automations.day.sunday",
  "socialAccounts.automations.day.monday",
  "socialAccounts.automations.day.tuesday",
  "socialAccounts.automations.day.wednesday",
  "socialAccounts.automations.day.thursday",
  "socialAccounts.automations.day.friday",
  "socialAccounts.automations.day.saturday",
] as const;

export const AUTOMATION_TEMPLATES = [
  {
    id: "discovery",
    titleId: "socialAccounts.automations.template.discovery.title",
    descriptionId: "socialAccounts.automations.template.discovery.description",
    mode: "plan",
    prompt:
      "Read the current account context with SocialAgentGetContext. Review SocialMediaList, then use SocialYouTubeSearch only for sources that match the account's preferred sources and editorial profile. Return a short, evidence-based discovery brief with links and explain why each source fits. Do not download media, change projects, or publish.",
  },
  {
    id: "clips",
    titleId: "socialAccounts.automations.template.clips.title",
    descriptionId: "socialAccounts.automations.template.clips.description",
    mode: "build",
    prompt:
      "Read the current account context with SocialAgentGetContext and review SocialMediaList. Use SocialClipCandidates for relevant audio or video assets, then prepare the strongest candidates in the selected account project with SocialProjectRead and SocialProjectCommand. Preserve the accepted project revision and measured source timestamps; if there is no suitable project, ask the user to create one in Player. Never invent signals or publish.",
  },
  {
    id: "publication",
    titleId: "socialAccounts.automations.template.publication.title",
    descriptionId: "socialAccounts.automations.template.publication.description",
    mode: "build",
    prompt:
      "Read SocialAgentGetContext and follow the current account automation policy. Choose only a completed export for the current project revision from completedExports; if there is no eligible export, stop and ask the user to export the current project in Player. Check that the project's media sources are allowed and that cadence and daily limits permit a post. Write a caption from the project and editorial context, then call SocialPublicationRequest once with that exportId and caption. The Host decides whether this becomes a supervised proposal or an autonomous publication. Never call it again to work around a rejection, approve a proposal, or claim a post succeeded unless publication history confirms it.",
  },
] as const;

function parseTime(value: string): { hour: number; minute: number } {
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

export function scheduleForDraft(draft: AutomationDraft) {
  const { hour, minute } = parseTime(draft.time);
  const scheduleRule: ZCodeAutomationScheduleRule = {
    unit: draft.frequency,
    interval: 1,
    hour,
    minute,
    anchorAt: Date.now(),
    ...(draft.frequency === "weekly" ? { weekdays: [draft.weekday] } : {}),
  };
  const cronExpr = `${minute} ${hour} * * ${draft.frequency === "weekly" ? draft.weekday : "*"}`;
  return { cronExpr, scheduleRule };
}

function isSimpleSchedule(automation: ZCodeAutomation): boolean {
  const unit = automation.scheduleRule?.unit;
  if (unit) return unit === "daily" || unit === "weekly";
  const fields = automation.cronExpr.trim().split(/\s+/u);
  return fields.length === 5 && fields[2] === "*" && fields[3] === "*";
}

export function draftFromAutomation(automation: ZCodeAutomation): AutomationDraft {
  const fields = automation.cronExpr.trim().split(/\s+/u);
  const rule = automation.scheduleRule;
  const hour = rule?.hour ?? Number(fields[1]);
  const minute = rule?.minute ?? Number(fields[0]);
  const frequency: AutomationFrequency =
    rule?.unit === "weekly" || fields[4] !== "*" ? "weekly" : "daily";
  const weekday = rule?.weekdays?.[0] ?? Number(fields[4]);
  return {
    automationId: automation.automationId,
    title: automation.title,
    prompt: automation.prompt,
    mode: automation.mode === "build" ? "build" : "plan",
    frequency,
    time: `${String(Number.isInteger(hour) ? hour : 9).padStart(2, "0")}:${String(Number.isInteger(minute) ? minute : 0).padStart(2, "0")}`,
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1,
    scheduleEditable: isSimpleSchedule(automation),
    scheduleDirty: false,
  };
}

export function formatDate(timestamp: number | undefined, locale: string): string | null {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    timestamp,
  );
}

export function runOutcomeMessageId(run: ZCodeAutomationRun): string {
  if (run.outcome === "succeeded") return "socialAccounts.automations.run.succeeded";
  if (run.outcome === "failed" || run.dispatchStatus === "failed_to_dispatch") {
    return "socialAccounts.automations.run.failed";
  }
  if (run.outcome === "stopped" || run.dispatchStatus === "skipped") {
    return "socialAccounts.automations.run.skipped";
  }
  if (run.outcome === "running" || run.dispatchStatus === "dispatched") {
    return "socialAccounts.automations.run.running";
  }
  return "socialAccounts.automations.run.queued";
}
