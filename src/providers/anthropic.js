'use strict';

const config = require('../config');
const settings = require('../engine/settings');
const { processText, estimateTokens } = require('../engine/processor');

function cfg() {
  const env = config.providers.anthropic;
  const db = settings.getProviderSettings('anthropic');
  return {
    baseUrl: db.baseUrl || env.baseUrl,
    apiKey: db.apiKey || env.apiKey,
    version: env.version,
  };
}

function normalizeContentBlocks(blocks, role) {
  if (typeof blocks === 'string') {
    const c = processText(blocks, role);
    return { content: c, raw: estimateTokens(blocks), compressed: estimateTokens(c) };
  }
  if (!Array.isArray(blocks)) {
    return { content: blocks, raw: 0, compressed: 0 };
  }
  let raw = 0;
  let compressed = 0;
  const out = blocks.map((b) => {
    if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') {
      raw += estimateTokens(b.text);
      if (role === 'user' || role === 'system') {
        const c = processText(b.text, role);
        compressed += estimateTokens(c);
        return { ...b, text: c };
      }
      // assistant: unchanged
      compressed += estimateTokens(b.text);
      return b;
    }
    return b;
  });
  return { content: out, raw, compressed };
}

function normalizeRequest(body) {
  const c = { raw: 0, compressed: 0 };
  const newBody = { ...body };

  // system prompt
  if (newBody.system !== undefined) {
    if (typeof newBody.system === 'string') {
      const comp = processText(newBody.system, 'system');
      c.raw += estimateTokens(newBody.system);
      c.compressed += estimateTokens(comp);
      newBody.system = comp;
    } else if (Array.isArray(newBody.system)) {
      const r = normalizeContentBlocks(newBody.system, 'system');
      c.raw += r.raw;
      c.compressed += r.compressed;
      newBody.system = r.content;
    }
  }

  // messages
  if (Array.isArray(newBody.messages)) {
    newBody.messages = newBody.messages.map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const msg = { role: m.role };
      if (typeof m.content === 'string') {
        const comp = processText(m.content, role);
        c.raw += estimateTokens(m.content);
        c.compressed += estimateTokens(comp);
        msg.content = comp;
      } else if (Array.isArray(m.content)) {
        const r = normalizeContentBlocks(m.content, role);
        c.raw += r.raw;
        c.compressed += r.compressed;
        msg.content = r.content;
      }
      return msg;
    });
  }

  return { body: newBody, rawTokens: c.raw, compressedTokens: c.compressed };
}

function getEndpoint(provider, kind) {
  const base = cfg().baseUrl;
  // Anthropic uses /v1/messages for both chat-style; legacy completions not supported
  return `${base}/v1/messages`;
}

function getHeaders(req) {
  const c = cfg();
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'];
  else if (c.apiKey) headers['x-api-key'] = c.apiKey;
  if (req.headers['anthropic-version']) headers['anthropic-version'] = req.headers['anthropic-version'];
  else headers['anthropic-version'] = c.version;
  if (req.headers.authorization && !headers['x-api-key']) {
    // allow bearer passthrough
    headers['Authorization'] = req.headers.authorization;
  }
  return headers;
}

module.exports = {
  name: 'anthropic',
  normalizeRequest,
  getEndpoint,
  getHeaders,
  isOpenAICompatible: false,
};
