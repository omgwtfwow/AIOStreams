import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const proxySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'proxy.ts'),
  'utf8'
);

describe('AIOStreams proxy route surface', () => {
  it('serves only stable and on-demand alias proxy routes', () => {
    expect(proxySource).toContain("'/s/:id{/:filename}'");
    expect(proxySource).toContain("'/o/:id{/:filename}'");
    expect(proxySource).not.toContain(':encryptedAuthAndData');
    expect(proxySource).not.toContain('decodeAndAuthorizeRequest');
    expect(proxySource).not.toContain("encodeMode === 'e'");
    expect(proxySource).not.toContain("encodeMode === 'u'");
  });
});
