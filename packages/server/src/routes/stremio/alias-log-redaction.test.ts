import { describe, expect, it } from 'vitest';
import { buildAliasRedirectLogContext } from './alias-log-redaction.js';

describe('alias redirect log context', () => {
  it('does not include redirect credentials or wildcard paths', () => {
    const context = buildAliasRedirectLogContext(
      'family',
      'movie/credential-secret'
    );
    const serialised = JSON.stringify(context);

    expect(serialised).toContain('family');
    expect(serialised).toContain('hasWildcardPath');
    expect(serialised).not.toContain('credential-secret');
    expect(serialised).not.toContain('movie');
  });
});
