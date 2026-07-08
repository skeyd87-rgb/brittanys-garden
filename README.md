# Brittany's Garden

A browser prototype for Brittany's container garden care companion.

## Current App

Open `index.html`, `outputs/index.html`, or `outputs/brittanys-garden-cozy-companion.html` in a browser.

The current build is a static mobile web app that can be added to a phone home screen. It includes:

- Today view
- Care Board
- Planters view
- Plant detail view
- Garden Journal
- Local demo data and generated plant assets
- Home-screen manifest
- Offline cache
- Local saved care state

## Project Notes

- `outputs/brittanys-garden-cozy-companion.html` is the current active prototype.
- `outputs/brittanys-garden-prototype.html` is the earlier reference version.
- `outputs/manifest.webmanifest` and `outputs/sw.js` support add-to-home-screen behavior.
- `design-qa.md` records the prior design QA pass.
- Root-level `cozy-companion-*.png` files are screenshots from the current version.

## Local Preview

Serve the folder locally, then open `/outputs/`:

```powershell
python -m http.server 7432
```

