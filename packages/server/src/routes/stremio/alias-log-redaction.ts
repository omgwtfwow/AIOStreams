export function buildAliasRedirectLogContext(
  alias: string,
  wildcardPath?: string
): { alias: string; hasWildcardPath: boolean } {
  return {
    alias,
    hasWildcardPath: Boolean(wildcardPath),
  };
}
