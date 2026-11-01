'use strict';

const config = require('../config');
const settings = require('../engine/settings');
const { processText, processOpenAIMessages } = require('../engine/processor');
const { estimateTokens } = require('../engine/normalizer');

const OPENAI_COMPATIBLE = new Set([
  'openai', 'groq', 'together', 'mistral', 'deepseek', 'ollama', 'openrouter', 'cohere',
]);

function cfg(provider) {
  const p = (provider || 'openai').toLowerCase();
  const env = config.providers[p] || config.providers.openai;
  const db = settings.getProviderSettings(p);
  return { name: p, baseUrl: db.baseUrl || env.baseUrl, apiKey: db.apiKey || env.apiKey };
}

function normalizeRequest(body) {
  const { messages: newMessages, rawTokens, compressedTokens } = processOpenAIMessages(body.messages || []);
  return { body: { ...body, messages: newMessages }, rawTokens, compressedTokens };
}

function normalizeCompletionRequest(body) {
  // OpenAI legacy completions: prompt string/array
  const raw = body.prompt;
  let compressed;
  let rawTokens = 0;
  let compressedTokens = 0;
  if (typeof raw === 'string') {
    compressed = processText(raw, 'user');
    rawTokens = estimateTokens(raw);
    compressedTokens = estimateTokens(compressed);
  } else if (Array.isArray(raw)) {
    compressed = raw.map((p) => (typeof p === 'string' ? processText(p, 'user') : p));
    for (const p of raw) if (typeof p === 'string') rawTokens += estimateTokens(p);
    for (const p of compressed) if (typeof p === 'string') compressedTokens += estimateTokens(p);
  } else {
    compressed = raw;
  }
  return { body: { ...body, prompt: compressed }, rawTokens, compressedTokens };
}

function getEndpoint(provider, kind) {
  const c = cfg(provider);
  const base = c.baseUrl;
  if (kind === 'chat') return `${base}/chat/completions`;
  if (kind === 'completions') return `${base}/completions`;
  return `${base}/chat/completions`;
}

function getHeaders(req, provider) {
  const c = cfg(provider);
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
  else if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`;
  if (req.headers['openai-organization']) headers['OpenAI-Organization'] = req.headers['openai-organization'];
  if (req.headers['openai-project']) headers['OpenAI-Project'] = req.headers['OpenAI-Project'];
  if (req.headers['http-referer']) headers['HTTP-Referer'] = req.headers['http-referer'];
  if (req.headers['x-title']) headers['X-Title'] = req.headers['x-title'];
  return headers;
}

module.exports = {
  name: 'openai',
  compatible: OPENAI_COMPATIBLE,
  normalizeRequest,
  normalizeCompletionRequest,
  getEndpoint,
  getHeaders,
  isOpenAICompatible: true,
};
