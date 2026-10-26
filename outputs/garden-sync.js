import { parseGardenSnapshot } from './garden-reliability.js';

export const CLOUD_DOCUMENT = 'gardens/brittany';
export const CLOUD_MAX_BYTES = 890000;
export const ALLOWED_GARDEN_EMAILS = ['skeyd87@gmail.com', 'britfowler10@gmail.com'];

export function snapshotPayload(snapshot) {
  const value = parseGardenSnapshot(JSON.stringify(snapshot));
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).length > CLOUD_MAX_BYTES) {
    throw new Error('This garden is too large for cloud saving. Download a backup; nothing in the cloud has been replaced.');
  }
  return payload;
}

export function fingerprint(snapshot) {
  const { savedAt, lastBackupAt, doneDate, doneToday, ...content } = parseGardenSnapshot(JSON.stringify(snapshot));
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  return JSON.stringify(sort(content));
}

export function hasGardenData(snapshot) {
  return !!(snapshot.plants.length || snapshot.archivedPlants?.length || snapshot.journal.length || snapshot.settings?.location);
}

export function readCloudDocument(value) {
  if (value == null) return { version: 0, snapshot: null };
  if (!Number.isSafeInteger(value.version) || value.version < 1 || typeof value.payload !== 'string') {
    throw new Error('The cloud garden could not be read. No saved copies have been replaced.');
  }
  return { version: value.version, snapshot: parseGardenSnapshot(value.payload) };
}

// Version checks deliberately stop conflicting devices instead of silently
// overwriting the other device. Only server-confirmed documents reach receive().
export class GardenSync {
  constructor({ store, remote, onSnapshot = () => {}, onStatus = () => {}, isEditing = () => false, online = () => true }) {
    Object.assign(this, { store, remote, onSnapshot, onStatus, isEditing, online });
    this.record = null;
    this.latest = null;
    this.conflict = null;
    this.connected = false;
    this.serverReady = false;
    this.durable = false;
    this.revision = 0;
    this.persisted = Promise.resolve(true);
    this.inFlight = null;
    this.flight = null;
    this.phase = 'loading';
  }

  status(phase, message = '') {
    this.phase = phase;
    this.onStatus({ phase, message, durable: this.durable, pending: !!this.record?.pending,
      version: this.record?.version || 0, conflict: this.conflict, lastSyncedAt: this.record?.lastSyncedAt || '' });
  }

  async init(snapshot, { blocked = false, original = '', backup = '' } = {}) {
    let previous;
    try { previous = await this.store.read(); } catch { /* Device storage can fail independently of the cloud. */ }
    if (previous) {
      try {
        previous.snapshot = parseGardenSnapshot(JSON.stringify(previous.snapshot));
        if (!Number.isSafeInteger(previous.version) || previous.version < 0) throw new Error('Invalid sync version');
        if (previous.recovery) previous.recovery = parseGardenSnapshot(JSON.stringify(previous.recovery));
      } catch { previous = null; }
    }
    snapshot = parseGardenSnapshot(JSON.stringify(snapshot));
    this.record = previous || { snapshot, version: 0, linked: false, pending: false, lastSyncedAt: '', recovery: null };
    this.record.legacyBlocked = previous?.legacyBlocked ?? blocked;
    if (!previous && (original || backup)) this.record.originalDeviceCopy = { original, backup };
    // A localStorage write can finish just before an interrupted IndexedDB write.
    if (previous && !blocked && snapshot.savedAt > (previous.snapshot.savedAt || '') && fingerprint(snapshot) !== fingerprint(previous.snapshot)) {
      this.record.snapshot = snapshot;
      this.record.pending = true;
    }
    this.onSnapshot(JSON.parse(JSON.stringify(this.record.snapshot)));
    await this.persist();
    this.status('signed-out');
  }

  persist() {
    const value = JSON.parse(JSON.stringify({ ...this.record, modifiedAt: Date.now() }));
    this.persisted = this.persisted.then(async () => {
      try { await this.store.write(value); this.durable = true; return true; }
      catch { this.durable = false; return false; }
    });
    return this.persisted;
  }

  connect() {
    this.connected = true;
    this.serverReady = false;
    this.status(this.online() ? 'loading' : 'offline');
  }

  disconnect() {
    this.connected = false;
    this.serverReady = false;
    this.status('signed-out');
  }

