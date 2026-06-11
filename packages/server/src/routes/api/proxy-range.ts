export interface SingleByteRange {
  start?: number;
  end?: number;
  suffixLength?: number;
}

type HeaderValue = string | string[] | number | undefined;

function parseNonNegativeInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function getSingleHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

export function parseSingleByteRangeHeader(
  value: HeaderValue
): SingleByteRange | undefined {
  const header = getSingleHeaderValue(value)?.trim();
  if (!header) {
    return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) {
    return undefined;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return undefined;
  }

  if (!rawStart) {
    const suffixLength = parseNonNegativeInteger(rawEnd);
    if (!suffixLength || suffixLength <= 0) {
      return undefined;
    }
    return { suffixLength };
  }

  const start = parseNonNegativeInteger(rawStart);
  if (start === undefined) {
    return undefined;
  }

  if (!rawEnd) {
    return { start };
  }

  const end = parseNonNegativeInteger(rawEnd);
  if (end === undefined || end < start) {
    return undefined;
  }

  return { start, end };
}

export function parseContentLengthHeader(
  value: HeaderValue
): number | undefined {
  const parsed = parseNonNegativeInteger(getSingleHeaderValue(value) ?? '');
  return parsed === undefined || parsed < 0 ? undefined : parsed;
}

export function isUnsatisfiableByteRange(
  range: SingleByteRange,
  contentLength: number
): boolean {
  if (contentLength < 0 || !Number.isSafeInteger(contentLength)) {
    return false;
  }

  if (contentLength === 0) {
    return true;
  }

  return range.start !== undefined && range.start >= contentLength;
}

export function buildUnsatisfiableRangeHeaders(contentLength: number): {
  'accept-ranges': string;
  'content-length': string;
  'content-range': string;
} {
  return {
    'accept-ranges': 'bytes',
    'content-length': '0',
    'content-range': `bytes */${contentLength}`,
  };
}
