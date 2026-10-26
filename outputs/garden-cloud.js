import { GardenSync, createDeviceStore, CLOUD_DOCUMENT, ALLOWED_GARDEN_EMAILS } from './garden-sync.js';

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
  const online = () => navigator.onLine !== false;
  const publish = value => onStatus({ ...value, conflict: user ? value.conflict : null, signedIn: !!user, email: user?.email || '' });
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
    async signIn() {
      if (!auth) return authError({ code: 'setup-not-ready' });
      if (!online()) return publish({ phase: 'error', message: 'Connect to the internet to sign in. Your existing device copy is unchanged.' });
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
      store: createDeviceStore(), online, onSnapshot: applySnapshot, onStatus: publish, isEditing,
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
