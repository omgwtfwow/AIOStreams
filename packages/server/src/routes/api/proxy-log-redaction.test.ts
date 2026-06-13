import { describe, expect, it } from 'vitest';
import {
  sanitiseHeadersForLog,
  sanitiseUrlForLog,
} from './proxy-log-redaction.js';

describe('proxy log redaction helpers', () => {
  it('redacts credential-bearing URL components', () => {
    const safeUrl = sanitiseUrlForLog(
      'https://user:pass@example.com/video.mkv?downloadKey=download-secret&secret=url-secret&token=token-secret&safe=ok'
    );

    expect(safeUrl).not.toContain('user');
    expect(safeUrl).not.toContain('pass');
    expect(safeUrl).not.toContain('download-secret');
    expect(safeUrl).not.toContain('url-secret');
    expect(safeUrl).not.toContain('token-secret');
    expect(safeUrl).toContain('safe=ok');
  });

  it('redacts sensitive upstream request headers without dropping safe diagnostics', () => {
    const safeHeaders = sanitiseHeadersForLog({
      authorization: 'Bearer auth-secret',
      cookie: 'session=cookie-secret',
      apikey: 'bare-api-key-secret',
      'x-aiostreams-user-data': 'encoded-user-data-secret',
      'x-api-key': 'api-key-secret',
      range: 'bytes=0-1023',
      referer: 'https://example.com/watch?token=referer-secret&safe=ok',
      'user-agent': 'AIOStreams\nPlayer',
    });
    const serialised = JSON.stringify(safeHeaders);

    expect(serialised).not.toContain('auth-secret');
    expect(serialised).not.toContain('bare-api-key-secret');
    expect(serialised).not.toContain('cookie-secret');
    expect(serialised).not.toContain('encoded-user-data-secret');
    expect(serialised).not.toContain('api-key-secret');
    expect(serialised).not.toContain('referer-secret');
    expect(safeHeaders.range).toBe('bytes=0-1023');
    expect(safeHeaders['user-agent']).toBe('AIOStreamsPlayer');
    expect(safeHeaders.referer).toContain('safe=ok');
  });
});
