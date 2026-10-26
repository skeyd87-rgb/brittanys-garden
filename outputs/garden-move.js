import { parseGardenSnapshot } from './garden-reliability.js';
import { createDeviceStore, fingerprint, hasGardenData } from './garden-sync.js?v=16';

export const GARDEN_ORIGIN = 'https://brittanys-garden.vercel.app';
export const MAX_MOVE_BYTES = 3000000;
export const MAX_MOVE_FORM_BYTES = 4000000;
const OLD_ORIGINS = new Set([
  'https://skeyd87-rgb.github.io',
  'https://brittanys-garden-steven-key-s-projects.vercel.app',
  'https://brittanys-garden-git-main-steven-key-s-projects.vercel.app'
]);
export const isLoopback = url => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);

export function allowedMoveSource(source, destination) {
  try {
    const from = new URL(source), to = new URL(destination);
    if (from.username || from.password || from.hash || from.search) return false;
    if (isLoopback(from) && isLoopback(to)) return from.protocol === 'http:' && to.protocol === 'http:';
    if (to.origin !== GARDEN_ORIGIN && !(to.hostname.startsWith('brittanys-garden-') && to.hostname.endsWith('-steven-key-s-projects.vercel.app'))) return false;
    return OLD_ORIGINS.has(from.origin) && (from.hostname !== 'skeyd87-rgb.github.io' || from.pathname.startsWith('/brittanys-garden/'));
  } catch { return false; }
}

export function moveDestination(href) {
  const current = new URL(href);
  if (OLD_ORIGINS.has(current.origin)) return GARDEN_ORIGIN;
  // This local-only switch exercises a real cross-origin form navigation in QA.
  const preview = current.searchParams.get('moveTo');
  if (isLoopback(current) && preview && allowedMoveSource(current.origin, preview)) return new URL(preview).origin;
  return '';
}

export function validateMovePacket(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_MOVE_BYTES) throw new Error('This garden copy is too large to move automatically. Its original is still safe in the old app.');
  const value = JSON.parse(raw, (key, item) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid garden copy.');
    return item;
  });
  const keys = ['version', 'source', 'snapshot', 'blocked', 'original', 'backup', 'recovery'];
  if (!value || value.version !== 1 || Object.keys(value).some(key => !keys.includes(key)) || typeof value.source !== 'string' || typeof value.blocked !== 'boolean') throw new Error('Invalid garden copy.');
  for (const key of ['original', 'backup']) if (typeof value[key] !== 'string') throw new Error('Invalid original garden copy.');
  return { version: 1, source: value.source,
    snapshot: parseGardenSnapshot(JSON.stringify(value.snapshot), { importing: true }),
    blocked: value.blocked, original: value.original, backup: value.backup,
    recovery: value.recovery ? parseGardenSnapshot(JSON.stringify(value.recovery), { importing: true }) : null };
}

export function makeMovePacket(snapshot, info, previous, href) {
  // The old screen normalizes missing care fields for display with today's
  // date. Transfer the saved bytes' snapshot so those display defaults cannot
  // turn every reopening into a different import.
  for (const raw of [info.original, info.backup]) {
    if (!raw) continue;
    try { snapshot = parseGardenSnapshot(raw); break; } catch { /* Preserve unreadable bytes separately. */ }
  }
  if (previous) {
    // A queued IndexedDB edit may be newer than the legacy localStorage copy.
    const prior = parseGardenSnapshot(JSON.stringify(previous.snapshot));
    if ((prior.savedAt || '') >= (snapshot.savedAt || '')) snapshot = prior;
  }
  const source = new URL(href); source.search = ''; source.hash = '';
  return validateMovePacket(JSON.stringify({ version: 1, source: source.href, snapshot,
    blocked: !!previous?.legacyBlocked || !!info.blocked,
    original: info.original || previous?.originalDeviceCopy?.original || '',
    backup: info.backup || previous?.originalDeviceCopy?.backup || '', recovery: previous?.recovery || null }));
}

