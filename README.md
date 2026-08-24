# Marketplace Updates

Check and apply updates for Directus extensions installed from the Marketplace. Directus can install, reinstall the same version, and uninstall marketplace extensions — it does not compare installed versions with newer registry releases.

Open **Settings → Extension Updates** (admins only). A notice also appears on **Settings → Extensions** when updates are waiting.

<img alt="Extension Updates — marketplace extensions list" src="https://raw.githubusercontent.com/domdus/directus-extension-marketplace-updates/main/docs/extension-updates.png" width="800" />

## Features

- Lists every extension installed with `source: registry` (marketplace)
- Compares the installed semver with the latest marketplace version
- Updates one extension at a time: uninstall, then install the new version UUID
- Restores a disabled state after update, and rolls back to the previous version UUID if install fails
- Skips local folder and npm (`node_modules`) installs — those are not marketplace-updatable
- Hidden from the left module bar; added next to native **Extensions** / **Marketplace** in Settings

## Installation

Requires **Directus 10.10+** (marketplace registry APIs).

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

- Latest **npm** and latest **marketplace** can differ. Apply always uses the marketplace version UUID, not npm.
- Declared marketplace `host_version` ranges are **advisory only**. Publishers often leave them outdated, so a mismatch does not block Update.
- Updating this checker itself unloads its API mid-flight in theory; the handler stays in memory for the request, then you must reload. Apply other extensions first when both need updates.

## License

MIT
