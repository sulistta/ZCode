import { readFile } from "node:fs/promises";
import { instagramBridgeConfigurationSchema } from "@social-harness/shared";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import type { InstagramBridgeConfigurationStore } from "../app/ports/instagramBridgeSetup.js";
export function createInstagramBridgeConfigurationFileStore(
  filePath: string,
): InstagramBridgeConfigurationStore {
  return {
    async read() {
      try {
        return instagramBridgeConfigurationSchema.parse(
          JSON.parse(await readFile(filePath, "utf8")),
        );
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          return null;
        throw new Error("Instagram bridge configuration is invalid");
      }
    },
    async write(config) {
      await atomicWritePrivateTextFile(
        filePath,
        JSON.stringify(instagramBridgeConfigurationSchema.parse(config)),
      );
    },
    exclusive(operation) {
      return withFileLock(filePath, operation);
    },
  };
}
