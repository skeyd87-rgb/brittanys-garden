import test from 'node:test';
import assert from 'node:assert/strict';
import { adviceSchema, buildGardenPrompt, parseGardenRequest } from '../api/garden-advice.js';

const request = {
  today: '2026-07-16',
  plant: {
    name: 'Patio Tomato',
    kind: 'Tomato',
    seedCode: '012345678905',
    planter: 'Patio pot',
    status: 'happy',
    water: 'Every 3 days',
    feed: 'Every 2 weeks',
    harvestCue: 'Pick when red',
    notes: ''
  },
  garden: {
    name: 'My Garden',
    location: 'Pittsburgh, PA, US',
    latitude: 40.44,
    longitude: -79.99
  },
  weather: null,
  guide: ['Guide match: Tomato.'],
  question: '',
  history: []
};

test('accepts bounded garden context', () => {
  assert.equal(parseGardenRequest(request).plant.kind, 'Tomato');
});

test('rejects unsupported status values', () => {
  assert.throws(() => parseGardenRequest({
    ...request,
    plant: { ...request.plant, status: 'dead' }
  }));
});

test('warns the model not to infer a product from a numeric barcode', () => {
  assert.match(buildGardenPrompt(request), /only a numeric barcode/i);
  assert.match(buildGardenPrompt(request), /Do not identify a product/i);
});

test('validates structured advice', () => {
  const parsed = adviceSchema.parse({
    advice: 'Check the top inch of soil before watering.',
    suggestions: {
      water: { count: 3, unit: 'day', reason: 'Container tomatoes need regular checks.' },
      feed: null,
      harvest: { count: 2, unit: 'day', reason: 'Check fruit color often.' },
      sun: 'Full sun',
      harvestCue: 'Pick when fully colored and slightly firm'
    },
    confidence: 'medium',
    cautions: ['Adjust watering after rain.']
  });
  assert.equal(parsed.suggestions.water.count, 3);
});

test('includes the current question and recent conversation', () => {
  const prompt = buildGardenPrompt({
    ...request,
    question: 'Why are the lower leaves yellow?',
    history: [{ role: 'assistant', content: 'Check the soil before watering.' }]
  });
  assert.match(prompt, /Why are the lower leaves yellow/);
  assert.match(prompt, /Check the soil before watering/);
  assert.match(prompt, /Answer that question directly/);
});

test('allows a conversational answer without schedule changes', () => {
  const parsed = adviceSchema.parse({
    advice: 'A few older lower leaves can yellow naturally.',
    suggestions: null,
    confidence: 'medium',
    cautions: []
  });
  assert.equal(parsed.suggestions, null);
});
