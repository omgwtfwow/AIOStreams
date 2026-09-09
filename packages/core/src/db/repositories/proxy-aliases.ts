import { randomBytes, createHash } from 'crypto';
import { getDb } from '../db.js';
import { sql } from '../sql.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('proxy-aliases');

export interface ProxyAliasAuth {
  username: string;
  password: string;
}

export interface ProxyAliasData {
  url: string;
  filename?: string;
  type?: 'nzb' | 'stream';
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface ProxyAliasPayload {
  auth: ProxyAliasAuth;
  data: ProxyAliasData;
}

interface ProxyAliasRow {
  id: string;
  stable_key_hash: string;
  payload: string;
  revoked_at?: string | Date | null;
  [k: string]: unknown;
}

function hashStableKey(stableKey: string): string {
  return createHash('sha256').update(stableKey).digest('hex');
}

function createAliasId(): string {
  return `pa_${randomBytes(18).toString('base64url')}`;
}

async function encryptPayload(payload: ProxyAliasPayload): Promise<string> {
  // Loading the config-backed crypto module lazily avoids a startup cycle:
  // config -> tasks -> db barrel -> proxy aliases -> crypto -> config.
  const { encryptString } = await import('../../utils/crypto.js');
  const encrypted = encryptString(JSON.stringify(payload));
  if (!encrypted.success || !encrypted.data) {
    throw new Error(encrypted.error || 'Failed to encrypt proxy alias payload');
  }
  return encrypted.data;
}

async function decryptPayload(
  payload: string
): Promise<ProxyAliasPayload | null> {
  const { decryptString } = await import('../../utils/crypto.js');
  const decrypted = decryptString(payload);
  if (!decrypted.success || !decrypted.data) {
    logger.warn('Failed to decrypt proxy alias payload', {
      error: decrypted.error,
    });
    return null;
  }

  try {
    return JSON.parse(decrypted.data) as ProxyAliasPayload;
  } catch (error) {
    logger.warn('Failed to parse proxy alias payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export class ProxyAliasRepository {
  static async createOrUpdate(
    stableKey: string,
    payload: ProxyAliasPayload
  ): Promise<{ id: string; created: boolean }> {
    const stableKeyHash = hashStableKey(stableKey);
    const encryptedPayload = await encryptPayload(payload);
    const db = getDb();

    return db.tx(async (tx) => {
      const existing = await tx.maybeOne<ProxyAliasRow>(
        sql`SELECT id, revoked_at
            FROM proxy_aliases
            WHERE stable_key_hash = ${stableKeyHash}`
      );

      if (existing) {
        const id = existing.revoked_at ? createAliasId() : existing.id;
        await tx.exec(
          sql`UPDATE proxy_aliases
              SET id = ${id},
                  payload = ${encryptedPayload},
                  updated_at = CURRENT_TIMESTAMP,
                  revoked_at = NULL
              WHERE stable_key_hash = ${stableKeyHash}`
        );
        return { id, created: false };
      }

      const id = createAliasId();
      await tx.exec(
        sql`INSERT INTO proxy_aliases (id, stable_key_hash, payload)
            VALUES (${id}, ${stableKeyHash}, ${encryptedPayload})`
      );
      return { id, created: true };
    });
  }

  static async getPayload(id: string): Promise<ProxyAliasPayload | null> {
    const row = await getDb().maybeOne<ProxyAliasRow>(
      sql`SELECT payload
          FROM proxy_aliases
          WHERE id = ${id}
            AND revoked_at IS NULL`
    );
    if (!row) {
      return null;
    }

    return decryptPayload(row.payload);
  }

  static async revoke(id: string): Promise<boolean> {
    const result = await getDb().exec(
      sql`UPDATE proxy_aliases
          SET revoked_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
            AND revoked_at IS NULL`
    );
    return result.rowCount > 0;
  }
}