export function postGardenMove(packet, destination, { document = globalThis.document, href = globalThis.location.href } = {}) {
  const raw = JSON.stringify(validateMovePacket(JSON.stringify(packet)));
  if (new TextEncoder().encode(new URLSearchParams({ packet: raw }).toString()).length > MAX_MOVE_FORM_BYTES) throw new Error('This garden copy is too large to move automatically. Keep the old app and contact Steven to move its saved copy.');
  const action = new URL('/api/move-garden', destination);
  if (isLoopback(action) && new URL(href).searchParams.get('emulators') === '1') action.searchParams.set('emulators', '1');
  const form = document.createElement('form');
  form.method = 'POST'; form.action = action.href;
  const input = document.createElement('input');
  input.type = 'hidden'; input.name = 'packet'; input.value = raw;
  form.append(input); document.body.append(form);
  // A top-level POST keeps private garden contents out of URLs and history.
  form.submit();
}

export function moveStores(makeStore = createDeviceStore) {
  return { index: makeStore({ key: 'move-index' }), copy: id => makeStore({ key: `move-${id}` }) };
}

export async function stageGardenMove(transfer, stores = moveStores()) {
  if (!/^[a-f0-9]{64}$/.test(transfer?.id || '')) throw new Error('Invalid garden transfer.');
  const packet = validateMovePacket(JSON.stringify(transfer.packet));
  const copy = stores.copy(transfer.id);
  const previous = await copy.read();
  if (!previous) {
    await copy.write({ id: transfer.id, packet, status: 'pending', modifiedAt: Date.now() });
    const saved = await copy.read();
    if (saved?.id !== transfer.id || JSON.stringify(saved.packet) !== JSON.stringify(packet)) throw new Error('The moved garden could not be kept on this device. Return to the old app and try again.');
  }
  const index = await stores.index.read() || { ids: [] };
  if (!Array.isArray(index.ids)) throw new Error('The saved-copy list needs attention. The old garden is unchanged.');
  if (!index.ids.includes(transfer.id)) {
    await stores.index.write({ ids: [...index.ids, transfer.id], modifiedAt: Date.now() });
    if (!(await stores.index.read())?.ids?.includes(transfer.id)) throw new Error('The moved garden could not be retained. Return to the old app and try again.');
  }
  return previous || { id: transfer.id, packet, status: 'pending' };
}

export async function latestGardenMove(stores = moveStores()) {
  const index = await stores.index.read();
  const copies = await Promise.all((index?.ids || []).map(id => stores.copy(id).read()));
  return copies.findLast(copy => copy?.status === 'pending') || copies.at(-1) || null;
}

export async function saveMoveReceipt(copy, stores = moveStores()) {
  const value = { ...copy, modifiedAt: Date.now() };
  await stores.copy(copy.id).write(value);
  if (JSON.stringify(await stores.copy(copy.id).read()) !== JSON.stringify(value)) throw new Error('The recovery copy could not be kept. Nothing has been replaced.');
}

export async function seedMovedGarden(copy, { store, snapshot, localInfo, stores = moveStores() }) {
  if (!copy || copy.status !== 'pending') return false;
  const previous = await store.read();
  const same = previous?.snapshot && fingerprint(previous.snapshot) === fingerprint(copy.packet.snapshot);
  if (!same) {
    // Even an empty linked garden may reflect a deliberate edit on another
    // device. Only a new, empty destination may be seeded without a choice.
    if (localInfo.blocked || hasGardenData(snapshot) || previous && (previous.linked || previous.pending || previous.legacyBlocked || previous.version || hasGardenData(previous.snapshot))) return false;
    const record = { snapshot: copy.packet.snapshot, version: 0, linked: false, pending: false,
      lastSyncedAt: '', legacyBlocked: copy.packet.blocked, recovery: copy.packet.recovery,
      originalDeviceCopy: { original: copy.packet.original, backup: copy.packet.backup }, modifiedAt: Date.now() };
    await store.write(record);
    if (JSON.stringify(await store.read()) !== JSON.stringify(record)) throw new Error('The old garden could not be saved here. Its original is still safe in the old app.');
  }
  copy.status = 'seeded';
  await saveMoveReceipt(copy, stores);
  return true;
}
