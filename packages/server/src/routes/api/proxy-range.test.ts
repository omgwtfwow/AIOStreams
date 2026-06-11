import { describe, expect, it } from 'vitest';
import {
  buildUnsatisfiableRangeHeaders,
  isUnsatisfiableByteRange,
  parseContentLengthHeader,
  parseSingleByteRangeHeader,
} from './proxy-range.js';

describe('proxy range helpers', () => {
  it('parses single byte ranges used by media clients', () => {
    expect(parseSingleByteRangeHeader('bytes=0-1023')).toEqual({
      start: 0,
      end: 1023,
    });
    expect(parseSingleByteRangeHeader('bytes=1024-')).toEqual({
      start: 1024,
    });
    expect(parseSingleByteRangeHeader('bytes=-2048')).toEqual({
      suffixLength: 2048,
    });
  });

  it('rejects malformed or multi-range headers', () => {
    expect(parseSingleByteRangeHeader('items=0-1')).toBeUndefined();
    expect(parseSingleByteRangeHeader('bytes=100-10')).toBeUndefined();
    expect(parseSingleByteRangeHeader('bytes=0-1,2-3')).toBeUndefined();
    expect(parseSingleByteRangeHeader('bytes=-0')).toBeUndefined();
  });

  it('detects explicit starts beyond the media length', () => {
    expect(isUnsatisfiableByteRange({ start: 1000 }, 1000)).toBe(true);
    expect(isUnsatisfiableByteRange({ start: 999 }, 1000)).toBe(false);
    expect(isUnsatisfiableByteRange({ suffixLength: 2000 }, 1000)).toBe(false);
  });

  it('builds sanitized 416 headers', () => {
    expect(buildUnsatisfiableRangeHeaders(6271964449)).toEqual({
      'accept-ranges': 'bytes',
      'content-length': '0',
      'content-range': 'bytes */6271964449',
    });
  });

  it('parses content lengths conservatively', () => {
    expect(parseContentLengthHeader('6271964449')).toBe(6271964449);
    expect(parseContentLengthHeader(['1024'])).toBe(1024);
    expect(parseContentLengthHeader('bad')).toBeUndefined();
  });
});
