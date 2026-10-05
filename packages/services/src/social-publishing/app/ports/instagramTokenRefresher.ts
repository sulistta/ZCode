import type { InstagramAuthTokenSet } from "./instagramAuthBridge.js";

export interface InstagramTokenRefresher {
  refresh(accessToken: string): Promise<InstagramAuthTokenSet>;
}
