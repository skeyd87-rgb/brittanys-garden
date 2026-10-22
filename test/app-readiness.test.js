import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as reliability from '../outputs/garden-reliability.js';
import calendarHandler from '../api/daily-reminder.js';

const key = 'brittanys-garden-mobile-v3';
const fixture = () => ({ plants: [{ id: 'basil', name: 'Basil', kind: 'Basil', status: 'happy', emoji: '🌿', mood: '😊', moodText: 'all good', water: 'Every 1 day', feed: 'Every 7 days', care: {
  water: { text: 'Every 1 day', dueAt: '2026-10-22', repeat: { count: 1, unit: 'day' } },
  feed: { text: 'Every 7 days', dueAt: '2026-10-22', repeat: { count: 7, unit: 'day' } },
  harvest: { text: 'Every 3 days', dueAt: '2026-10-22', repeat: { count: 3, unit: 'day' } }
} }], journal: [], settings: {}, archivedPlants: [] });

function memoryStorage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return { records, writes: 0, fail: false,
    getItem(k) { return records.get(k) ?? null; },
    setItem(k, value) { this.writes++; if (this.fail) throw new Error('Quota exceeded'); records.set(k, value); },
    removeItem() { throw new Error('Recovery must never delete a record'); }
  };
}

function app(saved = fixture()) {
  let now = '2026-10-22T12:00:00';
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const storage = memoryStorage({ [key]: JSON.stringify(saved) });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', classList: { toggle() {}, add() {}, remove() {}, contains() { return true; } }, style: {} });
    return elements.get(id);
  };
  const context = vm.createContext({ ...reliability, Date: FakeDate, console, localStorage: storage, TextEncoder,
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [] },
    location: { protocol: 'https:', hostname: 'brittanys-garden.vercel.app', href: 'https://brittanys-garden.vercel.app/outputs/' },
    confirm: () => true, setTimeout: () => 0, clearTimeout() {},
    Blob, URL, navigator: { userAgent: 'Test' }
  });
  const html = fs.readFileSync(new URL('../outputs/brittanys-garden-cozy-companion.html', import.meta.url), 'utf8');
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*?;\s*$/m, '');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
  vm.runInContext("state.scr = 'diagnostic'; showToast = () => {};", context);
  return { storage, elements, run: code => vm.runInContext(code, context), result: code => JSON.parse(JSON.stringify(vm.runInContext(code, context))), advance: value => { now = value; } };
}

test('watering keeps feeding and harvest visible as independent tasks', () => {
  const a = app();
  a.run("logCare('basil', 'water')");
  assert.deepEqual(a.result('careTasksForPlant(state.plants[0]).map(t => t.type)').sort(), ['feed', 'pick']);
  a.run('renderToday()');
  assert.equal(a.elements.get('today-count').textContent, '2 to go');
  a.run('renderBoard()');
  assert.match(a.elements.get('board-grid').innerHTML, /Feed due|Harvest check due/);
});

test('next-day care returns after saving and reloading', () => {
  const a = app();
  a.run("logCare('basil', 'water'); logCare('basil', 'feed'); logCare('basil', 'pick')");
  assert.equal(a.run('careTasksForPlant(state.plants[0]).length'), 0);
  a.advance('2026-10-23T09:00:00');
  a.run('hydrateState()');
  assert.deepEqual(a.result('careTasksForPlant(state.plants[0]).map(t => t.type)'), ['water']);
});

test('duplicate taps do not log or reschedule the same care twice', () => {
  const a = app();
  a.run("logCare('basil', 'water'); logCare('basil', 'water')");
  assert.equal(a.run('state.journal.length'), 1);
  assert.equal(a.run('state.plants[0].care.water.dueAt'), '2026-10-23');
});

test('feeding does not clear a manual thirsty status', () => {
  const saved = fixture(); saved.plants[0].status = 'thirsty';
  const a = app(saved);
  a.run("logCare('basil', 'feed')");
  assert.equal(a.run('state.plants[0].status'), 'thirsty');
  assert.ok(a.result('careTasksForPlant(state.plants[0]).map(t => t.type)').includes('water'));
});

