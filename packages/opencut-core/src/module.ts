/** Pure, renderer-facing timeline math adapted from the pinned OpenCut Classic source. */
export const opencutCoreModule = {
  id: "opencut-core",
  requires: ["shared"],
  provides: ["opencut-timeline-core", "social-project-scene-evaluation"],
  publicEntrypoints: ["contract.ts"],
} as const;
