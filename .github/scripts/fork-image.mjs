import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const image = 'ghcr.io/omgwtfwow/aiostreams';
export const source = 'https://github.com/omgwtfwow/AIOStreams';
const runners = { amd64: 'ubuntu-24.04', arm64: 'ubuntu-24.04-arm' };
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function configuration(env, now = new Date()) {
  assert.equal(env.GITHUB_REPOSITORY, 'omgwtfwow/AIOStreams');
  assert.match(env.SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(
    ['pull_request', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
  );
  const platforms = (env.INPUT_PLATFORMS || 'linux/amd64,linux/arm64')
    .split(',')
    .map((value) => value.trim());
  assert.equal(new Set(platforms).size, platforms.length, 'Duplicate platform');
  const include = platforms.map((platform) => {
    const architecture = platform.split('/')[1];
    assert.ok(
      platform === `linux/${architecture}` && runners[architecture],
      'Unsupported native platform'
    );
    return { platform, architecture, runner: runners[architecture] };
  });
  const fallback =
    env.GITHUB_EVENT_NAME === 'pull_request'
      ? `pr-${env.PR_NUMBER}-${env.SOURCE_SHA.slice(0, 7)}`
      : `fork-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${env.SOURCE_SHA.slice(0, 7)}`;
  const tag = env.INPUT_TAG || fallback;
  assert.match(tag, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'Invalid Docker tag');
  return { image, tag, sourceSha: env.SOURCE_SHA, matrix: { include } };
}

export function digestReferences(config, records) {
  assert.equal(
    records.length,
    config.matrix.include.length,
    'Missing or extra architecture artifact'
  );
  return config.matrix.include.map(({ platform }) => {
    const matches = records.filter((record) => record.platform === platform);
    assert.equal(matches.length, 1, 'Missing or duplicate platform digest');
    const record = matches[0];
    assert.equal(record.image, image, 'Wrong image owner');
    assert.equal(
      record.sourceSha,
      config.sourceSha,
      'Source revision mismatch'
    );
    assert.match(record.digest, digestPattern, 'Invalid image digest');
    return `${image}@${record.digest}`;
  });
}

export function verifyIndex(config, index) {
  assert.equal(index.annotations?.['org.opencontainers.image.source'], source);
  assert.equal(
    index.annotations?.['org.opencontainers.image.revision'],
    config.sourceSha
  );
  const platforms = index.manifests
    .filter(({ platform }) => platform?.os !== 'unknown')
    .map(({ platform, digest }) => {
      assert.match(digest, digestPattern);
      return `${platform?.os}/${platform?.architecture}`;
    });
  assert.deepEqual(
    platforms.sort(),
    config.matrix.include.map(({ platform }) => platform).sort()
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = configuration(process.env);
  if (process.argv[2] === 'prepare') {
    for (const [key, value] of Object.entries({
      image: config.image,
      tag: config.tag,
      source_sha: config.sourceSha,
      matrix: JSON.stringify(config.matrix),
    }))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } else if (process.argv[2] === 'digests') {
    const records = readdirSync(process.argv[3]).map((file) =>
      JSON.parse(readFileSync(path.join(process.argv[3], file), 'utf8'))
    );
    console.log(digestReferences(config, records).join('\n'));
  } else if (process.argv[2] === 'verify-index') {
    verifyIndex(config, JSON.parse(readFileSync(process.argv[3], 'utf8')));
    console.log('Image index platforms and source revision verified');
  } else {
    throw new Error('Expected prepare, digests, or verify-index');
  }
}
