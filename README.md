# Marketplace Updates

Check and apply updates for Directus extensions installed from the Marketplace. Native Directus can install, reinstall the same version, and uninstall Marketplace extensions, but it never checks for a newer release and the Studio Marketplace page cannot install an older version. This extension fills both gaps.

It also helps with **local extensions** (copies you dropped into the project yourself): upload a built package, and — when that package is also listed on the Marketplace — switch it over so future updates go through the registry.

Open **Settings → Extension Updates** (admins only). A notice also appears on **Settings → Marketplace** and **Settings → Extensions** when Marketplace updates are waiting. Those notices do not include local extensions.

<img alt="Extension Updates — Marketplace extensions list" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/marketplace_updates.png" width="800" />

## Features

- Lists Marketplace-installed extensions and compares each with the latest Marketplace release
- Updates one extension at a time, or **Update All** for what is currently listed (this checker is applied last)
- **Choose Version** — install any published Marketplace release (upgrade or rollback). Releases that are missing their built files are blocked so they cannot break Studio
- **Show Local Extension Updates** — optional list of local copies. Local entries appear first. If a copy matches a Marketplace listing, **Update** or **Choose Version** switches it to a Marketplace install. If there is no listing, it is marked **Not on Marketplace** and can only be replaced by upload
- **Upload ZIP** — install or replace a local extension from a `.zip` or `.tgz`. Drag and drop, or browse. The archive must include `package.json` and the built files (usually a `dist/` folder). You cannot overwrite an extension that is already installed from the Marketplace this way
- Packages with missing built files are blocked. Enabled Marketplace installs that are already incomplete on disk are disabled so other Studio extensions can still load — then use Choose Version to restore a complete release
- Extensions installed via npm into `node_modules` are not managed here
- Hidden from the left module bar; added next to native **Extensions** / **Marketplace** in Settings

### Choose Version / rollback

Native Marketplace only offers the latest release. **Choose Version** shows every published version, skips corrupt packages, and lets you install a specific one — newer or older.

For a local copy that matches a Marketplace listing, the same picker switches it to that Marketplace version.

<img alt="Choose Version — pick an older or newer Marketplace release" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/marketplace_versions.png" width="800" />

When Marketplace updates are available, a summary banner appears on the native Marketplace and Extensions pages:

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

- A local copy is matched to the Marketplace by the exact package name. If Marketplace is older than your local copy, you still see a warning; Choose Version can switch anyway.
- Compatibility ranges published on Marketplace are **advisory only**. Publishers often leave them outdated, so a mismatch does not block Update.
- Updating this checker itself is applied last. Reload the Data Studio afterwards.

## License

MIT
