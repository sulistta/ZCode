export type RootSurface = "social" | "unavailable";

export function resolveRootSurface(input: { hasSocialAccountService: boolean }): RootSurface {
  return input.hasSocialAccountService ? "social" : "unavailable";
}
