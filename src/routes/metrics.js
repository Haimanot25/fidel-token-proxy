'use strict';

const express = require('express');
const cache = require('../engine/cache');
const settings = require('../engine/settings');
const providers = require('../providers');
const config = require('../config');
const { normalizeAmharic } = require('../engine/normalizer');
const tokenizer = require('../engine/tokenizer');

const router = express.Router();

router.get('/stats', (req, res) => {
  try { res.json(cache.getStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/stats/reset', (req, res) => {
  try { cache.resetStats(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/providers', (req, res) => {
  const list = providers.list().map((p) => {
    const s = settings.getProviderSettings(p.name);
    return {
      ...p,
      configured: Boolean(s.apiKey) || p.name === 'ollama',
      defaultModel: s.defaultModel || null,
      baseUrl: s.baseUrl,
      modelsCached: settings.getModels(p.name).length,
    };
  });
  res.json({ providers: list, default: config.defaultProvider });
});

router.get('/providers/:provider/models', async (req, res) => {
  const name = req.params.provider.toLowerCase();
  const refresh = req.query.refresh === '1';
  try {
    let models = settings.getModels(name);
    const meta = settings.getModelFetchMeta(name);
    const stale = !meta || (Date.now() - meta > 1000 * 60 * 60); // 1h
    if (refresh || models.length === 0 || stale) {
      const fetched = await fetchModels(name);
      if (fetched && fetched.length) {
        settings.saveModels(name, fetched);
        models = fetched;
      }
    }
    const cfg = settings.getProviderSettings(name);
    res.json({ provider: name, models, defaultModel: cfg.defaultModel });
  } catch (err) {
    res.status(500).json({ error: err.message, models: settings.getModels(name) });
  }
});

async function fetchModels(name) {
  const cfg = settings.getProviderSettings(name);
  if (name === 'anthropic') {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }
  if (name === 'gemini') {
    const url = `${cfg.baseUrl}/v1beta/models${cfg.apiKey ? '?key=' + encodeURIComponent(cfg.apiKey) : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Gemini models fetch failed: ${r.status}`);
    const j = await r.json();
    return (j.models || []).map((m) => (m.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  // OpenAI-compatible
  const url = `${cfg.baseUrl}/models`;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${name} models fetch failed: ${r.status}`);
  const j = await r.json();
  const data = j.data || j.models || [];
  return data.map((m) => m.id || m.name).filter(Boolean);
}

router.post('/providers/:provider/settings', (req, res) => {
  try {
    const name = req.params.provider.toLowerCase();
    const { apiKey, baseUrl, defaultModel } = req.body || {};
    const updated = settings.setProviderSettings(name, { apiKey, baseUrl, defaultModel });
    res.json({ ok: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', (req, res) => {
  try {
    const all = settings.getAllProviderSettings();
    res.json({ providers: all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/normalize', (req, res) => {
  try {
    const text = (req.body && (req.body.text || req.body.input)) || '';
    res.json(normalizeAmharic(String(text)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export metrics as CSV
router.get('/stats/export', (req, res) => {
  try {
    const s = cache.getStats();
    const csv = [
      'metric,value',
      `total_requests,${s.total_requests}`,
      `total_raw_tokens,${s.total_raw_tokens}`,
      `total_compressed_tokens,${s.total_compressed_tokens}`,
      `tokens_saved,${s.tokens_saved}`,
      `estimated_usd_saved,${s.estimated_usd_saved}`,
      `compression_ratio_percent,${s.compression_ratio_percent}`,
      `cached_system_prompts,${s.cached_system_prompts}`,
      `cache_hits,${s.cache_hits}`,
    ].join('\\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fidel-stats.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upstream health checks
router.get('/health/upstreams', async (req, res) => {
  const out = [];
  for (const p of providers.list()) {
    const cfg = settings.getProviderSettings(p.name);
    let status = 'unknown';
    let latency = null;
    if (p.name === 'ollama') {
      // try base
      const start = Date.now();
      try {
        const r = await fetch((cfg.baseUrl || '').replace(/\/v1$/, '') + '/api/tags');
        status = r.ok ? 'ok' : `http_${r.status}`;
      } catch (e) { status = 'error'; }
      latency = Date.now() - start;
    } else if (cfg.apiKey) {
      const start = Date.now();
      try {
        const r = await fetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
        status = r.ok ? 'ok' : `http_${r.status}`;
      } catch (e) { status = 'error'; }
      latency = Date.now() - start;
    } else {
      status = 'unconfigured';
    }
    out.push({ provider: p.name, status, latency_ms: latency });
  }
  res.json({ upstreams: out });
});

// Prompt templates
router.get('/templates', (req, res) => {
  try { res.json({ templates: settings.listTemplates() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/templates', (req, res) => {
  try {
    const { name, content } = req.body || {};
    if (!name || !content) return res.status(400).json({ error: 'name and content required' });
    res.json(settings.createTemplate(name, content));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/templates/:id', (req, res) => {
  try { res.json(settings.deleteTemplate(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tokenize', (req, res) => {
  try {
    const text = (req.body && (req.body.text || req.body.input)) || '';
    res.json({ tokens: tokenizer.countTokens(String(text)), info: tokenizer.info() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tokenizer', (req, res) => {
  res.json(tokenizer.info());
});

// Admin: cache hit/miss ratio
router.get('/cache-stats', (req, res) => {
  try { res.json(cache.getCacheHitRatio()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: latency percentiles
router.get('/latency', (req, res) => {
  try { res.json(cache.getLatencyStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: list cached responses (searchable)
router.get('/cached-responses', (req, res) => {
  try {
    const search = req.query.search || '';
    const limit = req.query.limit || 50;
    res.json({ items: cache.listCachedResponses(search, limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: invalidate one cached response
router.delete('/cached-responses/:hash', (req, res) => {
  try { res.json(cache.invalidateCachedResponse(req.params.hash)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: invalidate all cached responses
router.delete('/cached-responses', (req, res) => {
  try { res.json(cache.invalidateAllCachedResponses()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
