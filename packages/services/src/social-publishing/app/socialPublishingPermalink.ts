export function safeInstagramPermalink(input: string | null): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      !/^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
