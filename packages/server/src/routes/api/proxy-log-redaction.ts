const REDACTED = '<redacted>';
const SENSITIVE_URL_PARAM_PATTERN =
  /([?&](?:apikey|api_key|auth|downloadKey|key|secret|token)=)([^&\s'"]+)/gi;

const SENSITIVE_URL_PARAM_NAMES = new Set([
  'apikey',
  'api_key',
  'auth',
  'downloadkey',
  'key',
  'secret',
  'token',
]);

const SENSITIVE_HEADER_NAMES = new Set([
  'api-key',
  'apikey',
  'authorization',
  'cookie',
  'download-key',
  'downloadkey',
  'proxy-authorization',
  'set-cookie',
  'x-access-token',
  'x-aiostreams-user-data',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_HEADER_MARKERS = [
  'auth',
  'cookie',
  'credential',
  'password',
  'secret',
  'token',
];

function sanitiseHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7e]/g, '');
}

function isSensitiveHeaderName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(lowerName) ||
    SENSITIVE_HEADER_MARKERS.some((marker) => lowerName.includes(marker))
  );
}

function sanitiseNonSensitiveHeaderValue(value: string): string {
  const sanitised = sanitiseHeaderValue(value);
  if (/^https?:\/\//i.test(sanitised)) {
    return sanitiseUrlForLog(sanitised);
  }
  return sanitised.replace(SENSITIVE_URL_PARAM_PATTERN, `$1${REDACTED}`);
}

export function sanitiseUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAM_NAMES.has(key.toLowerCase())) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return `${url.protocol}//${REDACTED}${url.pathname}${url.search}`;
  } catch {
    return '[invalid-url]';
  }
}

export function sanitiseHeadersForLog(
  headers: Record<string, string | string[] | number | undefined>
): Record<string, string | string[]> {
  const sanitised: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    const sensitive = isSensitiveHeaderName(key);
    if (Array.isArray(value)) {
      sanitised[key] = value.map((v) =>
        sensitive ? REDACTED : sanitiseNonSensitiveHeaderValue(v)
      );
    } else if (typeof value === 'number') {
      sanitised[key] = sensitive ? REDACTED : String(value);
    } else {
      sanitised[key] = sensitive
        ? REDACTED
        : sanitiseNonSensitiveHeaderValue(value);
    }
  }

  return sanitised;
}