  async receive(value) {
    if (!this.connected) return;
    let cloud;
    try { cloud = readCloudDocument(value); } catch (error) { this.serverReady = false; this.status('error', error.message); return; }
    if (this.record.linked && cloud.version < this.record.version) {
      this.serverReady = false;
      this.status('error', 'The cloud copy is older than this device’s last confirmed save. Your newer device copy is protected; contact Steven before replacing it.');
      return;
    }
    this.latest = cloud;
    this.serverReady = true;
    if (this.flight && cloud.version === this.flight.version + 1 && cloud.snapshot && fingerprint(cloud.snapshot) === this.flight.fingerprint) return;
    if (cloud.snapshot && fingerprint(cloud.snapshot) === fingerprint(this.record.snapshot)) {
      this.record.version = cloud.version;
      this.record.linked = true;
      this.record.pending = false;
      this.record.lastSyncedAt = new Date().toISOString();
      this.conflict = null;
      await this.persist();
      this.status('saved');
      return;
    }
    if (!this.record.linked) {
      if (cloud.snapshot && hasGardenData(this.record.snapshot)) return this.showConflict(cloud);
      if (cloud.snapshot) return this.adopt(cloud);
      if (this.record.legacyBlocked) {
        this.status('recovery', 'Your original device copy is protected. Restore the last good copy below before its first cloud save.');
        return;
      }
      this.record.linked = true;
      this.record.version = 0;
      this.record.pending = hasGardenData(this.record.snapshot) || this.record.pending;
      await this.persist();
      if (!this.record.pending) { this.status('ready'); return; }
      return this.flush();
    }
    if (cloud.version !== this.record.version) {
      if (this.record.pending) return this.showConflict(cloud);
      if (this.isEditing()) {
        this.deferred = cloud;
        this.status('remote-change', 'Another device saved changes. Finish or cancel the open form before loading them.');
        return;
      }
      return this.adopt(cloud);
    }
    if (this.record.pending) return this.flush();
    this.status(cloud.snapshot ? 'saved' : 'ready');
  }

  async adopt(cloud) {
    if (!cloud.snapshot) {
      this.status('error', 'The cloud copy is missing. Your device copy is protected; no empty garden has replaced it.');
      return;
    }
    this.record.snapshot = cloud.snapshot;
    this.record.version = cloud.version;
    this.record.linked = true;
    this.record.pending = false;
    this.record.legacyBlocked = false;
    this.record.lastSyncedAt = new Date().toISOString();
    this.conflict = null;
    this.deferred = null;
    this.onSnapshot(JSON.parse(JSON.stringify(this.record.snapshot)));
    await this.persist();
    this.status(this.record.pending ? (this.online() ? 'saving' : 'offline') : 'saved');
  }

  async showConflict(cloud) {
    this.conflict = cloud;
    this.record.recovery = cloud.snapshot;
    await this.persist();
    this.status('conflict', 'There are two different gardens. Choose which to use; neither copy will be silently overwritten.');
  }

  async submit(snapshot, { recovered = false } = {}) {
    // Validate synchronously before replacing the queued snapshot.
    try { snapshotPayload(snapshot); } catch (error) { this.status('error', error.message); return false; }
    if (this.connected && this.serverReady && !this.conflict && !this.deferred && !this.record.pending && this.record.linked && this.record.version > 0 && fingerprint(snapshot) === fingerprint(this.record.snapshot)) {
      this.record.snapshot = parseGardenSnapshot(JSON.stringify(snapshot));
      const saved = await this.persist();
      this.status(this.online() ? 'saved' : 'offline');
      return saved;
    }
    this.revision++;
    this.record.snapshot = parseGardenSnapshot(JSON.stringify(snapshot));
    this.record.pending = true;
    if (recovered) this.record.legacyBlocked = false;
    const saved = await this.persist();
    if (this.conflict) { this.status('conflict'); return saved; }
    if (this.deferred) { await this.showConflict(this.deferred); return saved; }
    if (this.record.legacyBlocked) { this.status('recovery', 'Restore a good copy before starting cloud saving. Your original record is still protected.'); return saved; }
    if (!this.connected) { this.status('signed-out'); return saved; }
    this.status(this.online() ? 'saving' : 'offline');
    void this.flush();
    return saved;
  }

  async flush() {
    if (this.inFlight) return this.inFlight;
    if (!this.connected || !this.serverReady || !this.online() || !this.record.pending || this.conflict || this.record.legacyBlocked) return;
    this.inFlight = this.push();
    try { await this.inFlight; } finally { this.inFlight = null; }
    if (this.connected && this.online() && this.record.pending && !this.conflict && this.phase !== 'error' && this.phase !== 'offline') return this.flush();
  }

