/** Repo-relative path filter shared by the log and the diff file list. */
export function pathMatches(pathFilter: string, follow: boolean, filePath: string): boolean {
  const spec = pathFilter.replace(/\\/g, '/').replace(/\/+$/, '');
  const file = filePath.replace(/\\/g, '/');
  if (!spec || spec === '.') return true;
  if (follow) return file === spec;
  return file === spec || file.startsWith(`${spec}/`);
}

/** A diff entry matches when its current path or its rename source matches. */
export function fileMatchesPath(pathFilter: string, follow: boolean, file: { path: string; oldPath?: string }): boolean {
  return pathMatches(pathFilter, follow, file.path) || (!!file.oldPath && pathMatches(pathFilter, follow, file.oldPath));
}
