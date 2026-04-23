# Terminal X — Pre-Release Checklist

**Rule: every box checked before `gh release upload`. No exceptions.**

Last updated: 2026-04-22 (after v2.13.2 sentry-scrub asar boot-crash incident)

---

## 0. Before you build

- [ ] Working tree clean (`git status` empty)
- [ ] `package.json` version bumped + matches the intended tag (`v2.13.X`)
- [ ] CHANGELOG / `CLAUDE.md` "Current Release" block updated with what changed
- [ ] `npm run build:web` passes (web PWA also compiles)
- [ ] Ranoza E2E smoke 22/22 (`node scripts/ranoza-e2e-smoke.mjs`)

## 1. Build the installer

- [ ] **Close any running `npm run dev`** — it races `dist/` and will corrupt the build (see `feedback_dev_server_dist_race`)
- [ ] `npm run dist:win`
  - This now auto-runs `verify:build` at the end:
    - `scripts/verify-asar.cjs` — asserts required files are inside `app.asar` (tripwire for the v2.13.2 class of bug)
    - `scripts/smoke-test-build.cjs` — launches `dist/win-unpacked/Terminal X.exe` for 15s in a sandbox user-data-dir, fails on crash dialog or "Uncaught Exception" in output
- [ ] Build exits 0. If `verify-asar` or smoke-test fails, STOP — don't ship.

## 2. Stash the artifacts

`npm run dev` watches `dist/` and overwrites the installer in ~30s. Move them out immediately:

```bash
mkdir -p release-staging
cp "dist/Terminal.X-Setup-<version>.exe" "dist/Terminal.X-Setup-<version>.exe.blockmap" "dist/latest.yml" release-staging/
```

- [ ] `release-staging/` contains all 3 files: `.exe`, `.exe.blockmap`, `latest.yml`
- [ ] `latest.yml` `version:` field matches `package.json` version

## 3. Manual smoke on a real Windows box (first of each minor)

Only required for `X.Y.0` releases, not patches. The automated smoke catches 95% of boot crashes; this catches the other 5% (e-CF signing, printer IPC, SQLCipher migration).

- [ ] Uninstall previous version, wipe `%LOCALAPPDATA%\terminal-x-updater` + `%APPDATA%\terminal-x`
- [ ] Install fresh
- [ ] App opens, login works, license validates online
- [ ] POS cart + cobrar + ticket print works
- [ ] e-CF submit works (testecf env OK)

## 4. Publish to GitHub Releases

```bash
gh release create v<version> --title "v<version> — <one-line>" --notes "<changelog>"
gh release upload v<version> release-staging/Terminal.X-Setup-<version>.exe release-staging/Terminal.X-Setup-<version>.exe.blockmap release-staging/latest.yml
```

- [ ] `gh release view v<version> --json assets` returns **all 3** assets (`.exe`, `.exe.blockmap`, `latest.yml`)
  - **Known quirk**: 200MB+ uploads report HTTP 404 but the upload actually succeeds. Always verify with `--json assets` before retrying — a retry fails with `already_exists` (see `feedback_gh_release_upload_404`)

## 5. Post-release

- [ ] Auto-updater on a test install picks up the new version within 5 min
- [ ] Delete `release-staging/` so next build starts clean
- [ ] Bump `package.json` to next dev version if starting new work

---

## When the automated checks fire

### `[verify-asar] FAIL: required files missing`
A file listed in `scripts/verify-asar.cjs` REQUIRED is not inside `app.asar`. Fix: add its path to `build.files` in `package.json`. If it's a new file the runtime requires, also add it to the REQUIRED list so future builds enforce it.

### `[smoke-test] FAIL: process exited early`
The packaged `.exe` crashed within 15s of launch. Check the printed stderr — usually "Cannot find module X" (missing from asar → add to `build.files`) or a native-module ABI mismatch (run `npm rebuild better-sqlite3`).

### `[smoke-test] FAIL: fatal pattern in output`
Process is running but spat an uncaught exception. Usually an unhandled promise rejection in `electron/main.js` startup. Check Sentry or open the build manually and look at DevTools console.

---

## What we added and why

| Artifact | What it catches |
|---|---|
| `scripts/verify-asar.cjs` | Missing-from-asar files. Would have caught the v2.13.2 sentry-scrub bug. |
| `scripts/smoke-test-build.cjs` | Any runtime crash within 15s of boot, in the packaged `.exe` (not dev mode). |
| This checklist | Human-process failures (skipping a build step, uploading without latest.yml, forgetting to close dev server). |

These run **automatically** on `npm run dist:win`. The checklist is for the steps a script can't do.
