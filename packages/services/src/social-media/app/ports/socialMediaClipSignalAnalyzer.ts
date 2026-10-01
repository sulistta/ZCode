import type { SocialMediaClipSignals } from "../../domain/clipSignals.js";

export interface SocialMediaClipSignalAnalyzer {
  analyze(input: {
    mediaPath: string;
    hasVideo: boolean;
  }): Promise<
    | { available: true; signals: SocialMediaClipSignals }
    | { available: false; reason: "audio-unavailable" | "duration-out-of-range" }
  >;
}
