import test from 'node:test';
import assert from 'node:assert/strict';
import { GardenSync, fingerprint, snapshotPayload, readCloudDocument, createDeviceStore } from '../outputs/garden-sync.js';

const clone = value => JSON.parse(JSON.stringify(value));
const garden = (name = '') => ({ plants: name ? [{ id: 'basil', name, status: 'happy' }] : [], archivedPlants: [], journal: [], settings: {}, savedAt: '2026-10-25T12:00:00Z' });
const document = (snapshot, version = 1) => snapshot ? { payload: snapshotPayload(snapshot), version } : null;

function setup(initialCloud = null, stored = null) {
  const store = { value: clone(stored), fail: false, async read() { return clone(this.value); }, async write(value) { if (this.fail) throw new Error('Full'); this.value = clone(value); } };
  const remote = { value: initialCloud, writes: 0, delay: null, fail: false,
    async commit(version, payload) {
      if (this.delay) await this.delay;
      if (this.fail) throw new Error('Disconnected');
      if ((this.value?.version || 0) !== version) throw Object.assign(new Error('Conflict'), { code: 'garden/conflict', remote: clone(this.value) });
      this.value = { payload, version: version + 1 }; this.writes++;
      return this.value.version;
    }
  };
  let online = true, editing = false;
  const snapshots = [], statuses = [];
  const sync = new GardenSync({ store, remote, onSnapshot: value => snapshots.push(value), onStatus: value => statuses.push(value), online: () => online, isEditing: () => editing });
  const settle = async () => { await sync.persisted; while (sync.inFlight) await sync.inFlight; await sync.persisted; };
  return { sync, store, remote, snapshots, statuses, settle, online: value => { online = value; }, editing: value => { editing = value; } };
}

test('first sign-in migrates a valid device garden only into an empty cloud', async () => {
  const t = setup(); await t.sync.init(garden('Old phone basil'), { original: 'original bytes' });
  t.sync.connect(); await t.sync.receive(null); await t.settle();
  assert.equal(t.remote.writes, 1); assert.equal(t.sync.phase, 'saved');
  assert.equal(JSON.parse(t.remote.value.payload).plants[0].name, 'Old phone basil');
  assert.equal(t.store.value.originalDeviceCopy.original, 'original bytes');
});

test('a fresh device loads the cloud without uploading an empty garden', async () => {
  const t = setup(document(garden('Cloud basil'), 7)); await t.sync.init(garden());
  t.sync.connect(); await t.sync.receive(t.remote.value);
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.record.version, 7);
  assert.equal(t.snapshots.at(-1).plants[0].name, 'Cloud basil');
});

test('a brand-new empty garden does not create a needless cloud record', async () => {
  const t = setup(); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(null);
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.phase, 'ready');
});

test('unreadable legacy data never becomes an empty first cloud save', async () => {
  const t = setup(); await t.sync.init(garden(), { blocked: true, original: '{damaged' });
  t.sync.connect(); await t.sync.receive(null);
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.phase, 'recovery');
  assert.equal(t.store.value.originalDeviceCopy.original, '{damaged');
});

test('restoring an explicitly reviewed good copy can recover a protected device', async () => {
  const t = setup(); await t.sync.init(garden(), { blocked: true }); t.sync.connect(); await t.sync.receive(null);
  await t.sync.submit(garden('Recovered basil'), { recovered: true }); await t.settle();
  assert.equal(t.remote.writes, 1); assert.equal(t.sync.phase, 'saved');
});

test('different legacy and cloud gardens require a choice', async () => {
  const t = setup(document(garden('Cloud basil'), 3)); await t.sync.init(garden('Phone basil'));
  t.sync.connect(); await t.sync.receive(t.remote.value);
  assert.equal(t.sync.phase, 'conflict'); assert.equal(t.remote.writes, 0);
  assert.equal(t.sync.record.snapshot.plants[0].name, 'Phone basil');
});

test('choosing the cloud preserves the other device copy for recovery', async () => {
  const t = setup(document(garden('Cloud basil'), 3)); await t.sync.init(garden('Phone basil'));
  t.sync.connect(); await t.sync.receive(t.remote.value); await t.sync.resolve('cloud');
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.record.snapshot.plants[0].name, 'Cloud basil');
  assert.equal(t.store.value.recovery.plants[0].name, 'Phone basil');
});

test('choosing the device uses a version check and preserves the previous cloud copy', async () => {
  const t = setup(document(garden('Cloud basil'), 3)); await t.sync.init(garden('Phone basil'));
  t.sync.connect(); await t.sync.receive(t.remote.value); await t.sync.resolve('device'); await t.settle();
  assert.equal(t.remote.value.version, 4); assert.equal(t.store.value.recovery.plants[0].name, 'Cloud basil');
  assert.equal(JSON.parse(t.remote.value.payload).plants[0].name, 'Phone basil');
});

