/** Legacy public conversation links are retired with the ZCode Web identity flow. */
export function isRetiredPublicSharePath(pathname: string): boolean {
  return /^\/(?:cn\/)?share(?:\/|$)/u.test(pathname);
}
