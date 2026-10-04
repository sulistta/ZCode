import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTaskSidePaneMemoryKey,
  readTaskSidePaneMemoryState,
  saveTaskSidePaneMemoryState,
} from "@/lib/taskSidePaneMemory.js";

export function useTaskSidePaneMemoryBridge({
  activeTaskId,
  workspaceAbsPath,
  workspaceIdentity,
}: {
  activeTaskId: string | null;
  workspaceAbsPath: string;
  workspaceIdentity?: string;
}) {
  const memoryKey = useMemo(
    () =>
      buildTaskSidePaneMemoryKey({
        workspacePath: workspaceAbsPath,
        workspaceIdentity,
        taskId: activeTaskId,
      }),
    [activeTaskId, workspaceAbsPath, workspaceIdentity],
  );
  const [browserRestoreUrls, setBrowserRestoreUrls] = useState(() => {
    const restored = readTaskSidePaneMemoryState(memoryKey);
    return restored.browserUrl
      ? { browser: restored.browserUrl, ...restored.browserUrls }
      : restored.browserUrls;
  });
  useEffect(() => {
    const restored = readTaskSidePaneMemoryState(memoryKey);
    setBrowserRestoreUrls(
      restored.browserUrl
        ? { browser: restored.browserUrl, ...restored.browserUrls }
        : restored.browserUrls,
    );
  }, [memoryKey]);

  const handleBrowserUrlChange = useCallback(
    (tabId: string, url: string) => {
      setBrowserRestoreUrls((current) => ({
        ...current,
        [tabId]: url,
      }));
      saveTaskSidePaneMemoryState(memoryKey, {
        browserUrls: {
          ...readTaskSidePaneMemoryState(memoryKey).browserUrls,
          [tabId]: url,
        },
      });
    },
    [memoryKey],
  );

  return {
    browserRestoreUrls,
    handleBrowserUrlChange,
  };
}
