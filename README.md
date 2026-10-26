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
- Private Google sign-in and automatic cloud saving, plus an offline device copy
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

### Private cloud saving

Garden uses its own Firebase project, `brittanys-garden-skeyd87`, not Books' project or data. On October 25, 2026, project creation succeeded after the earlier quota block. Google sign-in was enabled and the default Firestore database was created in `us-east1` on the free tier with deletion protection. Billing is disabled. The existing Vercel AI service and its separate AI budget are unchanged.

Open the canonical [Garden link](https://brittanys-garden.vercel.app/) and choose Continue with Google. Only the two verified household accounts listed in `firestore.rules` can read or write `gardens/brittany`; collection listing, other document paths, and deletion are denied. Signed-out and unapproved accounts do not see the private garden UI. A remembered authorized sign-in can reopen the device copy offline. Signing out hides the data but intentionally retains device recovery records; this is not encryption or a shared-computer secure-erasure feature.

The `Saved to cloud` indicator means a server read or transaction has confirmed the saved garden. `Saving` is not a success claim. Offline edits are queued in IndexedDB and retried on reconnection, focus, or the visible-app retry interval. If IndexedDB is unavailable, a separately verified localStorage fallback is attempted. If neither device store works, the app warns to keep it open; successful online cloud saves still work. `garden-sync.js` owns the tested sync engine, and `garden-cloud.js` adapts the Firebase browser SDK and sign-in UI callbacks.

The cloud document stores a validated JSON snapshot, a version counter, server timestamp, and authenticated writer UID. A transaction checks the previous version before replacing it. This deliberately prevents silent last-writer-wins data loss. Simultaneous/offline edits that meet another device's newer version require a visible choice. The other copy is retained in device recovery storage before an explicit replacement; Setup can preview it without changing anything. An open plant form is not discarded by incoming snapshots.

On first sign-in, a valid old device garden migrates automatically only when the cloud is empty. A fresh empty device loads an existing cloud garden without uploading a blank one. Two different existing gardens show counts and a choice. Unreadable original device records are retained, not treated as empty data. They can be recovered from a good copy, or explicitly replaced with the displayed garden after confirmation. Keep the original phone link and do not clear site data during migration.

The old GitHub Pages home-screen app now moves its saved copy to the canonical Vercel address before starting Google sign-in. Merely authorizing the GitHub domain still returned an iPhone to the signed-out screen because the app and its sign-in helper used different origins. The canonical host's first-party proxy follows [Firebase's redirect guidance](https://firebase.google.com/docs/auth/web/redirect-best-practices). No Firebase session is started on the old host. Continue there makes a bounded top-level HTTPS form POST to `/api/move-garden`, with no garden contents or credentials in a URL. The endpoint validates the exact permitted source and snapshot, returns an uncached receiver, and does not access Firestore. The receiver verifies a separate device copy before opening the current app. A second Continue tap starts sign-in there.

The source records stay intact. A new, empty destination may be seeded with the moved copy; an existing or protected destination requires review after approved sign-in. Setup can review the old copy and the destination copy retained before an explicit replacement. Deterministic receipts prevent another use of the old icon from importing the same copy over later changes. Storage/size failures stop the move with recovery instructions. The canonical Vercel address is the supported cloud/PWA origin. On iPhone, keep the old icon until the current address says Saved to cloud; then use Safari's Add to Home Screen for the current address.

Cloud snapshots are capped at 890,000 UTF-8 bytes, below Firestore's 1 MiB document limit. Oversized gardens are rejected with a visible warning and no truncation. This is one private household garden, not a public multi-user service. No paid backup/PITR service or server-side reminder system has been enabled.

### Legacy and optional file recovery

The existing `brittanys-garden-mobile-v3` storage key is preserved. Loading never writes or deletes the saved record. Saves rotate a validated previous copy into `:backup`; a failed write leaves the old record intact and displays a persistent warning. If the main record is unreadable, the last good copy is shown with saving paused until an explicit restore.

Setup can still download an optional versioned JSON backup and preview an imported file before replacing anything. Invalid files, unsupported formats, duplicate plant IDs, unsafe fields, and files larger than 4 MB are rejected. Restoring a file does not opt into an external AI helper address. Downloaded backups include all journal entries, active plants, archived plants, schedules, and settings. Normal cross-device use now signs into the cloud instead of transferring files. A reviewed restore can use the independent device database when the legacy localStorage write fails.

## Daily Reminder

Setup lets Brittany choose a local time and add one recurring daily garden check to her phone calendar. The `/api/daily-reminder` endpoint serves a stable iCalendar subscription with one daily event and an alarm. A downloadable `.ics` file is also available. The phone calendar handles reminders while the garden app is closed; this app does not implement Web Push.

Finish adding the event/subscription in Calendar and enable alerts there. Calendar permission and delivery must be checked on the actual phone. Changing the time in Garden does not silently edit a previously imported event: edit or remove the old reminder in Calendar before adding another. An iPhone can also add the copied URL using Calendar's Add Subscription Calendar option. [Apple instructions](https://support.apple.com/en-lamr/guide/iphone/iph3d1110d4/ios).

## Barcode and AI Limits

Barcode scanning uses the browser's native BarcodeDetector API when available and a bundled ZXing fallback elsewhere. Standard UPC/EAN values are checked server-side against UPCitemdb's no-key catalog tier. Catalog misses fall back to front/back packet photos analyzed by the private AI service. Results always require review and an explicit Apply before changing the form.

UPCitemdb's free catalog tier is limited to 100 requests per day and 6 lookups per minute. Seed coverage is incomplete, so packet photos are the stronger source for variety, planting depth, spacing, and maturity details.

AI advice runs in `api/garden-advice.js` through Vercel AI Gateway. Deployed Vercel Functions use an automatically supplied OIDC credential, so no AI API key is exposed in browser code. The endpoints apply origin checks, bounded inputs and outputs, timeouts, and best-effort per-instance request limits. On October 22, 2026, a $5 monthly AI Gateway budget was configured and read back for the `brittanys-garden` project. This meters OIDC requests from this project. Vercel budgets are soft limits: the request that crosses the limit completes. Other apps and hosting usage are outside that AI budget.

## Vercel Deployment

Firebase setup is tracked in `.firebaserc`, `firebase.json`, and `firestore.rules`. Always target `brittanys-garden-skeyd87` explicitly for Firebase deployment. The tiny Firebase Hosting directory only provisions the sign-in helper's reserved configuration; it is not a second hosted Garden app. Vercel transparently proxies `/__/auth/*` and `/__/firebase/init.json` to that Firebase origin. The primary Vercel host is also the Firebase `authDomain`, authorized domain, and Google OAuth redirect host. This follows Firebase's first-party proxy approach for Safari/installed-PWA redirect storage. Do not replace the proxy with an HTTP redirect or point it at Books.

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

The October 25 cloud-save checks include 86 passing Node tests, the original 14 browser scenarios on 390px mobile/1440px desktop, and an additional cross-origin handoff pass. Browser coverage uses the real vendored Firebase SDK against local Auth/Firestore emulators, including the test-provider sign-in button, two approved accounts on separate device profiles, migration, live sync, offline reopen/edit/restart/reconnect, open-form protection, conflicting legacy choices, recovery preview, sign-out privacy, and failing device storage. Handoff coverage exercises actual form POST navigation between separate origins, the installed-mode redirect return to a saved garden, remembered sign-in after reopening, a fresh second device, review and explicit replacement, retained source/destination copies, repeated old-icon use, and a destination too full to retain a transfer. Rules reject signed-out/unapproved reads plus listing, unrelated paths, deletion, stale versions, forged writers, and oversized writes. The local emulator is not a production-data migration or proof of real-phone Google OAuth acceptance.

The remaining physical acceptance is deliberately recorded as unchecked in Setup. On Brittany's phone:

1. Open the same published link and add it to the home screen.
2. Add three real plants and review their initial care plans against the packet and growing conditions.
3. Try a real seed packet scan and front/back photos, including the manual fallback.
4. Open online once, then use airplane mode to reopen and log care. Reconnect and check that it remains saved.
5. Sign in on both devices, wait for Saved to cloud, and confirm the same real plants appear. Confirm the optional Calendar reminder actually alerts, or choose no reminder. File backups are optional.
6. Start the seven-day trial in Setup. Review next-day task rollover, ease of daily use, and any reported problems before calling the handoff complete.

## Local Preview

Use the included Node 24 preview server:

```powershell
npm run dev
```

Open `http://127.0.0.1:7432/`. The server supports the Calendar endpoint and the same local AI routes; AI calls need local credentials to run. Automated browser tests use isolated test profiles and controlled responses for error paths, not Brittany's garden data.

For local cloud tests, start the Auth/Firestore emulators using `firebase emulators:start --only auth,firestore --project brittanys-garden-skeyd87` (Java 21 or newer is required for Firestore), then open `/outputs/brittanys-garden-cozy-companion.html?emulators=1` on loopback. The emulator switch is ignored on every published/non-loopback host. Never use production records for test fixtures. Browser test accounts and test plants are emulator-only.
