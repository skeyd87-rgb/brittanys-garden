# Brittany's Garden

A mobile PWA for Brittany's personal container garden care.

## Current App

Open `index.html`, `outputs/index.html`, or `outputs/brittanys-garden-cozy-companion.html` in a browser.

The current build is a static mobile web app that can be added to a phone home screen. It includes:

- Blank-slate first run
- Add and edit plants
- Seed package UPC, EAN, Code 128, and QR capture with manual fallback
- Exact UPC/EAN product lookup plus front/back packet photo extraction
- Built-in plant guide presets for common container plants
- Private AI guidance through a Vercel Function and AI Gateway
- Reviewed AI care suggestions that prefill the edit form before saving
- Per-plant care directions for watering, feeding, and harvest cues
- Repeat-aware due dates from notes like "in 3 days" plus plant and garden-wide 7-day calendars
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

## Barcode and AI Limits

Barcode scanning uses the browser's native BarcodeDetector API when available and a bundled ZXing fallback elsewhere. Standard UPC/EAN values are checked server-side against UPCitemdb's no-key catalog tier. Catalog misses fall back to front/back packet photos analyzed by the private AI service. Results always require review and an explicit Apply before changing the form.

UPCitemdb's free catalog tier is limited to 100 requests per day and 6 lookups per minute. Seed coverage is incomplete, so packet photos are the stronger source for variety, planting depth, spacing, and maturity details.

AI advice runs in `api/garden-advice.js` through Vercel AI Gateway. Deployed Vercel Functions use an automatically supplied OIDC credential, so no AI API key is exposed in browser code. The endpoint applies origin checks, bounded inputs and outputs, and a best-effort per-instance request limit. Configure a Vercel project budget for durable cost control.

## Vercel Deployment

The repository is connected to the `brittanys-garden` Vercel project. The app uses `/api/garden-advice` automatically on Vercel, and the GitHub Pages build calls the same private service. Set `ALLOWED_ORIGINS` only when adding another frontend origin.

Vercel requires a valid billing method on the team before AI Gateway unlocks its included credits. Add that once in the Vercel AI Gateway dashboard, then set a small monthly budget before giving Brittany the AI button.

For local API development, create an AI Gateway key and set `AI_GATEWAY_API_KEY` in `.env.local`. Environment files are ignored by Git.

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
