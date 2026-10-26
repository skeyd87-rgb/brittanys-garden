import { createHash } from 'node:crypto';
import { allowedMoveSource, isLoopback, validateMovePacket, MAX_MOVE_FORM_BYTES } from '../outputs/garden-move.js';

export function moveId(packet) {
  // No volatile timestamps: retrying the old icon must not import a stale copy
  // over edits already made after a successful move.
  const { savedAt, lastBackupAt, doneDate, doneToday, ...snapshot } = packet.snapshot;
  return createHash('sha256').update(JSON.stringify({ ...packet, snapshot })).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end('Open the old Garden app and choose Continue with Google.'); }
  try {
    if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw new Error('Use the Continue button in the old Garden app.');
    const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
    if (!body || Object.keys(body).length !== 1 || typeof body.packet !== 'string') throw new Error('The garden copy could not be read.');
    if (Buffer.byteLength(new URLSearchParams({ packet: body.packet }).toString()) > MAX_MOVE_FORM_BYTES) return res.status(413).end('This copy is too large to move automatically. Your garden is still safe in the old app.');
    const packet = validateMovePacket(body.packet);
    const destination = `https://${req.headers.host}`;
    const localDestination = isLoopback(destination) ? `http://${req.headers.host}` : destination;
    if (new URL(packet.source).origin !== req.headers.origin || !allowedMoveSource(packet.source, localDestination)) return res.status(403).end('Move your saved garden using Continue with Google in the old Garden app.');
    const data = JSON.stringify({ id: moveId(packet), packet }).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const next = isLoopback(destination) && req.query?.emulators === '1' ? '?emulators=1' : '?v=16';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moving your garden</title><style>body{font:18px/1.6 system-ui,sans-serif;background:#f8f5ec;color:#243c28;max-width:34rem;margin:12vh auto;padding:24px}h1{font-size:28px}a{color:#315a33}button{font:inherit;padding:10px 18px}</style></head><body><h1 id="move-title">Keeping your saved garden</h1><p id="move-message">Preparing this device at the current Garden address. The old copy stays where it is.</p><p id="move-actions" hidden><button type="button" id="move-retry">Try again</button> <a href="https://skeyd87-rgb.github.io/brittanys-garden/">Return to the old app</a></p><noscript>Turn on JavaScript, then return to the old app and try again. Its saved garden is unchanged.</noscript><script id="garden-move-data" type="application/json" data-next="${next}">${data}</script><script type="module" src="/outputs/garden-move-receiver.js?v=16"></script></body></html>`);
  } catch {
    return res.status(400).end('This garden copy could not be moved. Return to the old app; its saved garden has not changed.');
  }
}
