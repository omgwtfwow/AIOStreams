import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'aiostreams-proxy-aliases-'));
const secretKey =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'http://localhost:3000';
process.env.INTERNAL_URL = 'http://localhost:3000';
process.env.SECRET_KEY = secretKey;
process.env.DATABASE_URI = `sqlite://${path.join(tmp, 'db.sqlite')}`;
process.env.AIOSTREAMS_AUTH = 'admin:password';

describe('ProxyAliasRepository', () => {
  let db: typeof import('../db.js');
  let repository: typeof import('./proxy-aliases.js');

  before(async () => {
    // Production bootstraps config before the database. Match that import
    // order so the config -> tasks -> logger cycle is initialised exactly as
    // it is by the server entrypoint.
    await import('../../config/index.js');
    db = await import('../db.js');
    repository = await import('./proxy-aliases.js');
    await db.initDb(process.env.DATABASE_URI!);
  });

  after(async () => {
    await db.closeDb();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates idempotent encrypted aliases by stable key', async () => {
    const payload = {
      auth: { username: 'admin', password: 'password' },
      data: {
        url: 'http://nzbdav:3000/dav/movie.mkv?downloadKey=secret',
        filename: 'movie.mkv',
        type: 'stream' as const,
        requestHeaders: { range: 'bytes=0-1023' },
      },
    };

    const first = await repository.ProxyAliasRepository.createOrUpdate(
      'library-item:296176',
      payload
    );
    const second = await repository.ProxyAliasRepository.createOrUpdate(
      'library-item:296176',
      payload
    );

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);
    assert.deepEqual(
      await repository.ProxyAliasRepository.getPayload(first.id),
      payload
    );
  });

  it('revokes aliases and issues a new public id when the stable key returns', async () => {
    const payload = {
      auth: { username: 'admin', password: 'password' },
      data: {
        url: 'http://nzbdav:3000/dav/episode.mkv',
        filename: 'episode.mkv',
        type: 'stream' as const,
      },
    };

    const first = await repository.ProxyAliasRepository.createOrUpdate(
      'library-episode:1',
      payload
    );
    assert.equal(await repository.ProxyAliasRepository.revoke(first.id), true);
    assert.equal(
      await repository.ProxyAliasRepository.getPayload(first.id),
      null
    );

    const second = await repository.ProxyAliasRepository.createOrUpdate(
      'library-episode:1',
      payload
    );

    assert.notEqual(second.id, first.id);
    assert.deepEqual(
      await repository.ProxyAliasRepository.getPayload(second.id),
      payload
    );
  });
});
