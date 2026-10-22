// Shared by the app, its calendar endpoint, and the reliability tests.
export const BACKUP_FORMAT = 'brittanys-garden-backup';
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
const CARE_TYPES = new Set(['water', 'feed', 'pick', 'trim', 'check', 'add', 'edit', 'remove', 'restore']);

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day)) === value;
}

function text(value, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('This backup contains an invalid field.');
  return value;
}

export function parseGardenSnapshot(raw, { importing = false } = {}) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error('Choose a garden backup smaller than 4 MB.');
  const value = JSON.parse(raw, (key, item) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('This file is not a safe garden backup.');
    return item;
  });
  if (value?.format && (value.format !== BACKUP_FORMAT || value.version !== 1)) throw new Error('This backup version is not supported.');
  const saved = value?.format === BACKUP_FORMAT ? value.data : value;
  if (!saved || !Array.isArray(saved.plants) || !Array.isArray(saved.journal) || saved.plants.length > 1000 || saved.journal.length > 50000) throw new Error('This file is not a garden backup.');
  const ids = new Set();
  function validateCareEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('A plant care plan is invalid.');
    text(entry.text, 200);
    if (entry.dueAt && !validDay(entry.dueAt)) throw new Error('A care due date is invalid.');
    if (entry.repeat && (!Number.isInteger(entry.repeat.count) || entry.repeat.count < 1 || entry.repeat.count > 365 || !['day', 'week'].includes(entry.repeat.unit))) throw new Error('A care interval is invalid.');
  }
  function plant(p, archived = false) {
    if (!p || typeof p !== 'object' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) || ['__proto__', 'constructor', 'prototype'].includes(p.id) || ids.has(p.id)) throw new Error('Plant IDs in this backup are invalid or duplicated.');
    ids.add(p.id);
    text(p.name, 100, true);
    text(p.kind, 100);
    text(p.planter, 100);
    text(p.notes, 800);
    text(p.seedCode, 160);
    if (!['happy', 'thirsty', 'trim', 'harvest'].includes(p.status)) throw new Error('A plant has an unsupported care status.');
    for (const entry of Object.values(p.care || {})) validateCareEntry(entry);
    // These fields are displayed as text, never HTML.
    return { ...p, emoji: text(p.emoji, 24) || '🌿', mood: text(p.mood, 24) || '😊', moodText: text(p.moodText, 100), ...(archived ? { archivedAt: p.archivedAt || '' } : {}) };
  }
  const plants = saved.plants.map(p => plant(p));
  if (saved.archivedPlants && (!Array.isArray(saved.archivedPlants) || saved.archivedPlants.length > 1000)) throw new Error('Archived plants in this backup are invalid.');
  const archivedPlants = Array.isArray(saved.archivedPlants) ? saved.archivedPlants.map(p => plant(p, true)) : [];
  const journal = saved.journal.map(entry => {
    if (!entry || typeof entry !== 'object') throw new Error('A journal entry is invalid.');
    text(entry.text, 2000, true);
    text(entry.who, 100);
    if (entry.at && !Number.isFinite(new Date(entry.at).getTime())) throw new Error('A journal date is invalid.');
    let undo = null;
    if (entry.undo && ['', 'water', 'feed', 'harvest'].includes(entry.undo.careKey) && ['happy', 'thirsty', 'trim', 'harvest'].includes(entry.undo.status)) {
      if (entry.undo.careKey) validateCareEntry(entry.undo.careEntry);
      undo = { ...entry.undo, mood: text(entry.undo.mood, 24), moodText: text(entry.undo.moodText, 100), updatedAt: text(entry.undo.updatedAt, 40) };
    }
    return { ...entry, undo, careType: ['water', 'feed', 'trim', 'pick'].includes(entry.careType) ? entry.careType : '', emoji: text(entry.emoji, 24) || '🌱', dot: /^#[0-9a-f]{3,8}$/i.test(entry.dot) ? entry.dot : '#6a8d5b', type: CARE_TYPES.has(entry.type) ? entry.type : 'check' };
  });
  const settings = saved.settings && typeof saved.settings === 'object' && !Array.isArray(saved.settings) ? { ...saved.settings } : {};
  for (const key of ['gardener', 'garden', 'location', 'locationQuery', 'timezone', 'temp', 'reminderTime']) if (settings[key] != null) text(settings[key], 160);
  if (settings.trialStartedAt && !Number.isFinite(new Date(settings.trialStartedAt).getTime())) throw new Error('The trial date is invalid.');
  if (settings.reminderTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.reminderTime)) throw new Error('The reminder time is invalid.');
  if (settings.aiEndpoint) {
    const endpoint = new URL(text(settings.aiEndpoint, 500), 'https://brittanys-garden.vercel.app');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('The backup contains an unsafe helper address.');
    // Importing a file must not authorize sending garden data to another server.
    if (importing) settings.aiEndpoint = '';
  }
  for (const [key, bound] of [['latitude', 90], ['longitude', 180]]) if (settings[key] != null && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) || Math.abs(settings[key]) > bound)) throw new Error('The garden location is invalid.');
  return { plants, archivedPlants, journal, settings, doneDate: typeof saved.doneDate === 'string' ? saved.doneDate : '', doneToday: saved.doneToday && typeof saved.doneToday === 'object' ? saved.doneToday : {}, savedAt: saved.savedAt || '', lastBackupAt: saved.lastBackupAt || '' };
}

