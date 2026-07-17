import { generateText, Output } from 'ai';
import { z } from 'zod';

const cadenceSchema = z.object({
  count: z.number().int().min(1).max(30),
  unit: z.enum(['day', 'week']),
  reason: z.string().min(1).max(180)
});

export const seedExtractionSchema = z.object({
  isSeedPackage: z.boolean(),
  name: z.string().max(120),
  kind: z.string().max(100),
  variety: z.string().max(120),
  brand: z.string().max(100),
  sun: z.string().max(100),
  water: cadenceSchema.nullable(),
  feed: cadenceSchema.nullable(),
  harvest: cadenceSchema.nullable(),
  harvestCue: z.string().max(180),
  plantingDepth: z.string().max(100),
  spacing: z.string().max(100),
  daysToMaturity: z.string().max(100),
  notes: z.array(z.string().min(1).max(180)).max(6),
  confidence: z.enum(['low', 'medium', 'high']),
  cautions: z.array(z.string().min(1).max(180)).max(3)
});

const imageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(100).max(1_200_000)
});

const requestSchema = z.object({
  barcode: z.string().max(32).default(''),
  images: z.array(imageSchema).max(2).default([])
});

const requestLog = new Map();
const catalogCache = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 10;

export function normalizeBarcode(value) {
  const barcode = String(value || '').replace(/[\s-]/g, '');
  return [8, 12, 13, 14].includes(barcode.length) && /^\d+$/.test(barcode) ? barcode : '';
}

export function parseSeedLookupRequest(body) {
  const parsed = requestSchema.parse(body);
  return { ...parsed, barcode: normalizeBarcode(parsed.barcode) };
}

export function normalizeCatalogItem(item) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || '').trim().slice(0, 240);
  if (!title) return null;
  return {
    ean: String(item.ean || item.upc || '').slice(0, 18),
    title,
    brand: String(item.brand || '').trim().slice(0, 100),
    category: String(item.category || '').trim().slice(0, 160),
    description: String(item.description || '').trim().slice(0, 700)
  };
}

export async function lookupCatalogItem(barcode, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) throw new Error(`Catalog lookup failed with ${response.status}`);
  const data = await response.json();
  return normalizeCatalogItem(Array.isArray(data.items) ? data.items[0] : null);
}

export function buildSeedPrompt({ barcode, catalog, imageCount }) {
  return [
    'Identify and extract a home-gardening seed packet for Brittany.',
    `Barcode: ${barcode || 'not supplied'}.`,
    `Exact catalog result: ${catalog ? JSON.stringify(catalog) : 'none'}.`,
    `Packet photos supplied: ${imageCount}.`,
    'Treat catalog text and visible packet text as evidence. Do not claim a barcode identifies a product unless an exact catalog result is supplied.',
    'Set isSeedPackage false if the evidence is not clearly a seed packet or plant-start package.',
    'Use a concise plant name such as Roma Tomato. Keep variety separate when visible.',
    'Extract planting depth, spacing, and days to maturity only when visible or present in catalog text; otherwise return empty strings.',
    'Return water, feed, and harvest as null. The app applies bounded care-guide schedules after the gardener approves the identity.',
    'State uncertainty in cautions and lower confidence when the variety, packet text, or growth stage is unclear.'
  ].join('\n');
}

