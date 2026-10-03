# Fork Maintenance

This fork carries private deployment changes for the homeserver media stack.
Keep production deployments pinned to immutable fork image digests; do not deploy a
mutable `latest` tag from this fork.

Migration ID 7 is permanently reserved for the fork's `proxy_aliases`
migration because deployed databases already record it. Upstream migrations
starting with `0007_usenet.ts` are intentionally assigned IDs one greater
than their filenames in this fork. Keep that offset for future upstream syncs
and test upgrades from an existing proxy-alias database before release.

## Current Upstream Baseline

The fork includes upstream `v2.35.8` at
`70ffb17a7bb99dd73dbab257af040b04f56eaa42`. Its new migrations
`0028_watch_state` through `0041_index_trim` use fork IDs 29 through 42.
The migration rehearsal starts from a 2.34 database with an existing alias,
checks that the alias survives all new migrations, and repeats startup to
check idempotency. Rolling back this release requires restoring the database
backup as well as the previous image because older builds reject schema 42.

Stable `/s` and on-demand `/o` proxy aliases remain the only playback proxy
routes; legacy bearer-path proxy and auth routes remain retired. The upstream
server now includes Jellyfin-compatible APIs and a web UI; these do not replace
or reconfigure the separate Emby service in the media stack. Desktop release,
update-PR, and OS-matrix workflows remain upstream-owned and are disabled in
this server-image fork.

## Publish A Private Image Release

Use the `Fork Image` GitHub Actions workflow in this repository.

1. Open **Actions** -> **Fork Image** -> **Run workflow**.
2. Use a pinned tag such as `proxy-aliases-YYYYMMDD-<short-sha>`.
3. Keep the default `platforms=linux/amd64,linux/arm64` for a portable release
   tag. Hetzner currently needs `linux/arm64`, so do not publish an amd64-only
   release for production.
4. Leave `create_release=true`.
5. Deploy the resulting pinned image:

```text
ghcr.io/omgwtfwow/aiostreams@sha256:<published-index-digest>
```

PR checks build and run the image separately on native `ubuntu-24.04` (amd64)
and `ubuntu-24.04-arm` runners. Each architecture uses its own build cache and
verifies its image architecture, canonical OCI source, full revision label,
and embedded application metadata. Obsolete PR runs are cancelled; explicit
release runs are never cancelled by that concurrency policy.

PR jobs have only repository read permission and do not publish images.
Dispatch-only jobs publish each verified architecture by digest, validate that
all digest artifacts belong to the same source revision, and combine them into
an index with source/revision annotations. Only the final release-record job
receives repository write permission. Supported `platforms` values are
`linux/amd64`, `linux/arm64`, or both. An existing Git release tag must refer to
the selected source revision.

A workflow-only maintenance PR does not need an image publication or media-stack
rollout. Keep the deployed digest and its matching vendored source unchanged
until the next application release. Upstream Pages and Header Presets jobs are
owner-gated to `Viren070/AIOStreams`, like the inherited desktop workflows.

Validate workflow changes with `actionlint` and
`node --test .github/scripts/fork-image.test.mjs`. The PR's native image checks
exercise the shared build steps used by releases. Release manifest validation
can also be rehearsed with `docker buildx imagetools create --dry-run`, without
publishing a new tag.

## Local Verification

Run these before opening a fork PR:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm -F core test -- src/db/repositories/proxy-aliases.test.ts
pnpm -F core build
pnpm -F server build
pnpm run build
docker buildx build \
  --platform linux/arm64 \
  --build-arg OCI_SOURCE=https://github.com/omgwtfwow/AIOStreams \
  -t ghcr.io/omgwtfwow/aiostreams:local-check \
  --load .
git diff --check
```

If the local checkout has build artifacts, make sure Docker still builds from
source. `.dockerignore` excludes `dist/` and `*.tsbuildinfo` so incremental
TypeScript state cannot make Docker skip a required emit.

## Stay Current With Upstream

The upstream remote should point at `Viren070/AIOStreams`:

```bash
git remote -v
git remote add upstream https://github.com/Viren070/AIOStreams.git
git fetch upstream --tags
```

Sync through a normal PR, because fork patches mean `main` may not fast-forward
to upstream:

```bash
git checkout main
git pull --ff-only origin main
git fetch upstream --tags
git checkout -B codex/upstream-sync-YYYYMMDD
git merge upstream/main
```

Resolve conflicts by preserving the fork-only alias behavior unless upstream
has gained an equivalent supported feature. Then run the local verification
commands, open a PR to `main`, and publish a new pinned image release after the
PR is merged.

Useful drift check:

```bash
git log --left-right --cherry-pick --oneline upstream/main...main
```

## Deployment Rollback

Before each upgrade, save a consistent database backup and the current
immutable image reference. When the upgrade advances the database schema,
stop only AIOStreams and its shared-state migrator, restore that pre-upgrade
database backup, then recreate those services with the previous image. An
image-only rollback across schema versions is unsupported: the older build
refuses to use a newer database. Preserve the upgraded database separately
before restoring so rollback does not discard the only copy of new state.

```text
AIOSTREAMS_IMAGE=ghcr.io/omgwtfwow/aiostreams@sha256:<previous-known-good-digest>
```

Do not roll back by switching to fork `latest`; use the saved immutable digest.
