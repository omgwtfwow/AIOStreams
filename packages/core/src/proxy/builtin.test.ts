import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOnDemandAliasUrl,
  buildOnDemandStableKey,
} from './builtin-on-demand.js';

describe('BuiltinProxy canonical on-demand alias helpers', () => {
  it('builds stable keys from canonical payload data', () => {
    const left = buildOnDemandStableKey('admin', {
      url: 'http://nzbdav:3000/dav/movie.mkv?downloadKey=secret',
      filename: 'movie.mkv',
      requestHeaders: {
        range: 'bytes=0-1023',
        authorization: undefined,
      },
      responseHeaders: undefined,
      type: 'stream',
    });
    const right = buildOnDemandStableKey('admin', {
      type: 'stream',
      responseHeaders: undefined,
      requestHeaders: {
        authorization: undefined,
        range: 'bytes=0-1023',
      },
      filename: 'movie.mkv',
      url: 'http://nzbdav:3000/dav/movie.mkv?downloadKey=secret',
    });

    assert.equal(left, right);
    assert.match(left, /^builtin:on-demand:v1:[a-f0-9]{64}$/);
    assert.equal(left.includes('downloadKey'), false);
    assert.equal(left.includes('secret'), false);
  });

  it('builds opaque /o URLs without proxy payload data', () => {
    const url = buildOnDemandAliasUrl(
      'http://localhost:3000',
      'pa_abc123',
      'Movie Name (2026).mkv'
    );

    assert.equal(
      url,
      'http://localhost:3000/api/v1/proxy/o/pa_abc123/Movie%20Name%20(2026).mkv'
    );
    assert.equal(url.includes('/api/v1/proxy/e.'), false);
    assert.equal(url.includes('/api/v1/proxy/u.'), false);
    assert.equal(url.includes('downloadKey'), false);
  });
});
