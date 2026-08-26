# Marketplace Updates

Check and apply updates for Directus extensions installed from the Marketplace. Native Directus can install, reinstall the same version, and uninstall Marketplace extensions, but it never checks for a newer registry release and the Studio Marketplace page cannot install an older version. This extension fills both gaps.

Open **Settings → Extension Updates** (admins only). A notice also appears on **Settings → Marketplace** and **Settings → Extensions** when updates are waiting.

<img alt="Extension Updates — Marketplace extensions list" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/marketplace_updates.png" width="800" />

## Features

- Lists every extension installed with `source: registry` (Marketplace)
- Compares the installed semver with the latest Marketplace version
- Updates one extension at a time, or **Update all** (checker applied last)
- **Choose Version** — pick any published Marketplace release (newer or older), including rollback when latest is broken
- Verifies Marketplace packages before uninstall (blocks corrupt publishes missing `dist/` entry files)
- On load, **disables** enabled Marketplace installs whose entry files are missing on disk. Directus bundles all Studio extensions in one file — one missing `dist` would otherwise hide this updater too. After reload, Extension Updates / Marketplace show a **Corrupt install** banner. Use Choose Version to install a complete release, then enable it again.
- Restores a disabled state after update. If install fails (or the extracted package is missing entry files), uninstalls the failed version first, then reinstalls the previous Marketplace UUID — a second `install()` cannot run while the new row still exists
- Skips local folder and npm (`node_modules`) installs — those are not Marketplace-updatable
- Hidden from the left module bar; added next to native **Extensions** / **Marketplace** in Settings

### Choose Version / rollback

Native Marketplace only offers the latest release. **Choose Version** loads every version from the registry, runs an integrity check on each tarball, and lets you install a specific version UUID (upgrade or downgrade). Corrupt packages are shown as blocked so they cannot wipe Studio extensions the way a bad latest release can.

<img alt="Choose Version — pick an older or newer Marketplace release" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/marketplace_versions.png" width="800" />

When updates are available, a summary banner appears on the native Marketplace and Extensions pages:

<img alt="Marketplace update banner" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/marketplace_banner.png" width="800" />

<img alt="Extensions update banner" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/extensions_banner.png" width="800" />

## Installation

Requires **Directus 10.10+** (Marketplace registry APIs).

### npm

```bash
npm install directus-extension-marketplace-updates
```

Place the package in your Directus `extensions` folder (or install into a project that loads extensions from `node_modules`), then restart Directus.

### Manual installation

1. Install and build:

```bash
cd directus-extension-marketplace-updates
npm install
npm run build
```

2. Copy the built package into your Directus `extensions` folder (include `package.json` and the `dist` folder).

3. Restart Directus.

4. Sign in as an admin and open **Settings → Extension Updates**, or go to `/admin/extension-updates`.

## Notes

- Latest **npm** and latest **Marketplace** can differ. Apply always uses the Marketplace version UUID, not npm.
- Declared Marketplace `host_version` ranges are **advisory only**. Publishers often leave them outdated, so a mismatch does not block Update.
- Packages that fail integrity (for example missing `dist/index.js`) are blocked on Update / Update all and marked **Update blocked** when latest is corrupt but your install is fine.
- Native uninstall/install reloads **all** API extensions twice per package (often 45–60s). `/apply` returns **202** after the integrity check and installs in the background so reverse proxies do not time out the request. The Studio page polls `/status` until the new version is on disk, then continues.
- Updating this checker itself is applied last. Reload the Data Studio afterwards.

## License

MIT