test('trimming does not reset an unrelated harvest check', () => {
  const a = app();
  a.run("logCare('basil', 'trim')");
  assert.equal(a.run('state.plants[0].care.harvest.dueAt'), '2026-10-22');
});

test('a soil check can defer a task without falsely logging watering', () => {
  const a = app();
  a.run("renderToday = () => {}; skipCare('basil', 'water')");
  assert.deepEqual(a.result('careTasksForPlant(state.plants[0]).map(t => t.type)').sort(), ['feed', 'pick']);
  assert.equal(a.run('state.journal[0].type'), 'check');
  assert.equal(a.run('state.plants[0].care.water.dueAt'), '2026-10-22');
  a.advance('2026-10-23T09:00:00'); a.run('hydrateState()');
  assert.ok(a.result('careTasksForPlant(state.plants[0]).map(t => t.type)').includes('water'));
});

test('undo restores the last action and its original due date', () => {
  const a = app();
  a.run("logCare('basil', 'water'); renderDetail = () => {}; undoCare('basil', String(state.journal[0].id))");
  assert.equal(a.run('state.journal.length'), 0);
  assert.equal(a.run('state.plants[0].care.water.dueAt'), '2026-10-22');
  assert.equal(a.run("completedToday('basil', 'water')"), false);
});

test('legacy undated completion flags cannot hide current work', () => {
  const saved = fixture(); saved.doneToday = { basil: 'water' };
  const a = app(saved);
  assert.equal(a.run('careTasksForPlant(state.plants[0]).length'), 3);
});

test('migration reconstructs only todays dated care from the journal', () => {
  const saved = fixture();
  saved.journal = [{ text: 'Watered', who: 'Basil', type: 'water', at: '2026-10-22T08:00:00' }];
  const a = app(saved);
  assert.equal(a.run("completedToday('basil', 'water')"), true);
  assert.equal(a.run("completedToday('basil', 'feed')"), false);
});

test('hydrating a full device neither writes nor deletes the valid garden', () => {
  const a = app(); const original = a.storage.getItem(key);
  a.storage.fail = true;
  a.run('hydrateState()');
  assert.equal(a.storage.writes, 0);
  assert.equal(a.storage.getItem(key), original);
});

test('save failure preserves the old saved garden and reports unsaved edits', () => {
  const a = app(); const original = a.storage.getItem(key);
  a.storage.fail = true;
  a.run("logCare('basil', 'water')");
  assert.equal(a.storage.getItem(key), original);
  assert.equal(a.run('storageDirty'), true);
  assert.match(a.elements.get('storage-status').innerHTML, /could not be saved/);
});

test('a valid previous copy can be recovered without overwriting damaged data', () => {
  const storage = memoryStorage({ [key]: '{broken', [`${key}:backup`]: JSON.stringify(fixture()) });
  const result = reliability.readGardenSnapshot(storage, key);
  assert.equal(result.source, 'backup');
  assert.equal(result.blocked, true);
  assert.equal(storage.getItem(key), '{broken');
  assert.equal(storage.writes, 0);
  assert.equal(reliability.writeGardenSnapshot(storage, key, fixture(), { blocked: true }).ok, false);
});

test('backup rotation retains the previous valid snapshot', () => {
  const saved = fixture(); const original = JSON.stringify(saved);
  const storage = memoryStorage({ [key]: original });
  saved.plants[0].name = 'Updated basil';
  assert.equal(reliability.writeGardenSnapshot(storage, key, saved).ok, true);
  assert.equal(storage.getItem(`${key}:backup`), original);
});

