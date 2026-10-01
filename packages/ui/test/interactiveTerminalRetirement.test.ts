import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenTabLauncherItemIds } from "../src/app-shell/animatedSidePanePanelModel.js";
import { createQuickPickCommands } from "../src/quickpick/quickPickCommands.js";
import {
  normalizeWorkspaceSidePaneState,
  type WorkspaceSidePaneState,
} from "../src/lib/workspaceSidePane.js";

test("Social Harness launchers do not expose programming tools or an interactive terminal", () => {
  const noop = () => {};
  const commands = createQuickPickCommands({
    allowOpenWorkspace: true,
    canOpenCommunity: false,
    isSidebarVisible: true,
    isLoggedIn: false,
    supportsEmbeddedBrowser: true,
    themeTarget: "dark",
    shortcuts: {
      newTask: "",
      openWorkspace: "",
      toggleSidebar: "",
    },
    handlers: {
      createTask: noop,
      openWorkspace: noop,
      openSettings: noop,
      openSkillsSettings: noop,
      openMcpSettings: noop,
      switchTheme: noop,
      openFeedback: noop,
      openCommunity: noop,
      toggleSidebar: noop,
      togglePreview: noop,
      openBrowserTab: noop,
    },
  });

  assert.equal(
    commands.some((command) => command.id === "product-docs"),
    false,
  );
  assert.equal(
    commands.some((command) => command.id.includes("terminal")),
    false,
  );
  assert.equal(
    commands.some((command) => command.id.includes("code-review")),
    false,
  );
  assert.deepEqual(
    resolveOpenTabLauncherItemIds({
      developerToolsEnabled: false,
      supportsEmbeddedBrowser: true,
    }),
    ["browser"],
  );
});

test("restored side-pane memory drops legacy programming review and terminal tabs", () => {
  const browserTab = { id: "browser:kept", type: "browser" as const };
  const legacyState = {
    tabs: [
      { id: "terminal:retired", type: "terminal", title: "Old shell" },
      { id: "git", type: "git", title: "Review" },
      {
        id: "code-review:retired",
        type: "code-viewer",
        source: { type: "code-review" },
        sourceKey: null,
      },
      { id: "treemapping", type: "treemapping" },
      browserTab,
    ],
    activeTabId: "git",
  } as unknown as WorkspaceSidePaneState;

  assert.deepEqual(normalizeWorkspaceSidePaneState(legacyState), {
    tabs: [browserTab],
    activeTabId: "browser:kept",
  });
  assert.equal(
    normalizeWorkspaceSidePaneState({
      tabs: [{ id: "terminal:retired", type: "terminal", title: "Old shell" }],
      activeTabId: "terminal:retired",
    } as unknown as WorkspaceSidePaneState),
    null,
  );
});
