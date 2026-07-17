import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedPrompt,
  finalizeSeedExtraction,
  lookupCatalogItem,
  normalizeBarcode,
  normalizeCatalogItem,
  parseSeedLookupRequest,
  seedExtractionSchema
} from '../api/seed-lookup.js';

test('accepts standard UPC and EAN lengths', () => {
  assert.equal(normalizeBarcode('0 12345-67890 5'), '012345678905');
  assert.equal(normalizeBarcode('1234'), '');
  assert.equal(parseSeedLookupRequest({ barcode: '4002293401102', images: [] }).barcode, '4002293401102');
});

test('normalizes catalog fields without carrying offers', () => {
  assert.deepEqual(normalizeCatalogItem({
    ean: '012345678905',
    title: 'Roma Tomato Seeds',
    brand: 'Example Seeds',
    category: 'Garden',
    description: 'Packet of tomato seed',
    offers: [{ merchant: 'ignored' }]
  }), {
    ean: '012345678905',
    title: 'Roma Tomato Seeds',
    brand: 'Example Seeds',
    category: 'Garden',
    description: 'Packet of tomato seed'
  });
});

test('reads the first exact catalog result', async () => {
  const item = await lookupCatalogItem('012345678905', async () => new Response(JSON.stringify({
    items: [{ ean: '012345678905', title: 'Basil Seeds', brand: 'Example' }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(item.title, 'Basil Seeds');
});

test('prompt distinguishes catalog evidence from barcode digits', () => {
  const prompt = buildSeedPrompt({
    barcode: '012345678905',
    catalog: null,
    imageCount: 2
  });
  assert.match(prompt, /Do not claim a barcode identifies a product/i);
  assert.match(prompt, /Packet photos supplied: 2/);
  assert.match(prompt, /Return water, feed, and harvest as null/);
});

test('normalizes identity and removes model-proposed cadences', () => {
  const result = finalizeSeedExtraction({
    name: 'Tomato',
    kind: 'Tomato (seed packet)',
    variety: 'Best Boy Hybrid',
    brand: '',
    water: { count: 14, unit: 'day', reason: 'Model guess' },
    feed: null,
    harvest: null
  }, { brand: 'Burpee' });
  assert.equal(result.name, 'Best Boy Hybrid Tomato');
  assert.equal(result.kind, 'Tomato');
  assert.equal(result.brand, 'Burpee');
  assert.equal(result.water, null);
});

test('canonicalizes catalog-backed plant types', () => {
  const result = finalizeSeedExtraction({
    name: 'Tomato',
    kind: 'Fruit tomato',
    variety: 'Best Boy Hybrid',
    brand: 'Burpee',
    water: null,
    feed: null,
    harvest: null
  }, { title: 'Burpee Tomato Best Boy Hybrid Seed Packet' });
  assert.equal(result.name, 'Best Boy Hybrid Tomato');
  assert.equal(result.kind, 'Tomato');
});

test('validates a structured seed extraction', () => {
  const parsed = seedExtractionSchema.parse({
    isSeedPackage: true,
    name: 'Roma Tomato',
    kind: 'Tomato',
    variety: 'Roma',
    brand: 'Example Seeds',
    sun: 'Full sun',
    water: { count: 2, unit: 'day', reason: 'Check container soil regularly.' },
    feed: null,
    harvest: { count: 2, unit: 'day', reason: 'Check ripe fruit often.' },
    harvestCue: 'Pick when fully red',
    plantingDepth: '1/4 inch',
    spacing: '18 inches',
    daysToMaturity: '75 days',
    notes: ['Start indoors before last frost.'],
    confidence: 'high',
    cautions: []
  });
  assert.equal(parsed.variety, 'Roma');
});
