'use strict';

const config = require('../config');
const openai = require('./openai');
const anthropic = require('./anthropic');
const gemini = require('./gemini');

const REGISTRY = {
  openai,
  anthropic,
  gemini,
};

// OpenAI-compatible providers reuse openai adapter
const OPENAI_COMPATIBLE_NAMES = openai.compatible || new Set();
for (const name of OPENAI_COMPATIBLE_NAMES) {
  if (!REGISTRY[name]) REGISTRY[name] = openai;
}

function resolve(name) {
  const key = (name || config.defaultProvider || 'openai').toLowerCase();
  return REGISTRY[key] || openai;
}

function list() {
  return Object.keys(REGISTRY).map((name) => ({
    name,
    configured: Boolean(
      (config.providers[name] && config.providers[name].apiKey) ||
      name === 'ollama'
    ),
    openaiCompatible: name === 'openai' ? true : (REGISTRY[name] === openai),
  }));
}

module.exports = { resolve, list, REGISTRY };
