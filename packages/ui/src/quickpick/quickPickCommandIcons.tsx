import {
  FolderOpenIcon,
  GlobeIcon,
  LogInIcon,
  LogOutIcon,
  MessageCirclePlus,
  MessageSquareIcon,
  MoonIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ServerIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  WandSparkles,
} from "lucide-react";
import type { QuickPickCommandIcon } from "@/quickpick/quickPickCommands.js";

export const QUICK_PICK_ICON_BY_KIND = {
  browser: GlobeIcon,
  community: UsersIcon,
  feedback: MessageSquareIcon,
  folder: FolderOpenIcon,
  login: LogInIcon,
  logout: LogOutIcon,
  message: MessageCirclePlus,
  mcp: ServerIcon,
  settings: SettingsIcon,
  sidebarClose: PanelLeftClose,
  sidebarOpen: PanelLeftOpen,
  skills: WandSparkles,
  themeDark: MoonIcon,
  themeLight: SunIcon,
} satisfies Record<QuickPickCommandIcon, typeof MessageCirclePlus>;
