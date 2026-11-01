'use strict';

const config = require('../config');
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || '0', 10); // 0 = disabled
const { estimateTokens } = require('./normalizer');
const compressor = require('./compressor');
const cache = require('./cache');

/**
 * Process a single text string: normalize + cache (for system prompts).
 * Returns compressed text.
 */
function processText(text, role) {
  const raw = text || '';
  const isCompressible = role === 'user' || role === 'system';
  if (!isCompressible || !config.normalizeEnabled) return raw;

  if (role === 'system' && config.cacheEnabled) {
    const cached = cache.getSystemPrompt(raw);
    if (cached.hit && cached.normalized) {
      return cached.normalized;
    }
    const c = compressor.compressText(raw);
    cache.setSystemPrompt(raw, c.text);
    return c.text;
  }
  const c = compressor.compressText(raw);
  return c.text;
}

/**
 * Process an array of OpenAI-style messages.
 */
function processOpenAIMessages(messages) {
  const counters = { raw: 0, compressed: 0 };
  // Dedup adjacent identical messages
  const deduped = [];
  for (const m of (messages || [])) {
    const last = deduped[deduped.length - 1];
    if (last && last.role === m.role && JSON.stringify(last.content) === JSON.stringify(m.content)) continue;
    deduped.push(m);
  }

  // Token-budget trimming: drop oldest non-system turns until within budget
  let trimmed = deduped;
  if (MAX_CONTEXT_TOKENS > 0) {
    const sys = deduped.filter((m) => m.role === 'system');
    const rest = deduped.filter((m) => m.role !== 'system');
    let total = sys.reduce((a, m) => a + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);
    const kept = [];
    // keep from newest backwards
    for (let i = rest.length - 1; i >= 0; i--) {
      const t = estimateTokens(typeof rest[i].content === 'string' ? rest[i].content : JSON.stringify(rest[i].content));
      if (total + t > MAX_CONTEXT_TOKENS && kept.length > 0) break;
      kept.unshift(rest[i]);
      total += t;
    }
    trimmed = [...sys, ...kept];
    // preserve original order: system first then kept in order
    trimmed = deduped.filter((m) => sys.includes(m) || kept.includes(m));
  }

  const out = trimmed.map((m) => {
    const role = m && m.role;
    // Keep only OpenAI-standard fields to avoid leaking UI-only props (e.g. streaming)
    const newMsg = { role: m.role };
    if (m.name) newMsg.name = m.name;
    if (m.tool_calls) newMsg.tool_calls = m.tool_calls;
    if (m.tool_call_id) newMsg.tool_call_id = m.tool_call_id;
    if (m.function_call) newMsg.function_call = m.function_call;
    if (m.refusal) newMsg.refusal = m.refusal;
    if (m && typeof m.content === 'string') {
      const raw = m.content;
      const compressed = processText(raw, role); // returns raw for non-compressible roles
      counters.raw += estimateTokens(raw);
      counters.compressed += estimateTokens(compressed);
      newMsg.content = compressed;
    } else if (m && Array.isArray(m.content)) {
      newMsg.content = m.content.map((part) => {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          const raw = part.text;
          const compressed = processText(raw, role);
          counters.raw += estimateTokens(raw);
          counters.compressed += estimateTokens(compressed);
          return { ...part, text: compressed };
        }
        return part;
      });
    }
    return newMsg;
  });
  return { messages: out, rawTokens: counters.raw, compressedTokens: counters.compressed };
}

module.exports = { processText, processOpenAIMessages, estimateTokens };
