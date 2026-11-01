'use strict';

const config = require('../config');
const tokenizer = require('./tokenizer');

/**
 * Fidel Normalizer
 * Normalizes Ethiopic (Amharic / Afaan Oromoo / Tigrinya) text by:
 *  - standardizing phonetic homophones to a single canonical form
 *  - stripping zero-width / non-standard spacing artifacts
 *  - collapsing duplicate punctuation and redundant whitespace
 *
 * This reduces the number of distinct characters the tokenizer has to handle,
 * improving subword packing and lowering token counts for upstream LLMs.
 */

// Canonical homophone mapping. Keys are non-canonical variants, values are canonical.
const HOMOPHONE_MAP = {
  // ሀ family
  'ሐ': 'ሀ', 'ኀ': 'ሀ',
  'ሑ': 'ሁ', 'ኁ': 'ሁ',
  'ሒ': 'ሂ', 'ኂ': 'ሂ',
  'ሓ': 'ሃ', 'ኃ': 'ሃ',
  'ሔ': 'ሄ', 'ኄ': 'ሄ',
  'ሕ': 'ህ', 'ኅ': 'ህ',
  'ሖ': 'ሆ', 'ኆ': 'ሆ',
  // ሰ family (ሠ -> ሰ)
  'ሠ': 'ሰ', 'ሡ': 'ሱ', 'ሢ': 'ሲ', 'ሣ': 'ሳ', 'ሤ': 'ሴ', 'ሥ': 'ስ', 'ሦ': 'ሶ',
  // ጸ family (ፀ -> ጸ)
  'ፀ': 'ጸ', 'ፁ': 'ጹ', 'ፂ': 'ጺ', 'ፃ': 'ጻ', 'ፄ': 'ጼ', 'ፅ': 'ጽ', 'ፆ': 'ጾ',
  // አ family (ዐ -> አ)
  'ዐ': 'አ', 'ዑ': 'ኡ', 'ዒ': 'ኢ', 'ዓ': 'አ', 'ዔ': 'ኤ', 'ዕ': 'እ', 'ዖ': 'ኦ',
  // ኀ-class archaic (ኈ ኊ ኌ ኍ)
  'ኈ': 'ኀ', 'ኊ': 'ኂ', 'ኌ': 'ኃ', 'ኍ': 'ኅ',
};

// Ethiopic numerals -> ASCII digits (optional, aggressive mode)
const NUMERAL_MAP = {
  '፩': '1', '፪': '2', '፫': '3', '፬': '4', '፭': '5',
  '፮': '6', '፯': '7', '፰': '8', '፱': '9', '፲': '10',
  '፳': '20', '፴': '30', '፵': '40', '፶': '50', '፷': '60',
  '፸': '70', '፹': '80', '፺': '90', '፻': '100', '፼': '10000',
};

// Ethiopic punctuation -> ASCII (optional, aggressive mode)
const PUNCT_MAP = {
  '።': '.', '፣': ',', '፤': ';', '፥': ':', '፦': ':',
  '፧': '?', '፨': '/',
};

// Characters to strip entirely (zero-width & non-standard spacing artifacts)
const STRIP_CHARS = new Set([
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\u2060', // word joiner
  '\uFEFF', // BOM / zero-width no-break space
  '\u00AD', // soft hyphen
  '\u180E', // mongolian vowel separator
]);

// Punctuation that should not be duplicated
const PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', '(', ')', '[', ']', '{', '}', '"', "'", '«', '»', '፣', '፤', '፥', '፦', '፧', '፨', '፡']);

/**
 * Normalize a single text string.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (typeof text !== 'string' || text.length === 0) return text || '';

  // Unicode NFC normalization (combine decomposed sequences)
  let input = text.normalize('NFC');

  // Build combined mapping for this pass
  const combined = Object.assign({}, HOMOPHONE_MAP);
  if (config.aggressiveNormalize) {
    Object.assign(combined, NUMERAL_MAP, PUNCT_MAP);
  }

  // Strip zero-width chars first
  let out = input.replace(new RegExp([...STRIP_CHARS].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), '');

  // Apply homophone/numeral/punct mapping in a single pass
  const keys = Object.keys(combined).sort((a, b) => b.length - a.length);
  if (keys.length) {
    const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    out = out.replace(re, (m) => combined[m]);
  }

  // Collapse runs of identical punctuation to a single character (keep up to 3 dots for ellipsis)
  out = out.replace(/([.!?;:,])\1{1,}/g, '$1');
  out = out.replace(/\.{4,}/g, '...');

  // Normalize whitespace
  out = out.replace(/\r\n/g, '\n');
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/ +\n/g, '\n');
  out = out.trim();

  return out;
}

/**
 * Estimate token count for a string using the shared BPE tokenizer.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return tokenizer.countTokens(text);
}

/**
 * Normalize Amharic/Ethiopic text and report savings.
 * @param {string} text
 * @returns {{ normalizedText: string, savingsPercentage: number, originalTokens: number, normalizedTokens: number }}
 */
// Simple LRU-ish memoization for normalizeAmharic
const _normCache = new Map();
const NORM_CACHE_MAX = 500;

function normalizeAmharic(text) {
  if (typeof text !== 'string') {
    return { normalizedText: text, savingsPercentage: 0, originalTokens: 0, normalizedTokens: 0 };
  }
  if (_normCache.has(text)) {
    const v = _normCache.get(text);
    _normCache.delete(text);
    _normCache.set(text, v);
    return v;
  }
  const original = text;
  const normalizedText = normalizeText(text);
  const originalTokens = estimateTokens(original);
  const normalizedTokens = estimateTokens(normalizedText);
  let savingsPercentage = 0;
  if (originalTokens > 0) {
    savingsPercentage = Math.max(0, Math.min(100, ((originalTokens - normalizedTokens) / originalTokens) * 100));
  }
  // If no token reduction but char reduction, reflect char reduction as floor
  if (savingsPercentage === 0 && original.length > normalizedText.length && original.length > 0) {
    savingsPercentage = Math.max(0, Math.min(100, ((original.length - normalizedText.length) / original.length) * 100));
  }
  const ethiopicCount = (text.match(/[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/g) || []).length;
  const result = {
    normalizedText,
    savingsPercentage: Math.round(savingsPercentage * 100) / 100,
    originalTokens,
    normalizedTokens,
    script: ethiopicCount / Math.max(1, text.length) > 0.3 ? 'ethiopic' : 'latin-or-mixed',
    ethiopicRatio: Math.round((ethiopicCount / Math.max(1, text.length)) * 100) / 100,
  };
  if (_normCache.size >= NORM_CACHE_MAX) {
    const firstKey = _normCache.keys().next().value;
    _normCache.delete(firstKey);
  }
  _normCache.set(text, result);
  return result;
}

module.exports = {
  normalizeAmharic,
  normalizeText,
  estimateTokens,
  HOMOPHONE_MAP,
};
