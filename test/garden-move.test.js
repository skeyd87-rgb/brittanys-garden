import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { moveId } from '../api/move-garden.js';
import { allowedMoveSource, moveDestination, makeMovePacket, validateMovePacket, postGardenMove, moveStores, stageGardenMove, latestGardenMove, saveMoveReceipt, seedMovedGarden, MAX_MOVE_BYTES } from '../outputs/garden-move.js';
import { createDeviceStore } from '../outputs/garden-sync.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const source = 'https://skeyd87-rgb.github.io/brittanys-garden/outputs/brittanys-garden-cozy-companion.html';
const canonical = 'https://brittanys-garden.vercel.app';
const garden = name => ({ plants: name ? [{ id: 'basil', name, kind: 'Basil', status: 'happy', care: {} }] : [], journal: [], archivedPlants: [], settings: {}, savedAt: '2026-10-25T12:00:00Z' });
const packet = name => makeMovePacket(garden(name), { original: '{original bytes}', backup: '{backup bytes}' }, null, source);
const transfer = name => { const value = packet(name); return { id: moveId(value), packet: value }; };
function memoryStore(value = null) {
  return { value: clone(value), writes: 0, fail: false, lost: false,
    async read() { return clone(this.value); },
    async write(next) { this.writes++; if (this.fail) throw new Error('Storage full'); if (!this.lost) this.value = clone(next); }
  };
}
function stores() {
  const values = new Map();
  return moveStores(({ key }) => {
    if (!values.has(key)) values.set(key, memoryStore());
    return values.get(key);
  });
}
async function request(value = transfer('Old basil').packet, extra = {}) {
  const req = { method: 'POST', headers: { host: 'brittanys-garden.vercel.app', origin: 'https://skeyd87-rgb.github.io', 'content-type': 'application/x-www-form-urlencoded' }, body: { packet: JSON.stringify(value) }, ...extra };
  const res = { code: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, end(body) { this.body = body; return this; } };
  await handler(req, res); return res;
}

test('only known old hosts move to production, and local tests remain loopback-only', () => {
  assert.equal(allowedMoveSource(source, canonical), true);
  assert.equal(allowedMoveSource('https://skeyd87-rgb.github.io/another-app/', canonical), false);
  assert.equal(allowedMoveSource('https://someone.github.io/brittanys-garden/', canonical), false);
  assert.equal(allowedMoveSource('https://skeyd87-rgb.github.io.evil.test/brittanys-garden/', canonical), false);
  assert.equal(allowedMoveSource('http://127.0.0.1:7433/', canonical), false);
  assert.equal(allowedMoveSource('http://127.0.0.1:7433/', 'http://127.0.0.1:7432'), true);
  assert.equal(allowedMoveSource(source + '?data=private', canonical), false);
  assert.equal(moveDestination(source), canonical);
  assert.equal(moveDestination(canonical + '/?moveTo=https://evil.test'), '');
  assert.equal(moveDestination('http://127.0.0.1:7433/?moveTo=http://127.0.0.1:7432'), 'http://127.0.0.1:7432');
  assert.equal(moveDestination('http://127.0.0.1:7433/?moveTo=https://evil.test'), '');
});

test('the handoff keeps original damaged bytes without interpreting them as garden data', () => {
  const value = makeMovePacket(garden('Last good basil'), { blocked: true, original: '{damaged', backup: JSON.stringify(garden('Last good basil')) }, null, source + '?v=15#private');
  assert.equal(value.blocked, true); assert.equal(value.original, '{damaged');
  assert.equal(value.source, source); assert.equal(value.snapshot.plants[0].name, 'Last good basil');
});

test('the newest saved copy wins even across an interrupted device database write', () => {
  const old = garden('Old basil'), next = garden('Latest basil'); next.savedAt = '2026-10-25T20:00:00Z';
  assert.equal(makeMovePacket(old, {}, { snapshot: next, pending: true }, source).snapshot.plants[0].name, 'Latest basil');
  assert.equal(makeMovePacket(next, {}, { snapshot: old, pending: true }, source).snapshot.plants[0].name, 'Latest basil');
});