export function readGardenSnapshot(storage, key) {
  let primary;
  try { primary = storage.getItem(key); } catch { return { data: null, blocked: false, warning: 'Device storage is unavailable. Export a backup before closing the app.' }; }
  if (primary) {
    try { return { data: parseGardenSnapshot(primary), source: 'primary', blocked: false, warning: '' }; } catch { /* Keep the original record for recovery. */ }
  }
  let backup;
  try { backup = storage.getItem(`${key}:backup`); } catch { /* The primary record is still preserved. */ }
  if (backup) {
    try { return { data: parseGardenSnapshot(backup), source: 'backup', blocked: true, warning: 'A saved garden could not be opened. Your last good copy is shown. Export it, then choose Restore last good copy in Setup.' }; } catch { /* Neither record is deleted. */ }
  }
  return { data: null, blocked: !!primary, warning: primary ? 'Your saved garden could not be opened. It has been preserved. Restore a backup in Setup; new changes will not overwrite it.' : '' };
}

export function writeGardenSnapshot(storage, key, data, { blocked = false, allowReplace = false } = {}) {
  if (blocked && !allowReplace) return { ok: false, message: 'Saving is paused to protect your original garden. Export a backup or restore a good copy in Setup.' };
  try {
    const raw = JSON.stringify(data);
    // Validate before any storage write, including snapshots imported from a file.
    parseGardenSnapshot(raw);
    const previous = storage.getItem(key);
    if (previous && previous !== raw) {
      try {
        parseGardenSnapshot(previous);
        storage.setItem(`${key}:backup`, previous);
      } catch { /* A full device must not turn backup rotation into data loss. */ }
    }
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error('Save was not retained');
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: 'Changes are visible but could not be saved on this device. Keep the app open, export a backup, free some storage, then tap Retry save.' };
  }
}

export function gardenStreak(journal, now = new Date()) {
  const days = new Set(journal.filter(e => e.at && ['water', 'feed', 'trim', 'pick', 'check'].includes(e.type)).map(e => localDateKey(e.at)));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(localDateKey(cursor))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

export function buildDailyReminder({ time = '09:00', startDate = '2026-01-01', appUrl = 'https://brittanys-garden.vercel.app/' } = {}) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !validDay(startDate)) throw new Error('Choose a valid reminder time.');
  const url = new URL(appUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid garden address');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brittanys Garden//Daily Care//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Garden daily reminder', 'BEGIN:VEVENT', 'UID:daily-care@brittanys-garden.vercel.app', 'DTSTAMP:20260101T000000Z',
    `DTSTART:${startDate.replaceAll('-', '')}T${time.replace(':', '')}00`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Check your garden', 'DESCRIPTION:Open your garden and check today\'s care. Water only if the soil needs it.', `URL:${url.href}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Time for a quick garden check', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
  ];
  return lines.map(line => line.match(/.{1,73}/g).join('\r\n ')).join('\r\n') + '\r\n';
}
