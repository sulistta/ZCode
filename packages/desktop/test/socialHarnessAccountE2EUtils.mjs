import { createServer } from "node:net";

export async function reserveVitePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a Desktop E2E Vite port");
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

export async function waitForRuntimeOutput(runtime, marker, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (runtime.output.includes(marker)) return;
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      throw new Error(`${label} exited before completion.\n${runtime.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not complete.\n${runtime.output}`);
}

export function assertNoRetiredZCodeProductApiRequests(runtime) {
  const retiredApiMatch = runtime.output.match(
    /\/api\/v1\/client\/(configs|scenes)(?:[/?\s"'<>]|$)/u,
  );
  if (retiredApiMatch) {
    throw new Error(`Social Harness requested the retired ZCode client/${retiredApiMatch[1]} API`);
  }
}
