import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'app.ts'),
  'utf8'
);

describe('AIOStreams route surface', () => {
  it('keeps current Stremio routes under /stremio only', () => {
    expect(appSource).toContain("stremioRouter.use('/manifest.json'");
    expect(appSource).toContain("stremioRouter.use('/stream'");
    expect(appSource).toContain("stremioRouter.use('/configure'");
    expect(appSource).toContain("stremioAuthRouter.use('/manifest.json'");
    expect(appSource).toContain("stremioAuthRouter.use('/stream'");
    expect(appSource).toContain("stremioAuthRouter.use('/configure'");
    expect(appSource).not.toContain("app.get('/configure'");
    expect(appSource).not.toContain("app.get('{/:config}/configure'");
  });

  it('does not serve legacy root stream reconfigure shims', () => {
    expect(appSource).not.toContain('{/:config}/stream/:type/:id.json');
    expect(appSource).not.toContain('requires you to reconfigure');
  });
});