test('display-only normalization cannot create another import when the saved original is unchanged', () => {
  const original = JSON.stringify(garden('Saved basil'));
  const rendered = garden('Saved basil'); rendered.plants[0].care = { water: { text: '', createdAt: '2026-10-25T20:00:00Z' } };
  const first = makeMovePacket(rendered, { original }, null, source);
  rendered.plants[0].care.water.createdAt = '2026-10-26T20:00:00Z';
  const next = makeMovePacket(rendered, { original }, null, source);
  assert.equal(moveId(first), moveId(next));
  assert.deepEqual(next.snapshot.plants[0].care, {});
});

test('migration does not opt into an external AI helper and rejects malformed or unsafe packets', () => {
  const value = packet('Basil'); value.snapshot.settings.aiEndpoint = 'https://unrelated.test/api';
  assert.equal(validateMovePacket(JSON.stringify(value)).snapshot.settings.aiEndpoint, '');
  assert.throws(() => validateMovePacket('{"__proto__":{}}'));
  assert.throws(() => validateMovePacket(JSON.stringify({ ...value, accessToken: 'never-transfer-auth' })));
  assert.throws(() => validateMovePacket(JSON.stringify({ ...value, snapshot: { plants: [] } })));
  assert.throws(() => validateMovePacket(' '.repeat(MAX_MOVE_BYTES + 1)));
});

test('a move uses a top-level form POST with no private content in its URL', () => {
  const elements = [];
  const document = { body: { append(value) { elements.push(value); } }, createElement(tag) { return { tag, append(value) { this.child = value; }, submit() { this.submitted = true; } }; } };
  postGardenMove(packet('Private plant'), canonical, { document, href: source });
  assert.equal(elements[0].action, canonical + '/api/move-garden'); assert.equal(elements[0].method, 'POST');
  assert.equal(elements[0].submitted, true); assert.match(elements[0].child.value, /Private plant/);
  assert.equal(elements[0].child.name, 'packet'); assert.equal(elements[0].action.includes('Private'), false);
});

test('the endpoint reflects only a permitted source and never grants database access', async () => {
  const res = await request();
  assert.equal(res.code, 200); assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(res.body, /garden-move-receiver.js\?v=16/);
  assert.equal((await request(undefined, { method: 'GET' })).code, 405);
  const headers = { host: 'brittanys-garden.vercel.app', origin: 'https://untrusted.test', 'content-type': 'application/x-www-form-urlencoded' };
  assert.equal((await request(undefined, { headers })).code, 403);
  assert.equal((await request(undefined, { headers: { ...headers, origin: 'null' } })).code, 403);
  assert.equal((await request(undefined, { headers: { ...headers, origin: 'http://127.0.0.1:7433' }, body: { packet: JSON.stringify({ ...packet('Basil'), source: 'http://127.0.0.1:7433/' }) } })).code, 403);
});

