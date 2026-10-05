const DEEP_LINK_SCHEME = "social-harness";
const DEEP_LINK_RE = /\bsocial-harness:(?:\/\/|\/)?[^\s"'<>]+/i;
const OAUTH_CALLBACK_HOSTS = new Set(["oauth"]);
const DEEP_LINK_ADDITIONAL_DATA_KEY = "deepLinkUrl";

function normalizeOAuthCallbackPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash === "" ? "/" : withoutTrailingSlash;
  return `/${normalized.replace(/^\/+/, "")}`;
}

export function isOAuthCallbackUrl(parsedUrl: URL): boolean {
  if (parsedUrl.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return false;
  }

  const normalizedPath = normalizeOAuthCallbackPath(parsedUrl.pathname);
  if (OAUTH_CALLBACK_HOSTS.has(parsedUrl.hostname)) {
    return normalizedPath === "/callback";
  }

  if (parsedUrl.hostname) {
    return false;
  }

  const [, host, ...pathParts] = normalizedPath.split("/");
  return Boolean(
    host && OAUTH_CALLBACK_HOSTS.has(host) && `/${pathParts.join("/")}` === "/callback",
  );
}

export function isSupportedSocialHarnessDeepLinkUrl(parsedUrl: URL): boolean {
  return isOAuthCallbackUrl(parsedUrl);
}

function decodeDeepLinkCandidate(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

function expandDecodedDeepLinkCandidates(value: string): string[] {
  const candidates = [value];
  let current = value;

  for (let index = 0; index < 3; index++) {
    const decoded = decodeDeepLinkCandidate(current);
    if (!decoded || candidates.includes(decoded)) {
      break;
    }

    candidates.push(decoded);
    current = decoded;
  }

  return candidates;
}

function buildArgCandidates(args: readonly string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    if (!seen.has(value)) {
      candidates.push(value);
      seen.add(value);
    }
  };

  for (const arg of args) {
    addCandidate(arg);
  }

  for (let start = 0; start < args.length; start++) {
    let joined = "";
    for (let end = start; end < Math.min(args.length, start + 5); end++) {
      joined += args[end] ?? "";
      if (end > start) {
        addCandidate(joined);
      }
    }
  }

  return candidates;
}

function extractFromCandidate(value: string): string | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  const match = trimmed.match(DEEP_LINK_RE);
  return match?.[0].replace(/&amp;/gi, "&").replace(/\\([&=?:/])/g, "$1") ?? null;
}

function isCompleteOAuthCallbackUrl(value: string): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return false;
  }

  return isOAuthCallbackUrl(parsedUrl) && parsedUrl.searchParams.has("state");
}

export function extractDeepLinkUrlFromArgs(args: readonly string[]): string | null {
  let fallbackMatch: string | null = null;

  for (const arg of buildArgCandidates(args)) {
    for (const candidate of expandDecodedDeepLinkCandidates(arg)) {
      const match = extractFromCandidate(candidate);
      if (match) {
        let parsedMatch: URL;
        try {
          parsedMatch = new URL(match);
        } catch {
          continue;
        }
        if (!isSupportedSocialHarnessDeepLinkUrl(parsedMatch)) {
          continue;
        }
        // Debian/xdg 的协议回调可能被浏览器或桌面门户多次编码，
        // 也可能把 query 片段拆成相邻 argv。这里先生成有限候选再多轮解码，
        // 避免系统确认打开链接后主进程拿不到完整回调 URL。
        if (isCompleteOAuthCallbackUrl(match)) {
          return match;
        }
        fallbackMatch ??= match;
      }
    }
  }

  return fallbackMatch;
}

export function createDeepLinkSingleInstanceData(args: readonly string[]): Record<string, string> {
  const url = extractDeepLinkUrlFromArgs(args);
  return url ? { [DEEP_LINK_ADDITIONAL_DATA_KEY]: url } : {};
}

export function extractDeepLinkUrlFromSingleInstanceData(additionalData: unknown): string | null {
  if (!additionalData || typeof additionalData !== "object") {
    return null;
  }

  const value = (additionalData as Record<string, unknown>)[DEEP_LINK_ADDITIONAL_DATA_KEY];
  if (typeof value !== "string") {
    return null;
  }

  return extractDeepLinkUrlFromArgs([value]);
}
