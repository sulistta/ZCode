import type { EditorialProfile, SocialAutomationPolicy } from "@social-harness/shared";
import { editorialProfileSchema, socialAutomationPolicySchema } from "@social-harness/shared";

export function parseEditorialProfile(value: unknown): EditorialProfile {
  return editorialProfileSchema.parse(value);
}

export function parseSocialAutomationPolicy(value: unknown): SocialAutomationPolicy {
  return socialAutomationPolicySchema.parse(value);
}

export function mayAutomaticallyPublish(policy: SocialAutomationPolicy): boolean {
  return policy.autonomyEnabled;
}
