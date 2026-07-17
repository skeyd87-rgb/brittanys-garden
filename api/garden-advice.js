import { generateText, Output } from 'ai';
import { z } from 'zod';

const cadenceSchema = z.object({
  count: z.number().int().min(1).max(30),
  unit: z.enum(['day', 'week']),
  reason: z.string().min(1).max(180)
});

export const adviceSchema = z.object({
  advice: z.string().min(1).max(900),
  suggestions: z.object({
    water: cadenceSchema.nullable(),
    feed: cadenceSchema.nullable(),
    harvest: cadenceSchema.nullable(),
    sun: z.string().max(100),
    harvestCue: z.string().max(180)
  }),
  confidence: z.enum(['low', 'medium', 'high']),
  cautions: z.array(z.string().min(1).max(180)).max(3)
});

const requestSchema = z.object({
  today: z.string().max(20),
  plant: z.object({
    name: z.string().min(1).max(100),
    kind: z.string().max(100).default(''),
    seedCode: z.string().max(160).default(''),
    planter: z.string().max(100).default(''),
    status: z.enum(['happy', 'thirsty', 'trim', 'harvest']),
    water: z.string().max(100).default(''),
    feed: z.string().max(100).default(''),
    harvestCue: z.string().max(180).default(''),
    notes: z.string().max(800).default('')
  }),
  garden: z.object({
    name: z.string().max(100).default(''),
    location: z.string().max(160).default(''),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable()
  }),
  weather: z.object({
    temp: z.number(),
    code: z.number(),
    precipitation: z.number(),
    updatedAt: z.string().max(40)
  }).nullable(),
  guide: z.array(z.string().max(240)).max(8)
});

const requestLog = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 8;

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

export function parseGardenRequest(body) {
  return requestSchema.parse(body);
}

export function buildGardenPrompt(input) {
  const numericBarcode = /^\d{6,18}$/.test(input.plant.seedCode);
  return [
    `Today is ${input.today}. Give practical container-gardening guidance for this one plant.`,
    'The gardener is a home gardener. Be concise, cautious, and specific about what to do next.',
    'Cadences are reminders to inspect and care, not guarantees that water or harvest is always needed.',
    'Use the supplied location and current weather only as context. Do not claim a forecast.',
    numericBarcode
      ? 'The seed code is only a numeric barcode. Do not identify a product or variety from it.'
      : 'Package text may help, but do not invent a variety or product identity.',
    'If plant identity or growth stage is unclear, lower confidence and say what Brittany should check.',
    `Plant data: ${JSON.stringify(input.plant)}`,
    `Garden data: ${JSON.stringify(input.garden)}`,
    `Current weather observation: ${JSON.stringify(input.weather)}`,
    `Built-in guide context: ${JSON.stringify(input.guide)}`
  ].join('\n');
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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
  if (isRateLimited(req)) return json(res, 429, { error: 'AI limit reached. Try again in 10 minutes.' });

  let input;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > 16_000) {
      return json(res, 413, { error: 'Request is too large' });
    }
    input = parseGardenRequest(body);
  } catch {
    return json(res, 400, { error: 'Invalid garden data' });
  }

  try {
    const result = await generateText({
      model: 'openai/gpt-5.4-nano',
      output: Output.object({
        schema: adviceSchema,
        name: 'garden_advice',
        description: 'Conservative care advice and optional editable care cadence suggestions.'
      }),
      system: 'You are a careful gardening knowledge assistant. Never pretend a barcode reveals product data. Avoid pesticide, disease, or food-safety certainty. Suggestions must be reviewed by the gardener.',
      prompt: buildGardenPrompt(input),
      maxOutputTokens: 700,
      temperature: 0.2,
      maxRetries: 1,
      timeout: 20_000
    });
    return json(res, 200, result.output);
  } catch (error) {
    console.error('Garden AI request failed', error);
    const details = `${error?.message || ''} ${error?.cause?.responseBody || ''}`;
    if (/valid credit card|customer_verification_required/i.test(details)) {
      return json(res, 503, { error: 'AI setup needs a billing method in Vercel before first use.' });
    }
    return json(res, 503, { error: 'Garden AI is temporarily unavailable' });
  }
}
