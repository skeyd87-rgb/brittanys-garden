import { GardenSync, createDeviceStore, CLOUD_DOCUMENT, ALLOWED_GARDEN_EMAILS } from './garden-sync.js?v=16';
import { moveDestination, makeMovePacket, postGardenMove, moveStores, latestGardenMove, seedMovedGarden, saveMoveReceipt } from './garden-move.js?v=16';

// Public Firebase web configuration. Access is enforced by firestore.rules,
// not by hiding this browser configuration. No service-account key is used.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBh-Kf8Wk4oG7Oj3IrMcqhD4to9OHOnvEY',
  authDomain: 'brittanys-garden.vercel.app',
  projectId: 'brittanys-garden-skeyd87',
  appId: '1:452061824986:web:e90aa3f0f0a832bd2f62e3',
  messagingSenderId: '452061824986'
};

export function initializeGardenCloud({ getSnapshot, applySnapshot, localInfo, onStatus, onAuth, isEditing }) {
  let engine, auth, db, ref, unsubscribe, user = null, booting;
  let moved = null, restoringMove = false;
  const destination = moveDestination(location.href);
  const deviceStore = createDeviceStore();
  const transfers = moveStores();
  const online = () => navigator.onLine !== false;
  const publish = value => onStatus({ ...value, conflict: user ? value.conflict : null, migration: !!user && moved?.status === 'pending', signedIn: !!user, email: user?.email || '' });
  const authError = error => publish({ phase: 'error', message: `Google sign-in could not finish (${error?.code || 'connection-error'}). Try again in the same garden app. Existing garden copies are unchanged.` });

  const controller = {
    get signedIn() { return !!user; },
    get engine() { return engine; },
    async submit(snapshot, options) { await booting; return engine?.submit(snapshot, options); },
    retry() {
      if (!engine) return location.reload();
      if (user && online() && !engine.conflict) watch();
      return engine.resume();
    },
    resolve(choice) { if (user) return engine?.resolve(choice); },
    recovery() { return user ? engine?.record?.recovery : null; },
    movedCopy() { return user ? moved?.packet.snapshot : null; },
    beforeMoveCopy() { return user ? moved?.beforeReplacement : null; },
    async keepMovedCopy() {
      if (!user || !moved) return;
      try {
        await saveMoveReceipt({ ...moved, status: 'kept' }, transfers);
        moved.status = 'kept'; engine.resume();
      } catch (error) { engine.status('error', error.message); }
    },
    async restoreMovedCopy() {
      if (!user || !moved || restoringMove) return false;
      restoringMove = true;
      try {
        // Keep the destination's current garden independently before an
        // explicitly reviewed replacement, including any unsynced changes.
        const saved = { ...moved, beforeReplacement: JSON.parse(JSON.stringify(engine.record.snapshot)) };
        await saveMoveReceipt(saved, transfers);
        moved = saved;
        if (!await engine.submit(moved.packet.snapshot, { recovered: true })) throw new Error('The replacement could not be kept on this device. Keep the app open and check Retry sync. Both original garden copies remain protected.');
        applySnapshot(JSON.parse(JSON.stringify(moved.packet.snapshot)));
        await saveMoveReceipt({ ...moved, status: 'restored' }, transfers);
        moved.status = 'restored'; engine.resume();
        return true;
      } catch (error) { engine.status('error', error.message); return false; }
      finally { restoringMove = false; }
    },
    async signIn() {
      if (!online()) return publish({ phase: 'error', message: 'Connect to the internet to sign in. Your existing device copy is unchanged.' });
      if (destination) {
        publish({ phase: 'moving' });
        try {
          const previous = await deviceStore.read();
          postGardenMove(makeMovePacket(getSnapshot(), localInfo, previous, location.href), destination);
        } catch (error) { publish({ phase: 'error', message: error.message || 'The old garden could not be moved. Its original is unchanged.' }); }
        return;
      }
      if (!auth) return authError({ code: 'setup-not-ready' });
      const provider = new globalThis.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      publish({ phase: 'signing-in' });
      try {
        if (navigator.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches) {
          await auth.signInWithRedirect(provider);
        } else {
          try { await auth.signInWithPopup(provider); }
          catch (error) {
            if (error.code !== 'auth/popup-blocked') throw error;
            await auth.signInWithRedirect(provider);
          }
        }
      } catch (error) { authError(error); }
    },
    async signOut() {
      if (!auth) return;
      if (engine?.record.pending && !confirm('Changes have not reached the cloud. A device copy will be kept, but stay signed in to finish syncing. Sign out anyway?')) return;
      engine?.disconnect();
      await auth.signOut();
    }
  };

  function watch() {
    unsubscribe?.();
    engine.connect();
    unsubscribe = ref.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) void engine.receive(snapshot.exists ? snapshot.data() : null);
    }, error => {
      engine.status('error', `Cloud sync could not connect (${error.code || 'connection-error'}). Your device copy has not been replaced. Tap Retry sync after reconnecting.`);
    });
  }

  booting = (async () => {
    // GitHub Pages cannot proxy Firebase's auth helper. Authorizing that
    // domain alone still loses the redirect session on iPhone. Move the
    // device copy first, then start auth on the first-party helper's host.
    if (destination) {
      onAuth(false);
      publish({ phase: 'signed-out', message: 'Continue to the current Garden address, then sign in there. Your saved garden will travel with you, and the old copy will stay intact.' });
      return;
    }
    const sdk = globalThis.firebase;
    if (!sdk?.auth || !sdk?.firestore) throw new Error('The sign-in files could not load. Reconnect and reload this app.');
    const app = sdk.apps.find(item => item.name === 'garden') || sdk.initializeApp(FIREBASE_CONFIG, 'garden');
    auth = app.auth();
    db = app.firestore();
    // Test services can only be selected on the loopback preview, never on the
    // published app. There is no production auth bypass or mock-account mode.
    if (['127.0.0.1', 'localhost'].includes(location.hostname) && new URL(location.href).searchParams.get('emulators') === '1') {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      db.useEmulator('127.0.0.1', 8085);
    }
    ref = db.doc(CLOUD_DOCUMENT);
    engine = new GardenSync({
      store: deviceStore, online, onSnapshot: applySnapshot, onStatus: publish, isEditing,
      remote: {
        commit(version, payload) {
          return db.runTransaction(async transaction => {
            const document = await transaction.get(ref);
            const remote = document.exists ? document.data() : null;
            if ((remote?.version || 0) !== version) {
              const error = new Error('The cloud garden changed on another device.');
              error.code = 'garden/conflict'; error.remote = remote;
              throw error;
            }
            const nextVersion = version + 1;
            transaction.set(ref, { payload, version: nextVersion, updatedBy: auth.currentUser.uid, updatedAt: sdk.firestore.FieldValue.serverTimestamp() });
            return nextVersion;
          });
        }
      }
    });
    moved = await latestGardenMove(transfers);
    // A full destination can still sign in and load its existing cloud copy.
    // The incoming copy remains separate for a reviewed retry.
    try { await seedMovedGarden(moved, { store: deviceStore, snapshot: getSnapshot(), localInfo, stores: transfers }); }
    catch { /* Never discard or auto-replace either garden after a failed seed. */ }
    await engine.init(getSnapshot(), localInfo);
    try { await auth.setPersistence(sdk.auth.Auth.Persistence.LOCAL); }
    catch { publish({ phase: 'error', message: 'This browser cannot remember sign-in. You can sign in now; allow site storage to stay signed in after reopening.' }); }
    auth.onAuthStateChanged(async next => {
      unsubscribe?.(); unsubscribe = null;
      user = next && next.emailVerified && ALLOWED_GARDEN_EMAILS.includes(next.email?.toLowerCase()) ? next : null;
      onAuth(!!user);
      if (!user) {
        engine.disconnect();
        if (next) publish({ phase: 'denied', message: 'This Google account is not approved. Choose Steven’s or Brittany’s approved account.' });
        return;
      }
      watch();
    });
    auth.getRedirectResult().catch(authError);
    globalThis.addEventListener('online', () => engine.resume());
    globalThis.addEventListener('offline', () => engine.resume());
    globalThis.addEventListener('focus', () => engine.resume());
    setInterval(() => { if (document.visibilityState === 'visible' && engine.record.pending) engine.resume(); }, 30000);
  })().catch(error => {
    onAuth(false);
    publish({ phase: 'error', message: error.message || 'Cloud saving could not start. Reconnect and reload; your device copy is preserved.' });
  });
  return controller;
}
