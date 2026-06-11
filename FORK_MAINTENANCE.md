# Fork Maintenance

This fork carries private deployment changes for the homeserver media stack.
Keep production deployments pinned to explicit fork image tags; do not deploy a
mutable `latest` tag from this fork.

## Publish A Private Image Release

Use the `Fork Image` GitHub Actions workflow in this repository.

1. Open **Actions** -> **Fork Image** -> **Run workflow**.
2. Use a pinned tag such as `proxy-aliases-YYYYMMDD-<short-sha>`.
3. Keep `platforms=linux/amd64` for the Hetzner deployment unless another
   platform is intentionally needed.
4. Leave `create_release=true`.
5. Deploy the resulting pinned image:

```text
ghcr.io/omgwtfwow/aiostreams:<tag>
```

The workflow also runs as a pull request check with `push=false`, so Docker
context and build failures should be caught before release.

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
  --platform linux/amd64 \
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

Rollback should be an image-pin change in the homeserver environment, followed
by recreating only AIOStreams-dependent services.

```text
AIOSTREAMS_IMAGE=ghcr.io/omgwtfwow/aiostreams:<previous-known-good-tag>
```

Do not roll back by switching to fork `latest`; use a known release tag.
