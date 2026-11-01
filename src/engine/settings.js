'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Reuse the same database file as cache.js
const dbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.resolve(__dirname, '..', '..', config.dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) {}

db.exec(`
CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY,
  api_key TEXT,
  base_url TEXT,
  default_model TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_models (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  PRIMARY KEY (provider, model_id)
);
CREATE TABLE IF NOT EXISTS model_fetch_meta (
  provider TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

function envCfg(provider) {
  return (config.providers && config.providers[provider]) || {};
}

function getProviderSettings(provider) {
  const name = String(provider).toLowerCase();
  const row = db.prepare('SELECT * FROM provider_settings WHERE provider = ?').get(name);
  const env = envCfg(name);
  return {
    provider: name,
    apiKey: (row && row.api_key) || env.apiKey || '',
    baseUrl: (row && row.base_url) || env.baseUrl || '',
    defaultModel: (row && row.default_model) || env.defaultModel || '',
    updatedAt: row ? row.updated_at : null,
    hasDbOverride: !!row,
  };
}

function setProviderSettings(provider, { apiKey, baseUrl, defaultModel } = {}) {
  const name = String(provider).toLowerCase();
  const existing = db.prepare('SELECT * FROM provider_settings WHERE provider = ?').get(name);
  const now = Date.now();
  const key = apiKey !== undefined ? apiKey : (existing ? existing.api_key : null);
  const url = baseUrl !== undefined ? baseUrl : (existing ? existing.base_url : null);
  const model = defaultModel !== undefined ? defaultModel : (existing ? existing.default_model : null);
  db.prepare(
    `INSERT INTO provider_settings (provider, api_key, base_url, default_model, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       api_key=excluded.api_key,
       base_url=excluded.base_url,
       default_model=excluded.default_model,
       updated_at=excluded.updated_at`
  ).run(name, key, url, model, now);
  return getProviderSettings(name);
}

function getAllProviderSettings() {
  const names = Object.keys(config.providers || {});
  // include any db-only providers
  const dbNames = db.prepare('SELECT provider FROM provider_settings').all().map((r) => r.provider);
  const set = new Set([...names, ...dbNames]);
  return [...set].map(getProviderSettings);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(key, String(value), Date.now());
}

function getModels(provider) {
  const name = String(provider).toLowerCase();
  const rows = db.prepare('SELECT model_id FROM provider_models WHERE provider = ?').all(name);
  return rows.map((r) => r.model_id);
}

function saveModels(provider, models) {
  const name = String(provider).toLowerCase();
  db.prepare('DELETE FROM provider_models WHERE provider = ?').run(name);
  const stmt = db.prepare('INSERT OR IGNORE INTO provider_models (provider, model_id) VALUES (?, ?)');
  for (const m of models || []) {
    if (m) stmt.run(name, String(m));
  }
  db.prepare(
    `INSERT INTO model_fetch_meta (provider, fetched_at) VALUES (?, ?)
     ON CONFLICT(provider) DO UPDATE SET fetched_at=excluded.fetched_at`
  ).run(name, Date.now());
}

function getModelFetchMeta(provider) {
  const name = String(provider).toLowerCase();
  const row = db.prepare('SELECT fetched_at FROM model_fetch_meta WHERE provider = ?').get(name);
  return row ? row.fetched_at : null;
}

function listTemplates() {
  return db.prepare('SELECT * FROM prompt_templates ORDER BY created_at DESC').all();
}
function createTemplate(name, content) {
  const info = db.prepare('INSERT INTO prompt_templates (name, content, created_at) VALUES (?, ?, ?)').run(name, content, Date.now());
  return db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(info.lastInsertRowid);
}
function deleteTemplate(id) {
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = {
  getProviderSettings,
  setProviderSettings,
  getAllProviderSettings,
  getSetting,
  setSetting,
  getModels,
  saveModels,
  getModelFetchMeta,
  listTemplates,
  createTemplate,
  deleteTemplate,
};
