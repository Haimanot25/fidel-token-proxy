'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const dbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.resolve(__dirname, '..', '..', config.dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) {}

db.exec(`
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_raw_tokens INTEGER NOT NULL DEFAULT 0,
  total_compressed_tokens INTEGER NOT NULL DEFAULT 0,
  tokens_saved INTEGER NOT NULL DEFAULT 0,
  estimated_usd_saved REAL NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO metrics (id) VALUES (1);

CREATE TABLE IF NOT EXISTS system_cache (
  hash TEXT PRIMARY KEY,
  original TEXT NOT NULL,
  normalized TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS response_cache (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  request TEXT,
  response TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 200,
  created_at INTEGER NOT NULL,
  ttl INTEGER NOT NULL DEFAULT 300000
);

CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function getSystemPrompt(text) {
  const h = hashText(text);
  const row = db.prepare('SELECT hash, normalized, hits FROM system_cache WHERE hash = ?').get(h);
  if (row) {
    db.prepare('UPDATE system_cache SET hits = hits + 1 WHERE hash = ?').run(h);
    return { hash: h, hit: true, normalized: row.normalized };
  }
  return { hash: h, hit: false, normalized: null };
}

function setSystemPrompt(original, normalized) {
  const h = hashText(original);
  db.prepare(
    'INSERT OR REPLACE INTO system_cache (hash, original, normalized, hits, created_at) VALUES (?, ?, ?, COALESCE((SELECT hits FROM system_cache WHERE hash = ?), 0), ?)'
  ).run(h, original, normalized, h, Date.now());
  return h;
}

function recordUsage(rawTokens, compressedTokens) {
  const r = Math.max(0, parseInt(rawTokens, 10) || 0);
  const c = Math.max(0, parseInt(compressedTokens, 10) || 0);
  const saved = Math.max(0, r - c);
  const usdSaved = saved * (config.inputCostPer1k / 1000);
  db.prepare(
    `UPDATE metrics SET
      total_requests = total_requests + 1,
      total_raw_tokens = total_raw_tokens + ?,
      total_compressed_tokens = total_compressed_tokens + ?,
      tokens_saved = tokens_saved + ?,
      estimated_usd_saved = estimated_usd_saved + ?
     WHERE id = 1`
  ).run(r, c, saved, usdSaved);
}

function getStats() {
  const m = db.prepare('SELECT * FROM metrics WHERE id = 1').get();
  const cacheCount = db.prepare('SELECT COUNT(*) AS c FROM system_cache').get().c;
  const totalHits = db.prepare('SELECT COALESCE(SUM(hits), 0) AS h FROM system_cache').get().h;
  const ratio = m.total_raw_tokens > 0 ? (m.tokens_saved / m.total_raw_tokens) * 100 : 0;
  return {
    total_requests: m.total_requests,
    total_raw_tokens: m.total_raw_tokens,
    total_compressed_tokens: m.total_compressed_tokens,
    tokens_saved: m.tokens_saved,
    estimated_usd_saved: Math.round(m.estimated_usd_saved * 10000) / 10000,
    compression_ratio_percent: Math.round(ratio * 100) / 100,
    cached_system_prompts: cacheCount,
    cache_hits: totalHits,
  };
}

function resetStats() {
  db.prepare('UPDATE metrics SET total_requests=0,total_raw_tokens=0,total_compressed_tokens=0,tokens_saved=0,estimated_usd_saved=0 WHERE id=1').run();
  db.prepare('DELETE FROM system_cache').run();
}

function getResponse(hash) {
  const row = db.prepare('SELECT * FROM response_cache WHERE hash = ?').get(hash);
  if (!row) return null;
  if (Date.now() - row.created_at > row.ttl) {
    db.prepare('DELETE FROM response_cache WHERE hash = ?').run(hash);
    return null;
  }
  return row;
}

function setResponse(hash, provider, model, request, response, status, ttl) {
  db.prepare(
    `INSERT OR REPLACE INTO response_cache (hash, provider, model, request, response, status, created_at, ttl)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(hash, provider, model || '', request || null, response, status || 200, Date.now(), ttl || 300000);
}

function purgeResponses() {
  db.prepare('DELETE FROM response_cache WHERE created_at + ttl < ?').run(Date.now());
}

function recordRequest(provider, model, latencyMs, cacheHit) {
  db.prepare(
    'INSERT INTO request_log (provider, model, latency_ms, cache_hit, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(provider || '', model || '', Math.max(0, parseInt(latencyMs, 10) || 0), cacheHit ? 1 : 0, Date.now());
}

function getLatencyStats() {
  const rows = db.prepare('SELECT latency_ms FROM request_log ORDER BY latency_ms').all();
  const count = rows.length;
  if (count === 0) return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  const vals = rows.map((r) => r.latency_ms);
  const pick = (p) => vals[Math.min(vals.length - 1, Math.floor((p / 100) * vals.length))];
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    count,
    p50: pick(50),
    p95: pick(95),
    p99: pick(99),
    avg: Math.round(sum / count),
    min: vals[0],
    max: vals[vals.length - 1],
  };
}

function getCacheHitRatio() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM request_log').get().c;
  const hits = db.prepare('SELECT COUNT(*) AS c FROM request_log WHERE cache_hit = 1').get().c;
  return { total, hits, misses: total - hits, ratio: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0 };
}

function listCachedResponses(search, limit) {
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  if (search) {
    const like = `%${search}%`;
    return db.prepare(
      'SELECT hash, provider, model, request, response, status, created_at, ttl FROM response_cache WHERE request LIKE ? OR response LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(like, like, lim);
  }
  return db.prepare(
    'SELECT hash, provider, model, request, response, status, created_at, ttl FROM response_cache ORDER BY created_at DESC LIMIT ?'
  ).all(lim);
}

function invalidateCachedResponse(hash) {
  db.prepare('DELETE FROM response_cache WHERE hash = ?').run(hash);
  return { ok: true };
}

function invalidateAllCachedResponses() {
  db.prepare('DELETE FROM response_cache').run();
  return { ok: true };
}

module.exports = {
  getSystemPrompt, setSystemPrompt, recordUsage, getStats, resetStats, hashText,
  getResponse, setResponse, purgeResponses,
  recordRequest, getLatencyStats, getCacheHitRatio,
  listCachedResponses, invalidateCachedResponse, invalidateAllCachedResponses,
};
