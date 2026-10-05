import { LucideProvider } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { SocialAccountsHome } from "@/social-accounts/SocialAccountsHome.js";
import { SocialHarnessUnavailable } from "@/social-accounts/SocialHarnessUnavailable.js";
import { resolveRootSurface } from "@/root/rootSurface.js";
import type { RootProps } from "@/root/types.js";
import { StoreProvider } from "@/store/StoreProvider.js";
import { TabStoreProvider } from "@/store/TabStoreProvider.js";

const DEFAULT_LUCIDE_STROKE_WIDTH = 1.5;

export function Root(props: RootProps) {
  const socialAccountService = props.services.socialAccountService;
  const rootSurface = resolveRootSurface({
    hasSocialAccountService: Boolean(socialAccountService),
  });

  return (
    <LucideProvider strokeWidth={DEFAULT_LUCIDE_STROKE_WIDTH}>
      <TooltipProvider>
        <ServiceProvider services={props.services}>
          <PlatformProvider platform={props.platform}>
            <StoreProvider broadcastService={props.services.broadcastService}>
              {rootSurface === "social" && socialAccountService ? (
                <TabStoreProvider>
                  <SocialAccountsHome
                    service={socialAccountService}
                    mediaService={props.services.socialMediaService}
                    mediaPreviewService={props.services.socialMediaPreviewService}
                    projectService={props.services.socialProjectService}
                    publishingService={props.services.socialPublishingService}
                    platform={props.platform}
                    isDesktop={props.isDesktop}
                    isMacDesktop={props.isMacDesktop}
                    isWindowsDesktop={props.isWindowsDesktop}
                  />
                </TabStoreProvider>
              ) : (
                <SocialHarnessUnavailable />
              )}
            </StoreProvider>
          </PlatformProvider>
        </ServiceProvider>
      </TooltipProvider>
    </LucideProvider>
  );
}
