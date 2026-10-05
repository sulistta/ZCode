import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import test from "node:test";
import {
  createPublicHttpsEgressProxy,
  isPublicUnicastAddress,
} from "../src/social-media/adapters/publicHttpsEgressProxy.js";

function readHttpResponse(socket: ReturnType<typeof createConnection>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).includes(Buffer.from("\r\n\r\n"))) {
        resolve(Buffer.concat(chunks));
      }
    });
    socket.setTimeout(3_000, () => reject(new Error("proxy response timed out")));
  });
}

test("public HTTPS egress accepts global unicast and rejects local or special-use addresses", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"]) {
    assert.equal(isPublicUnicastAddress(address), true, `${address} should be public unicast`);
  }
  for (const address of [
    "0.0.0.0",
    "10.2.3.4",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.31.196.1",
    "192.52.193.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2620:4f:8000::1",
    "ff02::1",
  ]) {
    assert.equal(isPublicUnicastAddress(address), false, `${address} must not be public egress`);
  }
});

test("CONNECT proxy rejects private DNS answers and non-443 targets before dialing", async () => {
  let connectCalls = 0;
  const proxy = createPublicHttpsEgressProxy({
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    connect: () => {
      connectCalls += 1;
      throw new Error("private destinations must never be dialed");
    },
  });
  const proxyUrl = new URL(await proxy.ready);
  const request = (target: string) => {
    const socket = createConnection(Number(proxyUrl.port), proxyUrl.hostname);
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    return readHttpResponse(socket).finally(() => socket.destroy());
  };

  try {
    const privateHostResponse = await request("media.example.test:443");
    assert.match(privateHostResponse.toString("utf8"), /^HTTP\/1\.1 403 Forbidden/u);
    const alternatePortResponse = await request("media.example.test:8443");
    assert.match(alternatePortResponse.toString("utf8"), /^HTTP\/1\.1 403 Forbidden/u);
    const malformedTargetResponse = await request("media.example.test/path:443");
    assert.match(malformedTargetResponse.toString("utf8"), /^HTTP\/1\.1 403 Forbidden/u);
    assert.equal(connectCalls, 0);
  } finally {
    await proxy.close();
  }
});

test("CONNECT proxy pins an approved public address and carries encrypted tunnel bytes", async () => {
  const echoServer = createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
  const address = echoServer.address();
  assert.ok(address && typeof address !== "string");
  const dialedTargets: Array<{ address: string; port: 443; family: 4 | 6 }> = [];
  const proxy = createPublicHttpsEgressProxy({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect: (target) => {
      dialedTargets.push(target);
      return createConnection(address.port, "127.0.0.1");
    },
  });
  const proxyUrl = new URL(await proxy.ready);
  const client = createConnection(Number(proxyUrl.port), proxyUrl.hostname);

  try {
    client.write(
      "CONNECT public.example.test:443 HTTP/1.1\r\nHost: public.example.test:443\r\n\r\n",
    );
    const header = await readHttpResponse(client);
    assert.match(header.toString("utf8"), /^HTTP\/1\.1 200 Connection Established/u);
    client.write("tls-payload");
    const echoed = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.once("error", reject);
      client.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.includes("tls-payload")) resolve(Buffer.from(body));
      });
      client.setTimeout(3_000, () => reject(new Error("tunnel payload timed out")));
    });
    assert.match(echoed.toString("utf8"), /tls-payload/u);
    assert.deepEqual(dialedTargets, [{ address: "8.8.8.8", family: 4, port: 443 }]);
  } finally {
    client.destroy();
    await proxy.close();
    await new Promise<void>((resolve, reject) =>
      echoServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
