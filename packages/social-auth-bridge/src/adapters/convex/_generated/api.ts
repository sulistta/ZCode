import { makeFunctionReference } from "convex/server";
import type { FunctionReference, DefaultFunctionArgs } from "convex/server";
import type { GenericId } from "convex/values";
function ref<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<"mutation", Args, Result>(
    `bridge:${name}`,
  ) as unknown as FunctionReference<"mutation", "internal", Args, Result>;
}
export const internal = {
  bridge: {
    expireLease: ref<{ leaseId: GenericId<"leases">; force: boolean }, null>("expireLease"),
    sweep: ref<{ cursor?: string }, null>("sweep"),
    claimCallback: ref<{ state: string }, { flowId: GenericId<"flows"> }>("claimCallback"),
    finishCallback: ref<
      {
        flowId: GenericId<"flows">;
        ticketHash: string;
        accessToken?: string;
        tokenExpiresAt?: number;
        denied?: boolean;
      },
      null
    >("finishCallback"),
  },
};
