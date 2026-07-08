# Brittany's Garden

A browser prototype for Brittany's container garden care companion.

## Current App

Open `index.html`, `outputs/index.html`, or `outputs/brittanys-garden-cozy-companion.html` in a browser.

The current build is a static mobile web app that can be added to a phone home screen. It includes:

- Blank-slate first run
- Add and edit plants
- Per-plant care directions for watering, feeding, and harvest cues
- Selectable location search
- Live current weather for the selected location via Open-Meteo
- Today view
- Care Board
- Planters view
- Plant detail view
- Garden Journal
- Editable setup fields
- In-app How To section
- Local saved data and generated plant assets
- Home-screen manifest
- Offline cache

## Notification Limit

The current PWA tracks care inside the app. It does not send phone push notifications yet.
- Local saved care state

## Weather Source

Weather uses Open-Meteo's forecast API with the latitude and longitude selected in Setup. It is forecast/model data, so it is useful for garden context but not a precise backyard sensor reading.

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
