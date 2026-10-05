import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect as connectTcp, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";

type PublicAddress = { address: string; family: 4 | 6 };
type LookupPublicAddresses = (hostname: string) => Promise<PublicAddress[]>;
type ConnectPublicAddress = (target: PublicAddress & { port: 443 }) => Socket;

const IPV4_NON_PUBLIC_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToBigInt(address: string): bigint | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return null;
  return octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
}

function ipv6ToBigInt(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".")) {
    const ipv4 = normalized.slice(lastColon + 1);
    const ipv4Value = ipv4ToBigInt(ipv4);
    if (ipv4Value === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4Value >> 16n) & 0xffffn).toString(16)}:${(ipv4Value & 0xffffn).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[a-f0-9]{1,4}$/u.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function inCidr(value: bigint, network: bigint, bits: number, prefix: number): boolean {
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return (value & mask) === (network & mask);
}

function cidrNetwork(address: string, bits: number): bigint {
  return bits === 32 ? ipv4ToBigInt(address)! : ipv6ToBigInt(address)!;
}

export function isPublicUnicastAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    if (value === null) return false;
    return !IPV4_NON_PUBLIC_RANGES.some(([network, prefix]) =>
      inCidr(value, cidrNetwork(network, 32), 32, prefix),
    );
  }
  if (family !== 6) return false;
  const value = ipv6ToBigInt(address);
  if (value === null) return false;

  // Only global-unicast 2000::/3 is eligible. Exclude special-use, transition and documentation
  // ranges that can tunnel or alias to non-public IPv4 destinations.
  const isGlobalUnicast = inCidr(value, cidrNetwork("2000::", 128), 128, 3);
  const specialRanges: ReadonlyArray<readonly [string, number]> = [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["2620:4f:8000::", 48],
  ];
  return (
    isGlobalUnicast &&
    !specialRanges.some(([network, prefix]) =>
      inCidr(value, cidrNetwork(network, 128), 128, prefix),
    )
  );
}

async function lookupPublicAddresses(hostname: string): Promise<PublicAddress[]> {
  const unbracketedHostname = hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  const family = isIP(unbracketedHostname);
  const records = family
    ? [{ address: unbracketedHostname, family }]
    : await dnsLookup(unbracketedHostname, { all: true, verbatim: true });
  return records
    .filter(
      (record): record is PublicAddress =>
        (record.family === 4 || record.family === 6) && isPublicUnicastAddress(record.address),
    )
    .map(({ address, family: addressFamily }) => ({ address, family: addressFamily }));
}

function parseConnectTarget(request: IncomingMessage): string | null {
  if (request.method !== "CONNECT" || typeof request.url !== "string") return null;
  let target: URL;
  try {
    target = new URL(`https://${request.url}`);
  } catch {
    return null;
  }
  const port = target.port || "443";
  if (
    !target.hostname ||
    target.username ||
    target.password ||
    port !== "443" ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    return null;
  }
  return target.hostname;
}

export interface PublicHttpsEgressProxy {
  ready: Promise<string>;
  close(): Promise<void>;
}

export function createPublicHttpsEgressProxy(options?: {
  lookup?: LookupPublicAddresses;
  connect?: ConnectPublicAddress;
}): PublicHttpsEgressProxy {
  const lookup = options?.lookup ?? lookupPublicAddresses;
  const connect =
    options?.connect ??
    ((target) => connectTcp({ host: target.address, port: target.port, family: target.family }));
  const server: Server = createServer((_request, response) => {
    response.writeHead(403, { connection: "close" }).end();
  });
  const sockets = new Set<Socket | Duplex>();
  let closePromise: Promise<void> | null = null;

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.on("connect", (request, client, head) => {
    void tunnel(request, client, head);
  });

  const ready = new Promise<string>((resolveReady, rejectReady) => {
    server.once("error", rejectReady);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectReady);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectReady(new Error("The public HTTPS proxy did not bind to a TCP port"));
        return;
      }
      resolveReady(`http://127.0.0.1:${address.port}`);
    });
  });

  async function tunnel(request: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    const hostname = parseConnectTarget(request);
    if (!hostname) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }

    let addresses: PublicAddress[];
    try {
      addresses = await lookup(hostname);
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      return;
    }
    if (addresses.length === 0 || client.destroyed) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }

    let lastError: unknown;
    for (const address of addresses) {
      if (!isPublicUnicastAddress(address.address) || client.destroyed) continue;
      const upstream = connect({ ...address, port: 443 });
      sockets.add(upstream);
      upstream.once("close", () => sockets.delete(upstream));
      const clientClosed = () => upstream.destroy();
      client.once("close", clientClosed);
      try {
        await new Promise<void>((resolveConnected, rejectConnected) => {
          upstream.once("connect", resolveConnected);
          upstream.once("error", rejectConnected);
          upstream.setTimeout(15_000, () => rejectConnected(new Error("connect timeout")));
        });
        upstream.setTimeout(0);
        upstream.removeAllListeners("error");
        upstream.on("error", () => client.destroy());
        if (client.destroyed) {
          upstream.destroy();
          return;
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.byteLength > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
        return;
      } catch (error) {
        lastError = error;
        client.removeListener("close", clientClosed);
        upstream.removeAllListeners("error");
        upstream.on("error", () => client.destroy());
        upstream.destroy();
      }
    }
    if (!client.destroyed) {
      client.end(
        `HTTP/1.1 ${lastError ? "502 Bad Gateway" : "403 Forbidden"}\r\nConnection: close\r\n\r\n`,
      );
    }
  }

  return {
    ready,
    async close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        await ready.catch(() => undefined);
        for (const socket of sockets) socket.destroy();
        if (!server.listening) return;
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => (error ? rejectClose(error) : resolveClose()));
        });
      })();
      return closePromise;
    },
  };
}
