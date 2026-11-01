'use strict';

const { normalizeAmharic, estimateTokens } = require('./normalizer');

/**
 * Chunk text into segments of at most maxChars characters, preferring
 * sentence/whitespace boundaries.
 */
function chunkText(text, maxChars = 1500) {
  if (typeof text !== 'string' || text.length <= maxChars) return text ? [text] : [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf('።', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Remove duplicate consecutive lines to reduce token bloat.
 */
function dedupeLines(text) {
  if (typeof text !== 'string') return text;
  const lines = text.split('\n');
  const out = [];
  let prev = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' ) { out.push(line); prev = null; continue; }
    if (trimmed === prev) continue;
    out.push(line);
    prev = trimmed;
  }
  return out.join('\n');
}

/**
 * Compress a text string: normalize + dedupe + trim.
 * Returns { text, originalTokens, compressedTokens, savingsPercentage }
 */
function compressText(text) {
  if (typeof text !== 'string') {
    return { text, originalTokens: 0, compressedTokens: 0, savingsPercentage: 0 };
  }
  const n = normalizeAmharic(text);
  let t = n.normalizedText;
  t = dedupeLines(t);
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  const compressedTokens = estimateTokens(t);
  const savingsPercentage = n.originalTokens > 0
    ? Math.max(0, Math.min(100, ((n.originalTokens - compressedTokens) / n.originalTokens) * 100))
    : 0;
  return {
    text: t,
    originalTokens: n.originalTokens,
    compressedTokens,
    savingsPercentage: Math.round(savingsPercentage * 100) / 100,
  };
}

/**
 * Compress an array of chat messages.
 */
function compressMessages(messages) {
  let rawTokens = 0;
  let compressedTokens = 0;
  const out = (messages || []).map((m) => {
    const msg = { ...m };
    if (typeof m.content === 'string') {
      const c = compressText(m.content);
      rawTokens += c.originalTokens;
      compressedTokens += c.compressedTokens;
      // only compress user/system; keep assistant as-is but count
      if (m.role !== 'user' && m.role !== 'system') {
        rawTokens = rawTokens - c.originalTokens + estimateTokens(m.content);
        compressedTokens = compressedTokens - c.compressedTokens + estimateTokens(m.content);
        msg.content = m.content;
      } else {
        msg.content = c.text;
      }
    } else if (Array.isArray(m.content)) {
      // count text parts
      for (const p of m.content) {
        if (p && typeof p.text === 'string') {
          rawTokens += estimateTokens(p.text);
          compressedTokens += estimateTokens(p.text);
        }
      }
    } else {
      // no content
    }
    return msg;
  });
  return { messages: out, rawTokens, compressedTokens };
}

module.exports = {
  chunkText,
  dedupeLines,
  compressText,
  compressMessages,
  estimateTokens,
};
