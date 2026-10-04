import type { IntranetProbeRequest, IntranetProbeResult, SystemInfo } from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISystemService {
  info(): Promise<SystemInfo>;
  probeIntranet(request: IntranetProbeRequest): Promise<IntranetProbeResult>;
}

export const ISystemService = createServiceDescriptor<ISystemService>(ServiceChannels.System);
