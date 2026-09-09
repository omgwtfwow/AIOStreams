import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS } from './index.js';

describe('fork migration ordering', () => {
  it('reserves migration 7 for deployed proxy aliases', () => {
    const ids = MIGRATIONS.map((migration) => migration.id);
    assert.equal(new Set(ids).size, ids.length);
    const byId = new Map(MIGRATIONS.map(({ id, name }) => [id, name] as const));
    assert.equal(byId.get(7), 'proxy_aliases');
    assert.equal(byId.get(8), 'usenet');
    assert.equal(byId.get(28), 'usenet_undecodable');
  });
});
