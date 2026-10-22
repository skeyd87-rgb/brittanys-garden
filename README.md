# Brittany's Garden

A mobile PWA for Brittany's personal container garden care.

## Current App

Open [Brittany's Garden](https://brittanys-garden.vercel.app/) on the phone, or run `npm run dev` for a local preview. The app uses JavaScript modules and must be served over HTTP(S), not opened as a local HTML file.

The current build is a static mobile web app that can be added to a phone home screen. It includes:

- Guided first run: location, first plant, then daily care
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
- Independent, dated water/feed/trim/harvest completion with correct next-day rollover
- A soil/harvest check can be marked not needed without falsely logging care
- Undo the last logged care action and restore its original due date
- Care Board and planter badges reflect overdue schedules
- Safe save failures, last-good-copy recovery, and portable JSON backup/restore
- Plant archiving and restoration without deleting the journal
- Full journal retention with older entries loaded on demand
- Optional recurring phone-calendar reminder
- A phone handoff checklist and seven-day trial tracker

## Saving and Recovery

The existing `brittanys-garden-mobile-v3` storage key is preserved. Loading never writes or deletes the saved record. Saves rotate a validated previous copy into `:backup`; a failed write leaves the old record intact and displays a persistent warning. If the main record is unreadable, the last good copy is shown with saving paused until an explicit restore.

Setup downloads a versioned JSON backup and previews an imported file before replacing anything. Invalid files, unsupported formats, duplicate plant IDs, unsafe fields, and files larger than 4 MB are rejected. Restoring a file does not opt into an external AI helper address. Downloaded backups include all journal entries, active plants, archived plants, schedules, and settings. A backup is a file transfer, not automatic cloud sync. Another browser, phone, or origin starts with separate device data.

## Daily Reminder

Setup lets Brittany choose a local time and add one recurring daily garden check to her phone calendar. The `/api/daily-reminder` endpoint serves a stable iCalendar subscription with one daily event and an alarm. A downloadable `.ics` file is also available. The phone calendar handles reminders while the garden app is closed; this app does not implement Web Push.

Finish adding the event/subscription in Calendar and enable alerts there. Calendar permission and delivery must be checked on the actual phone. Changing the time in Garden does not silently edit a previously imported event: edit or remove the old reminder in Calendar before adding another. An iPhone can also add the copied URL using Calendar's Add Subscription Calendar option. [Apple instructions](https://support.apple.com/en-lamr/guide/iphone/iph3d1110d4/ios).

## Barcode and AI Limits

Barcode scanning uses the browser's native BarcodeDetector API when available and a bundled ZXing fallback elsewhere. Standard UPC/EAN values are checked server-side against UPCitemdb's no-key catalog tier. Catalog misses fall back to front/back packet photos analyzed by the private AI service. Results always require review and an explicit Apply before changing the form.

UPCitemdb's free catalog tier is limited to 100 requests per day and 6 lookups per minute. Seed coverage is incomplete, so packet photos are the stronger source for variety, planting depth, spacing, and maturity details.

AI advice runs in `api/garden-advice.js` through Vercel AI Gateway. Deployed Vercel Functions use an automatically supplied OIDC credential, so no AI API key is exposed in browser code. The endpoints apply origin checks, bounded inputs and outputs, timeouts, and best-effort per-instance request limits. On October 22, 2026, a $5 monthly AI Gateway budget was configured and read back for the `brittanys-garden` project. This meters OIDC requests from this project. Vercel budgets are soft limits: the request that crosses the limit completes. Other apps and hosting usage are outside that AI budget.

## Vercel Deployment

The repository is connected to the `brittanys-garden` Vercel project. The app uses `/api/garden-advice` automatically on Vercel, and the GitHub Pages build calls the same private service. Set `ALLOWED_ORIGINS` only when adding another frontend origin.

Live AI advice, seed lookup, location search, and weather returned HTTP 200 during October 22 service verification using test inputs. AI spending-limit and connection failures preserve the manual workflow and built-in guides. Account credit availability can still affect future requests.

For local API development, create an AI Gateway key and set `AI_GATEWAY_API_KEY` in `.env.local`. Environment files are ignored by Git.

## Weather Source

Weather uses Open-Meteo's forecast API with the latitude and longitude selected in Setup. It is forecast/model data, so it is useful for garden context but not a precise backyard sensor reading.

## Project Notes

- `outputs/brittanys-garden-cozy-companion.html` is the current app.
- `outputs/garden-reliability.js` contains shared snapshot validation, safe saving, streaks, and Calendar generation.
- `outputs/brittanys-garden-prototype.html` is the earlier reference version.
- `outputs/manifest.webmanifest` and `outputs/sw.js` support add-to-home-screen behavior.
- `design-qa.md` records the prior design QA pass.
- Root-level `cozy-companion-*.png` files are historical screenshots, not current acceptance evidence.

## Release Checks and Brittany's Handoff

Run `npm test` for the persistence, migration, care scheduling, backup, Calendar, AI, and seed helper checks. The October 22 readiness pass also exercises 390px mobile and 1440px desktop views, duplicate-tap prevention, next-day care, archive/restore, undo, backup transfer to a fresh browser, malformed imports, full-device save failures and retry, offline reloads, AI failure/review behavior, camera-denied fallback, and photo review/apply with controlled service responses.

The remaining physical acceptance is deliberately recorded as unchecked in Setup. On Brittany's phone:

1. Open the same published link and add it to the home screen.
2. Add three real plants and review their initial care plans against the packet and growing conditions.
3. Try a real seed packet scan and front/back photos, including the manual fallback.
4. Open online once, then use airplane mode to reopen and log care. Reconnect and check that it remains saved.
5. Download a backup and inspect its preview. Confirm the optional Calendar reminder actually alerts, or choose no reminder.
6. Start the seven-day trial in Setup. Review next-day task rollover, ease of daily use, and any reported problems before calling the handoff complete.

## Local Preview

Use the included Node 24 preview server:

```powershell
npm run dev
```

Open `http://127.0.0.1:7432/`. The server supports the Calendar endpoint and the same local AI routes; AI calls need local credentials to run. Automated browser tests use isolated test profiles and controlled responses for error paths, not Brittany's garden data.
