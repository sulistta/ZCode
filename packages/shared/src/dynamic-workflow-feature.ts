// ============================================================
// Dynamic Workflow 本地 feature key 的取值域与客户端快照
// ============================================================

// 这里只放三端（Host services、Desktop main、UI）共用的取值域、归一化与快照形状；
// 本地覆盖与下发都在各自的 owner 里，shared 层不访问网络。

export const DYNAMIC_WORKFLOW_MODES = ["disabled", "onDemand", "alwaysOn"] as const;
export type DynamicWorkflowMode = (typeof DYNAMIC_WORKFLOW_MODES)[number];

/**
 * 本地覆盖用的环境变量。语义按构建档位分三层，由 Desktop main 在 fork Host 前**改写或删除**
 * （desktopRuntimeEnv.ts 的 buildHostProcessEnv），Host 只消费不再分辨来源：
 *   - 未打包 dev：透传开发者 shell 里的合法取值；
 *   - 打包 preview：固定写入 `alwaysOn`，忽略 shell；
 *   - 打包 production：删除继承值，永不写入。
 * 没有 main 的 Web/server Host 直接读进程环境（运维/开发者设置）。
 */
export const SOCIAL_HARNESS_DYNAMIC_WORKFLOW_MODE_ENV = "SOCIAL_HARNESS_DYNAMIC_WORKFLOW_MODE";

/** 缺省或格式非法时关闭，避免默认打开 Agent workflow 工具。 */
export const DEFAULT_DYNAMIC_WORKFLOW_MODE: DynamicWorkflowMode = "disabled";

export function normalizeDynamicWorkflowMode(value: unknown): DynamicWorkflowMode | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return (DYNAMIC_WORKFLOW_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as DynamicWorkflowMode)
    : undefined;
}

/**
 * 解析本地三态，消费侧统一转换为布尔开关。
 * 将来 onDemand 有独立行为时，只需调整消费侧。
 */
export function isDynamicWorkflowModeEnabled(mode: DynamicWorkflowMode): boolean {
  return mode !== "disabled";
}

/** 快照的来源：观测用，区分本地默认值与本地覆盖。 */
export type DynamicWorkflowClientConfigSource = "override" | "default";

export interface DynamicWorkflowClientConfig {
  readonly mode: DynamicWorkflowMode;
  /** 等于 isDynamicWorkflowModeEnabled(mode)；单独落字段免得每个消费者各写一遍折叠规则。 */
  readonly enabled: boolean;
  readonly source: DynamicWorkflowClientConfigSource;
}

export function createDynamicWorkflowClientConfig(
  mode: DynamicWorkflowMode,
  source: DynamicWorkflowClientConfigSource,
): DynamicWorkflowClientConfig {
  return { mode, enabled: isDynamicWorkflowModeEnabled(mode), source };
}

/**
 * 纯函数：将本地覆盖环境变量解析成快照。Social Harness 不再读取远端 Coding Plan 灰度配置。
 */
export function resolveDynamicWorkflowClientConfig(input: {
  env?: Record<string, string | undefined>;
}): DynamicWorkflowClientConfig {
  const override = normalizeDynamicWorkflowMode(
    input.env?.[SOCIAL_HARNESS_DYNAMIC_WORKFLOW_MODE_ENV],
  );
  if (override) return createDynamicWorkflowClientConfig(override, "override");
  return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
}