  async push() {
    await this.persisted;
    if (!this.connected || !this.online() || this.conflict) return;
    const revision = this.revision;
    const snapshot = this.record.snapshot;
    const version = this.record.version;
    this.flight = { version, fingerprint: fingerprint(snapshot) };
    this.status('saving');
    try {
      const nextVersion = await this.remote.commit(version, snapshotPayload(snapshot));
      this.record.version = nextVersion;
      this.record.linked = true;
      this.record.lastSyncedAt = new Date().toISOString();
      if (revision === this.revision) this.record.pending = false;
      await this.persist();
      this.status(this.record.pending ? 'saving' : 'saved');
    } catch (error) {
      if (error.code === 'garden/conflict') {
        try { await this.showConflict(readCloudDocument(error.remote)); }
        catch { this.serverReady = false; this.status('error', 'The changed cloud copy could not be read. Your pending device copy is protected.'); }
      }
      else if (['permission-denied', 'unauthenticated'].includes(error.code)) this.status('error', 'Cloud access was refused. Sign in with an approved account, then retry. Your device copy is preserved.');
      else this.status('offline', this.durable ? 'Connection interrupted. Changes are saved on this device and will retry automatically.' : 'Saving could not finish. Keep this app open, reconnect, then tap Retry sync.');
    } finally { this.flight = null; }
  }

  async resolve(choice) {
    const cloud = this.conflict || this.deferred;
    if (!cloud) return;
    const revision = this.revision;
    const other = choice === 'cloud' ? this.record.snapshot : cloud.snapshot;
    this.record.recovery = other;
    if (!await this.persist()) { this.status('error', 'A recovery copy could not be kept. Free device storage before choosing a replacement. Nothing in the cloud has changed.'); return; }
    if (revision !== this.revision || (this.latest && this.latest.version !== cloud.version)) {
      await this.showConflict(this.latest || cloud);
      return;
    }
    if (choice === 'cloud') return this.adopt(cloud);
    this.conflict = null;
    this.deferred = null;
    this.record.version = cloud.version;
    this.record.linked = true;
    this.record.legacyBlocked = false;
    this.record.pending = true;
    await this.persist();
    return this.flush();
  }

  resume() {
    if (!this.connected) return;
    if (this.conflict) { this.status('conflict'); return; }
    if (this.record.legacyBlocked) { this.status('recovery'); return; }
    if (this.deferred && !this.isEditing() && !this.record.pending) return this.adopt(this.deferred);
    if (!this.online()) { this.status('offline'); return; }
    if (this.record.pending) { this.status('saving'); return this.flush(); }
    this.status(this.serverReady ? (this.record.version ? 'saved' : 'ready') : 'loading');
  }
}

// IndexedDB is independent of the legacy localStorage quota. The fallback is
// only used when IndexedDB itself is unavailable, not as a cloud-save claim.
export function createDeviceStore({ indexedDB = globalThis.indexedDB, storage, key = 'current' } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const fallbackKey = key === 'current' ? 'brittanys-garden-cloud-v1' : `brittanys-garden-cloud-v1:${key}`;
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('Device database unavailable'));
    const request = indexedDB.open('brittanys-garden-private-v1', 1);
    const timer = setTimeout(() => reject(new Error('Device database did not open')), 5000);
    request.onupgradeneeded = () => request.result.createObjectStore('garden');
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('Device database unavailable')); };
  });
  const operation = async (mode, value) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('garden', mode);
      const request = mode === 'readonly' ? tx.objectStore('garden').get(key) : tx.objectStore('garden').put(value, key);
      tx.oncomplete = () => resolve(mode === 'readonly' ? request.result : undefined);
      tx.onerror = tx.onabort = () => reject(new Error('Device save could not finish'));
    });
  };
  return {
    async read() {
      let cached, fallback;
      try { cached = await operation('readonly'); } catch { /* Try legacy storage independently. */ }
      try { fallback = JSON.parse(storage.getItem(fallbackKey)); } catch { /* Not a saved copy. */ }
      return (fallback?.modifiedAt || 0) > (cached?.modifiedAt || 0) ? fallback : cached;
    },
    async write(value) {
      try { await operation('readwrite', value); }
      catch {
        const raw = JSON.stringify(value);
        storage.setItem(fallbackKey, raw);
        if (storage.getItem(fallbackKey) !== raw) throw new Error('Device save was not retained');
      }
    }
  };
}