test('a replacement is refused if the other copy cannot be preserved', async () => {
  const t = setup(document(garden('Cloud basil'), 3)); await t.sync.init(garden('Phone basil'));
  t.sync.connect(); await t.sync.receive(t.remote.value); t.store.fail = true;
  await t.sync.resolve('device'); assert.equal(t.remote.writes, 0); assert.equal(t.sync.phase, 'error');
});

test('offline changes remain pending through an app restart then sync', async () => {
  const original = garden('Basil');
  const t = setup(document(original)); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.online(false); await t.sync.submit(garden('Offline edit')); await t.settle();
  assert.equal(t.sync.phase, 'offline'); assert.equal(t.store.value.pending, true); assert.equal(t.remote.writes, 0);
  const reopened = setup(t.remote.value, t.store.value); await reopened.sync.init(original); reopened.sync.connect();
  await reopened.sync.receive(reopened.remote.value); await reopened.settle();
  assert.equal(JSON.parse(reopened.remote.value.payload).plants[0].name, 'Offline edit');
  assert.equal(reopened.sync.record.pending, false);
});

test('offline edits conflict safely if another device saved meanwhile', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.online(false); await t.sync.submit(garden('Offline edit')); t.online(true);
  t.remote.value = document(garden('Other device edit'), 2); await t.sync.resume(); await t.settle();
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.phase, 'conflict');
  assert.equal(t.sync.record.snapshot.plants[0].name, 'Offline edit');
});

test('edits made during a slow save are not acknowledged or discarded with that older save', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  let finish; t.remote.delay = new Promise(resolve => { finish = resolve; });
  await t.sync.submit(garden('First edit')); await Promise.resolve();
  await t.sync.submit(garden('Second edit')); finish(); await t.settle();
  assert.equal(JSON.parse(t.remote.value.payload).plants[0].name, 'Second edit');
  assert.equal(t.sync.record.pending, false); assert.equal(t.remote.writes, 2);
});

test('the snapshot listener for our own in-flight write cannot overwrite a newer edit', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  let finish; t.remote.delay = new Promise(resolve => { finish = resolve; });
  await t.sync.submit(garden('First edit')); await Promise.resolve(); await Promise.resolve();
  await t.sync.submit(garden('Second edit')); await t.sync.receive(document(garden('First edit'), 2));
  assert.equal(t.sync.record.snapshot.plants[0].name, 'Second edit'); assert.equal(t.sync.conflict, null);
  finish(); await t.settle();
});

test('a cloud update waits while the plant form is being edited', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.editing(true); await t.sync.receive(document(garden('New cloud edit'), 2));
  assert.equal(t.sync.phase, 'remote-change'); assert.equal(t.sync.record.snapshot.plants[0].name, 'Basil');
  t.editing(false); await t.sync.resume(); assert.equal(t.sync.record.snapshot.plants[0].name, 'New cloud edit');
});

test('saving a form after a concurrent remote edit requires a choice', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.editing(true); await t.sync.receive(document(garden('New cloud edit'), 2)); await t.sync.submit(garden('My form edit'));
  assert.equal(t.sync.phase, 'conflict'); assert.equal(t.remote.writes, 0);
});

test('storage failures never produce a false offline-save claim, but online cloud saving still works', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.store.fail = true; t.online(false); await t.sync.submit(garden('Keep open'));
  assert.equal(t.sync.durable, false); assert.equal(t.sync.phase, 'offline');
  t.online(true); await t.sync.resume(); await t.settle(); assert.equal(t.sync.phase, 'saved');
});

test('failed network saves stay queued and retry without losing edits', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.remote.fail = true; await t.sync.submit(garden('Queued')); await t.settle();
  assert.equal(t.sync.record.pending, true); assert.equal(t.sync.phase, 'offline');
  t.remote.fail = false; await t.sync.resume(); await t.settle(); assert.equal(t.sync.phase, 'saved');
});

test('a sign-out cannot flush pending private edits', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.online(false); await t.sync.submit(garden('Queued')); t.sync.disconnect(); t.online(true); await t.sync.flush();
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.record.pending, true);
});

test('a malformed cloud document does not replace the valid device garden', async () => {
  const t = setup(); await t.sync.init(garden('Safe')); t.sync.connect();
  await t.sync.receive({ version: 1, payload: '{invalid' });
  assert.equal(t.sync.phase, 'error'); assert.equal(t.sync.record.snapshot.plants[0].name, 'Safe');
  assert.throws(() => readCloudDocument({ version: 0, payload: '{}' }));
});