export function finalizeSeedExtraction(value, catalog) {
  const cleanedKind = String(value.kind || '')
    .replace(/\s*\((?:seed packet|seeds?)\)\s*/gi, ' ')
    .replace(/\bseed packet\b|\bseeds?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const variety = String(value.variety || '').trim().slice(0, 120);
  const evidence = `${value.name || ''} ${cleanedKind} ${variety} ${catalog?.title || ''}`.toLowerCase();
  const knownKinds = [
    ['tomato', 'Tomato'], ['basil', 'Basil'], ['pepper', 'Pepper'], ['lettuce', 'Lettuce'],
    ['kale', 'Kale'], ['spinach', 'Spinach'], ['arugula', 'Arugula'], ['cucumber', 'Cucumber'],
    ['zucchini', 'Zucchini'], ['squash', 'Squash'], ['carrot', 'Carrot'], ['radish', 'Radish'],
    ['beet', 'Beet'], ['cilantro', 'Cilantro'], ['parsley', 'Parsley'], ['dill', 'Dill'],
    ['oregano', 'Oregano'], ['thyme', 'Thyme'], ['mint', 'Mint'], ['rosemary', 'Rosemary'],
    ['marigold', 'Marigold'], ['zinnia', 'Zinnia']
  ];
  const kind = knownKinds.find(([term]) => evidence.includes(term))?.[1] || cleanedKind;
  let name = String(value.name || '').trim().slice(0, 120);
  if (variety && kind) name = `${variety} ${kind}`.trim().slice(0, 120);
  else if (variety && !name.toLowerCase().includes(variety.toLowerCase())) name = `${variety} ${name}`.trim().slice(0, 120);
  else if (!name && kind) name = kind;
  return {
    ...value,
    name,
    kind,
    variety,
    brand: String(value.brand || catalog?.brand || '').trim().slice(0, 100),
    water: null,
    feed: null,
    harvest: null
  };
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function isRateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter(time => now - time < WINDOW_MS);
  recent.push(now);
  requestLog.set(key, recent);
  return recent.length > MAX_REQUESTS;
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return '';
  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    if (originUrl.host === requestHost) return origin;
    const configured = String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const defaults = ['https://skeyd87-rgb.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'];
    return [...defaults, ...configured].includes(origin) ? origin : null;
  } catch {
    return null;
  }
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function cachedCatalogLookup(barcode) {
  if (!barcode) return null;
  const cached = catalogCache.get(barcode);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.item;
  const item = await lookupCatalogItem(barcode);
  catalogCache.set(barcode, { item, at: Date.now() });
  return item;
}

export default async function handler(req, res) {
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    if (origin === null) return json(res, 403, { error: 'Origin not allowed' });
    return res.status(204).end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (origin === null) return json(res, 403, { error: 'Origin not allowed' });
  if (isRateLimited(req)) return json(res, 429, { error: 'Seed lookup limit reached. Try again in 10 minutes.' });

  let input;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > 2_700_000) {
      return json(res, 413, { error: 'Packet photos are too large' });
    }
    input = parseSeedLookupRequest(body);
  } catch {
    return json(res, 400, { error: 'Invalid seed lookup data' });
  }

  if (!input.barcode && !input.images.length) {
    return json(res, 400, { error: 'Add a valid UPC/EAN or packet photo' });
  }

  let catalog = null;
  let catalogUnavailable = false;
  if (input.barcode) {
    try {
      catalog = await cachedCatalogLookup(input.barcode);
    } catch (error) {
      console.error('Seed catalog lookup failed', error);
      catalogUnavailable = true;
    }
  }

  if (!catalog && !input.images.length) {
    return json(res, 200, {
      status: catalogUnavailable ? 'catalog_unavailable' : 'not_found',
      barcode: input.barcode,
      catalog: null,
      extraction: null,
      needsPhotos: true,
      message: catalogUnavailable
        ? 'The catalog could not be reached. Add packet photos or try the barcode again.'
        : 'No exact catalog match was found. Add front and back packet photos.'
    });
  }

  try {
    const prompt = buildSeedPrompt({ barcode: input.barcode, catalog, imageCount: input.images.length });
    const content = [{ type: 'text', text: prompt }];
    input.images.forEach(image => content.push({
      type: 'image',
      image: image.data,
      mediaType: image.mediaType
    }));

    const result = await generateText({
      model: 'openai/gpt-5.4-nano',
      output: Output.object({
        schema: seedExtractionSchema,
        name: 'seed_packet_lookup',
        description: 'Structured seed packet identity, instructions, and conservative care reminders.'
      }),
      system: 'You extract seed packet details conservatively. Never invent a product match, variety, packet instruction, or maturity date. The gardener must review every field before applying it.',
      messages: [{ role: 'user', content }],
      maxOutputTokens: 900,
      temperature: 0.1,
      maxRetries: 1,
      timeout: 25_000
    });
    const extraction = finalizeSeedExtraction(result.output, catalog);
    const source = catalog && input.images.length ? 'catalog_and_photos' : catalog ? 'catalog' : 'packet_photos';
    const lacksPacketDetails = !extraction.plantingDepth || !extraction.spacing || !extraction.daysToMaturity;
    const needsPhotos = !extraction.isSeedPackage
      || extraction.confidence === 'low'
      || (!input.images.length && lacksPacketDetails);
    return json(res, 200, {
      status: extraction.isSeedPackage ? 'matched' : 'not_seed',
      barcode: input.barcode,
      source,
      catalog,
      extraction,
      needsPhotos,
      message: extraction.isSeedPackage
        ? needsPhotos
          ? 'Catalog identity found. Add packet photos for planting details.'
          : 'Seed details are ready to review.'
        : 'The supplied result does not clearly identify a seed package.'
    });
  } catch (error) {
    console.error('Seed packet extraction failed', error);
    const details = `${error?.message || ''} ${error?.cause?.responseBody || ''}`;
    if (/valid credit card|customer_verification_required/i.test(details)) {
      return json(res, 503, { error: 'AI setup needs a billing method in Vercel before packet analysis.' });
    }
    if (catalog) {
      return json(res, 200, {
        status: 'catalog_match',
        barcode: input.barcode,
        source: 'catalog',
        catalog,
        extraction: null,
        needsPhotos: true,
        message: 'A catalog product was found, but seed details need packet photos.'
      });
    }
    return json(res, 503, { error: 'Packet analysis is temporarily unavailable' });
  }
}