test('export and restore round trip all history beyond the old 60-entry limit', () => {
  const a = app();
  a.run("state.journal = Array.from({ length: 125 }, (_, i) => ({ text: 'Checked basil', who: 'Basil', plantId: 'basil', type: 'check', at: new Date().toISOString(), id: i })); saveState()");
  const saved = reliability.parseGardenSnapshot(a.storage.getItem(key));
  assert.equal(saved.journal.length, 125);
  assert.equal(reliability.parseGardenSnapshot(JSON.stringify({ format: reliability.BACKUP_FORMAT, version: 1, data: saved })).journal.length, 125);
});

test('restore previews are nonmutating and rejected restores preserve both copies', () => {
  const a = app(); const original = a.storage.getItem(key);
  const replacement = fixture(); replacement.plants[0].name = 'Replacement';
  a.run(`previewBackup(${JSON.stringify(JSON.stringify(replacement))})`);
  assert.equal(a.run('state.plants[0].name'), 'Basil');
  a.storage.fail = true;
  a.run('restoreBackup()');
  assert.equal(a.run('state.plants[0].name'), 'Basil');
  assert.equal(a.storage.getItem(key), original);
});

test('archive preserves the plant and full journal', () => {
  const a = app();
  a.run("logCare('basil', 'water'); navigate = () => {}; renderPlanters = () => {}; deletePlant('basil')");
  assert.equal(a.run('state.plants.length'), 0);
  assert.equal(a.run('state.archivedPlants[0].id'), 'basil');
  assert.equal(a.run('state.journal.length'), 1);
});

test('backup validation rejects malformed plans, duplicate IDs, and prototype keys', () => {
  const duplicate = fixture(); duplicate.plants.push({ ...duplicate.plants[0] });
  assert.throws(() => reliability.parseGardenSnapshot(JSON.stringify(duplicate)), /duplicated/);
  const badDate = fixture(); badDate.plants[0].care.water.dueAt = '2026-02-31';
  assert.throws(() => reliability.parseGardenSnapshot(JSON.stringify(badDate)), /date/);
  assert.throws(() => reliability.parseGardenSnapshot('{"plants":[],"journal":[],"__proto__":{}}'), /safe/);
  assert.throws(() => reliability.parseGardenSnapshot('{"format":"brittanys-garden-backup","version":99,"data":{}}'), /version/);
});

test('importing a backup never opts into another private AI server', () => {
  const saved = fixture(); saved.settings.aiEndpoint = 'https://example.com/helper';
  assert.equal(reliability.parseGardenSnapshot(JSON.stringify(saved)).settings.aiEndpoint, 'https://example.com/helper');
  assert.equal(reliability.parseGardenSnapshot(JSON.stringify(saved), { importing: true }).settings.aiEndpoint, '');
});

test('streak counts consecutive care days, not plant additions or repeated taps', () => {
  const journal = [21, 22, 22].map(day => ({ type: 'water', at: `2026-10-${day}T10:00:00` }));
  journal.push({ type: 'add', at: '2026-10-20T10:00:00' });
  assert.equal(reliability.gardenStreak(journal, new Date('2026-10-22T12:00:00')), 2);
  assert.equal(reliability.gardenStreak(journal, new Date('2026-10-25T12:00:00')), 0);
});

test('calendar reminder has one recurring event, a local time, and an alarm', () => {
  const ics = reliability.buildDailyReminder({ time: '08:30' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /DTSTART:20260101T083000\r\n/);
  assert.match(ics, /RRULE:FREQ=DAILY/);
  assert.match(ics, /BEGIN:VALARM/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.throws(() => reliability.buildDailyReminder({ time: '25:99' }));
});

test('calendar endpoint serves subscriptions and rejects invalid times', () => {
  function response() { return { headers: {}, status(code) { this.code = code; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, end(body) { this.body = body; return this; } }; }
  const good = response(); calendarHandler({ method: 'GET', query: { time: '07:15' } }, good);
  assert.equal(good.code, 200); assert.match(good.headers['Content-Type'], /text\/calendar/); assert.match(good.body, /T071500/);
  const bad = response(); calendarHandler({ method: 'GET', query: { time: 'invalid' } }, bad); assert.equal(bad.code, 400);
});