test('garden text cannot escape the inert JSON element in the move response', async () => {
  const value = packet('Basil'); value.snapshot.plants[0].notes = '</script><script>alert(1)</script>';
  const res = await request(value);
  assert.equal(res.code, 200); assert.equal(res.body.includes('<script>alert(1)'), false);
  assert.match(res.body, /\\u003c\/script>/);
  const embedded = JSON.parse(res.body.match(/data-next="[^"]+">([\s\S]*?)<\/script>/)[1]);
  assert.equal(embedded.packet.snapshot.plants[0].notes, value.snapshot.plants[0].notes);
});

test('move receipts are stable across daily completion flags and backup timestamps', () => {
  const first = packet('Basil'), again = clone(first);
  again.snapshot.savedAt = '2026-10-26T12:00:00Z'; again.snapshot.doneDate = '2026-10-26'; again.snapshot.lastBackupAt = again.snapshot.savedAt;
  assert.equal(moveId(first), moveId(again));
  again.snapshot.plants[0].name = 'Changed basil'; assert.notEqual(moveId(first), moveId(again));
});

test('a repeated transfer preserves its receipt and the original incoming copy', async () => {
  const s = stores(), incoming = transfer('Basil');
  const copy = await stageGardenMove(incoming, s);
  copy.status = 'kept'; await saveMoveReceipt(copy, s);
  await stageGardenMove(incoming, s);
  assert.equal((await latestGardenMove(s)).status, 'kept');
  assert.deepEqual((await s.index.read()).ids, [incoming.id]);
});

test('distinct incoming copies are retained separately until reviewed', async () => {
  const s = stores(), first = transfer('Basil'), second = transfer('Tomato');
  await stageGardenMove(first, s); await stageGardenMove(second, s);
  assert.equal((await latestGardenMove(s)).id, second.id);
  assert.equal((await s.copy(first.id).read()).packet.snapshot.plants[0].name, 'Basil');
});

test('a move cannot navigate onward if its copy or index was not retained', async () => {
  const s = stores(), incoming = transfer('Basil');
  s.copy(incoming.id).lost = true;
  await assert.rejects(stageGardenMove(incoming, s), /could not be kept/);
  assert.equal(await s.index.read(), null);
  s.copy(incoming.id).lost = false; s.index.lost = true;
  await assert.rejects(stageGardenMove(incoming, s), /could not be retained/);
  s.index.lost = false; await stageGardenMove(incoming, s);
  assert.equal((await latestGardenMove(s)).id, incoming.id);
});

test('an empty new destination is seeded durably with recovery bytes before auth', async () => {
  const s = stores(), copy = await stageGardenMove(transfer('Old basil'), s), destination = memoryStore();
  copy.packet.blocked = true;
  assert.equal(await seedMovedGarden(copy, { store: destination, snapshot: garden(), localInfo: {}, stores: s }), true);
  assert.equal(destination.value.snapshot.plants[0].name, 'Old basil');
  assert.equal(destination.value.legacyBlocked, true); assert.equal(destination.value.version, 0);
  assert.equal(destination.value.originalDeviceCopy.original, '{original bytes}');
  assert.equal((await latestGardenMove(s)).status, 'seeded');
});

for (const [name, local, previous, blocked] of [
  ['existing local garden', garden('Current basil'), null, false],
  ['unreadable local original', garden(), null, true],
  ['linked empty garden', garden(), { snapshot: garden(), linked: true, version: 3 }, false],
  ['queued empty garden', garden(), { snapshot: garden(), pending: true, version: 0 }, false],
  ['existing independent garden', garden(), { snapshot: garden('Current tomato'), version: 0 }, false]
]) test(`a moved copy does not overwrite an ${name}`, async () => {
  const s = stores(), copy = await stageGardenMove(transfer('Old basil'), s), destination = memoryStore(previous);
  assert.equal(await seedMovedGarden(copy, { store: destination, snapshot: local, localInfo: { blocked }, stores: s }), false);
  assert.equal(destination.writes, 0); assert.equal((await latestGardenMove(s)).status, 'pending');
});

test('a failed destination save leaves the incoming copy pending for review', async () => {
  const s = stores(), copy = await stageGardenMove(transfer('Old basil'), s), destination = memoryStore(); destination.lost = true;
  await assert.rejects(seedMovedGarden(copy, { store: destination, snapshot: garden(), localInfo: {}, stores: s }), /could not be saved/);
  assert.equal((await latestGardenMove(s)).status, 'pending');
});

test('an accepted old transfer cannot overwrite newer destination edits on reopening', async () => {
  const s = stores(), incoming = transfer('Old basil'), copy = await stageGardenMove(incoming, s), destination = memoryStore();
  await seedMovedGarden(copy, { store: destination, snapshot: garden(), localInfo: {}, stores: s });
  destination.value.snapshot = garden('Newer phone changes');
  await stageGardenMove(incoming, s);
  assert.equal(await seedMovedGarden(await latestGardenMove(s), { store: destination, snapshot: garden(), localInfo: {}, stores: s }), false);
  assert.equal(destination.value.snapshot.plants[0].name, 'Newer phone changes');
});

test('incoming transfer fallback storage never replaces the current sync record', async () => {
  const data = new Map(); const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const current = createDeviceStore({ indexedDB: null, storage });
  const incoming = createDeviceStore({ indexedDB: null, storage, key: 'move-example' });
  await current.write({ snapshot: garden('Current basil'), modifiedAt: 1 });
  await incoming.write({ snapshot: garden('Moved tomato'), modifiedAt: 2 });
  assert.equal((await current.read()).snapshot.plants[0].name, 'Current basil');
  assert.equal((await incoming.read()).snapshot.plants[0].name, 'Moved tomato');
});
