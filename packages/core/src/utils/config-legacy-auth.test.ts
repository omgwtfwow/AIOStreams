import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const utilsDir = dirname(fileURLToPath(import.meta.url));
const configSource = readFileSync(join(utilsDir, 'config.ts'), 'utf8');
const authSource = readFileSync(join(utilsDir, 'auth.ts'), 'utf8');
const constantsSource = readFileSync(join(utilsDir, 'constants.ts'), 'utf8');

describe('config auth migrations', () => {
  it('does not translate retired addon password or access token fields', () => {
    assert.equal(configSource.includes('addon' + 'Password'), false);
    assert.equal(configSource.includes('config.accessToken'), false);
  });

  it('does not migrate retired env password into config access key', () => {
    assert.equal(authSource.includes('ADDON_' + 'PASSWORD'), false);
    assert.equal(authSource.includes('CONFIG_ACCESS_KEY'), true);
  });

  it('uses config access key error naming', () => {
    assert.equal(constantsSource.includes('CONFIG_ACCESS_KEY_INVALID'), true);
    assert.equal(
      constantsSource.includes('ADDON_' + 'PASSWORD_INVALID'),
      false
    );
  });
});
