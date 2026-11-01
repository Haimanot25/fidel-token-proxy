'use strict';

const config = require('../config');
const settings = require('../engine/settings');
const { processText, estimateTokens } = require('../engine/processor');

function cfg() {
  const env = config.providers.gemini;
  const db = settings.getProviderSettings('gemini');
  return { baseUrl: db.baseUrl || env.baseUrl, apiKey: db.apiKey || env.apiKey };
}

function normalizeParts(parts, role) {
  if (!Array.isArray(parts)) return { parts, raw: 0, compressed: 0 };
  let raw = 0;
  let compressed = 0;
  const out = parts.map((p) => {
    if (p && typeof p === 'object' && typeof p.text === 'string') {
      raw += estimateTokens(p.text);
      if (role === 'user' || role === 'system') {
        const c = processText(p.text, role);
        compressed += estimateTokens(c);
        return { ...p, text: c };
      }
      compressed += estimateTokens(p.text);
      return p;
    }
    return p;
  });
  return { parts: out, raw, compressed };
}

function normalizeRequest(body) {
  const c = { raw: 0, compressed: 0 };
  const newBody = { ...body };

  // systemInstruction
  if (newBody.systemInstruction) {
    const si = newBody.systemInstruction;
    if (si.parts) {
      const r = normalizeParts(si.parts, 'system');
      c.raw += r.raw;
      c.compressed += r.compressed;
      newBody.systemInstruction = { ...si, parts: r.parts };
    } else if (typeof si === 'string') {
      const comp = processText(si, 'system');
      c.raw += estimateTokens(si);
      c.compressed += estimateTokens(comp);
      newBody.systemInstruction = { parts: [{ text: comp }] };
    }
  }

  // contents
  if (Array.isArray(newBody.contents)) {
    newBody.contents = newBody.contents.map((entry) => {
      const role = entry.role === 'model' ? 'assistant' : 'user';
      const e = { role: entry.role };
      if (entry.parts) {
        const r = normalizeParts(entry.parts, role);
        c.raw += r.raw;
        c.compressed += r.compressed;
        e.parts = r.parts;
      }
      return e;
    });
  }

  return { body: newBody, rawTokens: c.raw, compressedTokens: c.compressed };
}

function modelOf(body) {
  return (body && body.model) ? body.model : 'gemini-1.5-flash';
}

function getEndpoint(provider, kind, body) {
  const base = cfg().baseUrl;
  const model = modelOf(body);
  const key = cfg().apiKey;
  const keyParam = key ? `?key=${encodeURIComponent(key)}` : '';
  if (kind === 'stream') {
    return `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse${key ? '&' + 'key=' + encodeURIComponent(key) : ''}`;
  }
  return `${base}/v1beta/models/${model}:generateContent${keyParam}`;
}

function getHeaders(req) {
  const c = cfg();
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers['x-goog-api-key']) headers['x-goog-api-key'] = req.headers['x-goog-api-key'];
  else if (c.apiKey) headers['x-goog-api-key'] = c.apiKey;
  return headers;
}

module.exports = {
  name: 'gemini',
  normalizeRequest,
  getEndpoint,
  getHeaders,
  isOpenAICompatible: false,
};
