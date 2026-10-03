import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configuration,
  digestReferences,
  image,
  source,
  verifyIndex,
} from './fork-image.mjs';

const sha = 'a'.repeat(40);
const env = {
  GITHUB_REPOSITORY: 'omgwtfwow/AIOStreams',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  SOURCE_SHA: sha,
};
const config = configuration(env, new Date('2026-10-03T00:00:00Z'));
const records = ['amd64', 'arm64'].map((architecture, index) => ({
  image,
  sourceSha: sha,
  platform: `linux/${architecture}`,
  digest: `sha256:${String(index).repeat(64)}`,
}));
const index = {
  annotations: {
    'org.opencontainers.image.source': source,
    'org.opencontainers.image.revision': sha,
  },
  manifests: [
    ...records.map((record) => ({
      digest: record.digest,
      platform: { os: 'linux', architecture: record.platform.split('/')[1] },
    })),
    {
      digest: `sha256:${'9'.repeat(64)}`,
      platform: { os: 'unknown', architecture: 'unknown' },
    },
  ],
};

test('default release and PR matrices use native runners', () => {
  assert.equal(config.tag, `fork-20261003-${sha.slice(0, 7)}`);
  assert.deepEqual(
    config.matrix.include.map(({ runner }) => runner),
    ['ubuntu-24.04', 'ubuntu-24.04-arm']
  );
  assert.equal(
    configuration({
      ...env,
      GITHUB_EVENT_NAME: 'pull_request',
      PR_NUMBER: '18',
    }).tag,
    `pr-18-${sha.slice(0, 7)}`
  );
  assert.equal(
    configuration({ ...env, INPUT_PLATFORMS: 'linux/arm64' }).matrix.include
      .length,
    1
  );
});

test('unsupported platforms, duplicate architectures, wrong owner and unsafe inputs fail closed', () => {
  for (const overrides of [
    { INPUT_PLATFORMS: 'linux/arm/v7' },
    { INPUT_PLATFORMS: 'linux/amd64,linux/amd64' },
    { INPUT_PLATFORMS: 'linux/arm64,' },
    { INPUT_TAG: 'bad\ntag' },
    { INPUT_TAG: 'tag;echo surprise' },
    { SOURCE_SHA: 'main' },
    { GITHUB_REPOSITORY: 'another/AIOStreams' },
    { GITHUB_EVENT_NAME: 'push' },
  ])
    assert.throws(() => configuration({ ...env, ...overrides }));
});

test('release references use exact digests from both verified architectures', () => {
  assert.deepEqual(
    digestReferences(config, [...records].reverse()),
    records.map(({ digest }) => `${image}@${digest}`)
  );
});

test('release refuses missing, duplicated, mismatched or untrusted digest artifacts', () => {
  for (const candidate of [
    records.slice(0, 1),
    [...records, records[0]],
    [records[0], records[0]],
    [{ ...records[0], sourceSha: 'b'.repeat(40) }, records[1]],
    [{ ...records[0], image: 'ghcr.io/another/aiostreams' }, records[1]],
    [{ ...records[0], digest: 'latest' }, records[1]],
  ])
    assert.throws(() => digestReferences(config, candidate));
});

test('final index preserves requested platforms, provenance, and attestations', () => {
  verifyIndex(config, index);
  for (const candidate of [
    { ...index, annotations: {} },
    {
      ...index,
      annotations: {
        ...index.annotations,
        'org.opencontainers.image.revision': 'b'.repeat(40),
      },
    },
    { ...index, manifests: index.manifests.slice(0, 1) },
    { ...index, manifests: [...index.manifests, index.manifests[0]] },
  ])
    assert.throws(() => verifyIndex(config, candidate));
});
