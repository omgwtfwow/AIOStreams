import { createHash } from 'crypto';

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, objectValue]) => objectValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, objectValue]) => [key, canonicalise(objectValue)])
    );
  }
  return value;
}

export function buildOnDemandStableKey(
  username: string,
  data: unknown
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(canonicalise({ username, data })))
    .digest('hex');
  return `builtin:on-demand:v1:${hash}`;
}

export function buildOnDemandAliasUrl(
  baseUrl: string,
  id: string,
  filename?: string
): string {
  const suffix = filename ? `/${encodeURIComponent(filename)}` : '';
  return new URL(
    `/api/v1/proxy/o/${encodeURIComponent(id)}${suffix}`,
    baseUrl
  ).toString();
}
