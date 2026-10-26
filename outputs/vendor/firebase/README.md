# Firebase browser runtime

Firebase JavaScript compat SDK, pinned to 11.6.1: app, authentication, and Firestore.
These are the same versioned upstream browser artifacts already used by Brittany's Books.
They are served from this app's own origin and precached for offline reopening.

Upstream: https://www.gstatic.com/firebasejs/11.6.1/
License: Apache-2.0, with notices retained in each upstream file.
Do not edit the minified artifacts. Upgrade the three files together and repeat auth,
offline, migration, and two-device sync tests.

Only the public web configuration lives in browser source. There is no Admin SDK,
service-account credential, or Google OAuth client secret in this directory.
