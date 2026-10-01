import type { OAuthStateRegistration } from "@social-harness/shared";

export interface OAuthCallbackRoute {
  completeOnDelivery: boolean;
  state: string;
  url: string;
  webContentsId: number;
}

interface OAuthRouteTarget {
  provider?: OAuthStateRegistration["provider"];
  webContentsId: number;
}

export function createOAuthCallbackRouter() {
  const targetsByState = new Map<string, OAuthRouteTarget>();
  const pendingByState = new Map<string, OAuthCallbackRoute>();

  function complete(route: OAuthCallbackRoute): void {
    const target = targetsByState.get(route.state);
    if (target?.webContentsId === route.webContentsId) {
      targetsByState.delete(route.state);
    }
    const pending = pendingByState.get(route.state);
    if (pending?.webContentsId === route.webContentsId) {
      pendingByState.delete(route.state);
    }
  }

  return {
    acknowledgeDelivery(route: OAuthCallbackRoute): void {
      if (route.completeOnDelivery) {
        complete(route);
        return;
      }
      const pending = pendingByState.get(route.state);
      if (pending?.webContentsId === route.webContentsId) {
        pendingByState.delete(route.state);
      }
    },

    clearWebContents(webContentsId: number): void {
      for (const [state, target] of targetsByState) {
        if (target.webContentsId === webContentsId) targetsByState.delete(state);
      }
      for (const [state, route] of pendingByState) {
        if (route.webContentsId === webContentsId) pendingByState.delete(state);
      }
    },

    complete,

    expire(state: string, webContentsId: number): void {
      const target = targetsByState.get(state);
      if (target?.webContentsId !== webContentsId) return;
      targetsByState.delete(state);
      pendingByState.delete(state);
    },

    pendingForWebContents(webContentsId: number): OAuthCallbackRoute[] {
      return [...pendingByState.values()].filter((route) => {
        const target = targetsByState.get(route.state);
        return route.webContentsId === webContentsId && target?.webContentsId === webContentsId;
      });
    },

    queue(route: OAuthCallbackRoute): boolean {
      const target = targetsByState.get(route.state);
      if (
        !target ||
        target.webContentsId !== route.webContentsId ||
        pendingByState.has(route.state)
      ) {
        return false;
      }
      pendingByState.set(route.state, route);
      return true;
    },

    register(webContentsId: number, registration: OAuthStateRegistration): void {
      targetsByState.set(registration.state, {
        webContentsId,
        ...(registration.provider ? { provider: registration.provider } : {}),
      });
    },

    resolve(state: string, url: string, completeOnDelivery: boolean): OAuthCallbackRoute | null {
      const target = targetsByState.get(state);
      if (!target || pendingByState.has(state)) return null;

      const callbackUrl = new URL(url);
      callbackUrl.searchParams.delete("_oauth_provider");
      if (target.provider) {
        callbackUrl.searchParams.set("_oauth_provider", target.provider);
      }
      return {
        completeOnDelivery,
        state,
        url: callbackUrl.toString(),
        webContentsId: target.webContentsId,
      };
    },
  };
}
