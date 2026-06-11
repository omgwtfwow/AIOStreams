import type { Migration } from './types.js';

export const proxyAliases: Migration = {
  id: 7,
  name: 'proxy_aliases',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS proxy_aliases (
        id TEXT PRIMARY KEY,
        stable_key_hash TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_proxy_aliases_revoked_at
        ON proxy_aliases(revoked_at);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS proxy_aliases (
        id TEXT PRIMARY KEY,
        stable_key_hash TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_proxy_aliases_revoked_at
        ON proxy_aliases(revoked_at);
    `,
  },
};
