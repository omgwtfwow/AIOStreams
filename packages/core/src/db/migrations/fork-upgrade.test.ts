import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS } from './index.js';

// Match the real 2.34 fork schema rather than testing only a fresh database:
// deployed aliases already own ID 7 and upstream migrations end at fork ID 28.
describe('fork 2.34 to 2.35 database upgrade', () => {
  it('preserves an existing alias and applies the new schema idempotently', async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'aiostreams-fork-upgrade-')
    );
    const filename = path.join(directory, 'db.sqlite');
    const database = new Database(filename);
    database.pragma('foreign_keys = ON');
    database.exec(
      'CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'
    );
    for (const migration of MIGRATIONS.filter(({ id }) => id <= 28)) {
      database.exec(migration.up.sqlite);
      database
        .prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')
        .run(migration.id, migration.name);
    }
    database
      .prepare(
        'INSERT INTO proxy_aliases (id, stable_key_hash, payload) VALUES (?, ?, ?)'
      )
      .run(
        'existing-alias',
        'existing-stable-key-hash',
        'encrypted-payload-fixture'
      );
    database.close();

    // Production imports config before the migration runner to initialise
    // the config/tasks/logger cycle in the supported order.
    await import('../../config/index.js');
    const { SqliteDriver } = await import('../driver/sqlite.js');
    const { runMigrations, assertSchemaUpToDate } = await import('./runner.js');
    const driver = new SqliteDriver(filename);
    try {
      await runMigrations(driver);
      await assertSchemaUpToDate(driver);
      await runMigrations(driver);
      assert.equal(await driver.count('SELECT COUNT(*) FROM _migrations'), 42);
      assert.deepEqual(
        await driver.one(
          'SELECT id, stable_key_hash, payload FROM proxy_aliases'
        ),
        {
          id: 'existing-alias',
          stable_key_hash: 'existing-stable-key-hash',
          payload: 'encrypted-payload-fixture',
        }
      );
      assert.equal(
        await driver.count(
          "SELECT COUNT(*) FROM _migrations WHERE id = 7 AND name = 'proxy_aliases'"
        ),
        1
      );
      assert.equal(
        await driver.count(
          "SELECT COUNT(*) FROM _migrations WHERE id = 29 AND name = 'watch_state'"
        ),
        1
      );
      assert.deepEqual(await driver.query('PRAGMA foreign_key_check'), []);
      assert.deepEqual(await driver.one('PRAGMA quick_check'), {
        quick_check: 'ok',
      });
    } finally {
      await driver.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
