'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeAmharic, normalizeText } = require('../src/engine/normalizer');

test('normalizes ሀ family homophones', () => {
  const r = normalizeAmharic('ሐኀ');
  assert.strictEqual(r.normalizedText, 'ሀሀ');
  assert.ok(r.savingsPercentage >= 0);
});

test('normalizes ሠ -> ሰ', () => {
  assert.strictEqual(normalizeAmharic('ሠላም').normalizedText, 'ሰላም');
});

test('normalizes ፀ -> ጸ', () => {
  assert.strictEqual(normalizeAmharic('ፀሐይ').normalizedText, 'ጸሀይ');
});

test('normalizes ዐ -> አ', () => {
  assert.strictEqual(normalizeAmharic('ዐማርኛ').normalizedText, 'አማርኛ');
});

test('strips zero-width non-joiner', () => {
  const input = 'ሀ\u200Cሃ';
  assert.strictEqual(normalizeAmharic(input).normalizedText, 'ሀሃ');
});

test('collapses duplicate punctuation', () => {
  assert.strictEqual(normalizeAmharic('ሰላም!!!').normalizedText, 'ሰላም!');
});

test('collapses redundant whitespace', () => {
  assert.strictEqual(normalizeAmharic('ሀ  ሁ   ሂ').normalizedText, 'ሀ ሁ ሂ');
});

test('empty string returns empty', () => {
  const r = normalizeAmharic('');
  assert.strictEqual(r.normalizedText, '');
  assert.strictEqual(r.savingsPercentage, 0);
});

test('non-string input is returned as-is', () => {
  const r = normalizeAmharic(null);
  assert.strictEqual(r.normalizedText, null);
});

test('savingsPercentage is between 0 and 100', () => {
  const r = normalizeAmharic('ሐኀሠፀዐ');
  assert.ok(r.savingsPercentage >= 0 && r.savingsPercentage <= 100);
});

test('normalizeText exported works', () => {
  assert.strictEqual(normalizeText('ሠ'), 'ሰ');
});

test('scenario 1 homophone mappings', () => {
  const n = normalizeAmharic('ፀሐይ በምሥራቅ በምዕራብ የዓለም የሕግ ሐሳባቸውን');
  assert.ok(n.normalizedText.includes('ጸሀይ'));
  assert.ok(n.normalizedText.includes('በምስራቅ'));
  assert.ok(n.normalizedText.includes('በምእራብ'));
  assert.ok(n.normalizedText.includes('የአለም'));
  assert.ok(n.normalizedText.includes('የህግ'));
  assert.ok(n.normalizedText.includes('ሀሳባቸውን'));
});
