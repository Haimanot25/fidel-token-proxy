'use strict';

/**
 * Lightweight BPE token counter.
 * Uses js-tiktoken (cl100k_base) when available, falling back to a
 * character-class heuristic for Ethiopic-heavy text.
 */
let _enc = null;
let _loaded = false;

function load() {
  if (_loaded) return _enc;
  _loaded = true;
  try {
    const { getEncoding } = require('js-tiktoken');
    _enc = getEncoding('cl100k_base');
  } catch (e) {
    _enc = null;
  }
  return _enc;
}

function countTokens(text) {
  if (!text) return 0;
  const enc = load();
  if (enc) {
    try { return enc.encode(String(text)).length; } catch (e) {}
  }
  // Heuristic fallback
  const ethiopic = (String(text).match(/[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/g) || []).length;
  const other = String(text).length - ethiopic;
  return Math.ceil(ethiopic / 2.5 + other / 4);
}

function encode(text) {
  const enc = load();
  if (enc) {
    try { return enc.encode(String(text)); } catch (e) {}
  }
  return null;
}

function decode(tokens) {
  const enc = load();
  if (enc && tokens) {
    try { return enc.decode(tokens); } catch (e) {}
  }
  return null;
}

function info() {
  const enc = load();
  return {
    engine: enc ? 'js-tiktoken (cl100k_base)' : 'heuristic-fallback',
    available: !!enc,
  };
}

module.exports = { countTokens, encode, decode, info };