test('cloud payloads have an explicit size limit and compare independent of volatile timestamps', () => {
  const a = garden('Basil'), b = { ...clone(a), savedAt: '2026-10-26T12:00:00Z', doneDate: '2026-10-26' };
  assert.equal(fingerprint(a), fingerprint(b));
  const huge = garden('Basil'); huge.plants[0].untrustedExtra = 'x'.repeat(900000);
  assert.throws(() => snapshotPayload(huge), /too large/);
});

test('rendered snapshots are copies, not mutable references into the save queue', async () => {
  const t = setup(); await t.sync.init(garden('Basil')); t.snapshots[0].plants[0].name = 'Accidental mutation';
  assert.equal(t.sync.record.snapshot.plants[0].name, 'Basil');
});

test('the device store falls back independently when IndexedDB is unavailable', async () => {
  const records = new Map(); const storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  const store = createDeviceStore({ indexedDB: null, storage });
  await store.write({ modifiedAt: 1, snapshot: garden('Basil') });
  assert.equal((await store.read()).snapshot.plants[0].name, 'Basil');
});

test('retry cannot label an unresolved conflict as saved', async () => {
  const t = setup(document(garden('Cloud'))); await t.sync.init(garden('Device')); t.sync.connect(); await t.sync.receive(t.remote.value);
  await t.sync.resume(); assert.equal(t.sync.phase, 'conflict'); assert.equal(t.remote.writes, 0);
});

test('a cloud version rollback cannot silently replace the newer confirmed device copy', async () => {
  const t = setup(document(garden('Current'), 5)); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  await t.sync.receive(document(garden('Old'), 2));
  assert.equal(t.sync.phase, 'error'); assert.equal(t.sync.record.snapshot.plants[0].name, 'Current'); assert.equal(t.sync.serverReady, false);
});

test('unreadable conflicting server data stays protected without an unhandled rejection', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  t.remote.value = { version: 2, payload: 'not JSON' }; await t.sync.submit(garden('My edit')); await t.settle();
  assert.equal(t.sync.phase, 'error'); assert.equal(t.sync.record.pending, true); assert.equal(t.remote.writes, 0);
});

test('optional backup timestamps do not cause unnecessary cloud writes', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  await t.sync.submit({ ...garden('Basil'), lastBackupAt: '2026-10-25T15:00:00Z' }); await t.settle();
  assert.equal(t.remote.writes, 0); assert.equal(t.sync.phase, 'saved');
});

test('a newer pending IndexedDB copy wins over an older localStorage copy at startup', async () => {
  const old = garden('Older localStorage'); old.savedAt = '2026-10-24T12:00:00Z';
  const pending = garden('Newer IndexedDB'); pending.savedAt = '2026-10-25T12:00:00Z';
  const t = setup(null, { snapshot: pending, version: 1, linked: true, pending: true });
  await t.sync.init(old); assert.equal(t.sync.record.snapshot.plants[0].name, 'Newer IndexedDB');
});

test('no device storage produces an explicit failure instead of a false durability claim', async () => {
  const store = createDeviceStore({ indexedDB: null, storage: null });
  await assert.rejects(() => store.write({ snapshot: garden() }));
});

test('a received cloud copy is rendered before new edits can use its newer version', async () => {
  const t = setup(document(garden('Basil'))); await t.sync.init(garden()); t.sync.connect(); await t.sync.receive(t.remote.value);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const write = t.store.write.bind(t.store); t.store.write = async value => { await gate; return write(value); };
  t.remote.value = document(garden('New cloud version'), 2);
  const receiving = t.sync.receive(t.remote.value);
  assert.equal(t.snapshots.at(-1).plants[0].name, 'New cloud version');
  const submitting = t.sync.submit(garden('Edit based on new cloud version'));
  release(); await receiving; await submitting; await t.settle();
  assert.equal(JSON.parse(t.remote.value.payload).plants[0].name, 'Edit based on new cloud version');
});

test('new edits during a replacement confirmation are not discarded', async () => {
  const t = setup(document(garden('Cloud'))); await t.sync.init(garden('Device')); t.sync.connect(); await t.sync.receive(t.remote.value);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const write = t.store.write.bind(t.store); t.store.write = async value => { await gate; return write(value); };
  const resolving = t.sync.resolve('cloud');
  const submitting = t.sync.submit(garden('Newest device edit'));
  release(); await resolving; await submitting; await t.settle();
  assert.equal(t.sync.phase, 'conflict'); assert.equal(t.sync.record.snapshot.plants[0].name, 'Newest device edit');
  assert.equal(t.remote.writes, 0);
});
