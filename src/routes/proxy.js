'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const cache = require('../engine/cache');
const providers = require('../providers');

const inFlight = new Map();

const router = express.Router();

function providerNameFrom(req, paramProvider) {
  return paramProvider || (req.headers['x-provider']) || (req.query && req.query.provider) || config.defaultProvider;
}

function getAdapter(name) {
  return providers.resolve(name);
}

function recordUsage(rawTokens, compressedTokens) {
  if (config.cacheEnabled || config.normalizeEnabled) {
    cache.recordUsage(rawTokens, compressedTokens);
  }
}

async function forward(req, res, name, kind, body, cacheKey) {
  const adapter = getAdapter(name);
  const stream = Boolean(body.stream);
  const endpointKind = stream ? 'stream' : kind;

  // getEndpoint signatures vary; call with (name, kind, body) if supported
  let url;
  if (adapter.getEndpoint.length >= 3) {
    url = adapter.getEndpoint(name, endpointKind, body);
  } else {
    url = adapter.getEndpoint(name, endpointKind);
  }

  // getHeaders signatures vary
  let headers;
  if (adapter.getHeaders.length >= 2) {
    headers = adapter.getHeaders(req, name);
  } else {
    headers = adapter.getHeaders(req);
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return res.status(502).json({ error: { message: `Upstream request failed: ${err.message}`, type: 'upstream_error' } });
  }

  if (stream) {
    res.status(response.status);
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) {
        res.setHeader(key, value);
      }
    });
    if (!response.ok) {
      const text = await response.text();
      res.send(text);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      if (!response.body) { res.end(); return resolve(); }
      const { Readable } = require('stream');
      const nodeStream = Readable.fromWeb(response.body);
      let accumulated = '';
      nodeStream.on('data', (chunk) => { try { accumulated += chunk.toString(); } catch (_) {} });
      nodeStream.on('error', () => { try { res.end(); } catch (_) {} resolve(); });
      nodeStream.on('end', () => {
        if (cacheKey) {
          try { cache.setResponse(cacheKey, name, body.model, JSON.stringify(body), accumulated, response.status, 300000); } catch (e) { console.error('setResponse stream err', e && e.message); }
        }
        resolve();
      });
      nodeStream.pipe(res);
    });
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  res.status(response.status);
  if (typeof data === 'object') res.json(data);
  else res.send(data);
}

function cacheKey(name, kind, body) {
  return crypto.createHash('sha256').update(`${name}:${kind}:${JSON.stringify(body)}`).digest('hex');
}

function getAdapterEndpoint(adapter, name, kind, body) {
  return adapter.getEndpoint.length >= 3
    ? adapter.getEndpoint(name, kind, body)
    : adapter.getEndpoint(name, kind);
}

function getAdapterHeaders(adapter, req, name) {
  return adapter.getHeaders.length >= 2
    ? adapter.getHeaders(req, name)
    : adapter.getHeaders(req);
}

// ---------- chat completions ----------

async function handleChat(req, res, name) {
  const start = Date.now();
  let cacheHit = false;
  let reqModel = (req.body && req.body.model) || '';
  try {
    const adapter = getAdapter(name);
    const body = { ...req.body };
    const { body: newBody, rawTokens, compressedTokens } = adapter.normalizeRequest
      ? adapter.normalizeRequest(body)
      : { body, rawTokens: 0, compressedTokens: 0 };
    recordUsage(rawTokens, compressedTokens);
    reqModel = (newBody && newBody.model) || reqModel;

    const stream = Boolean(newBody.stream);
    const key = cacheKey(name, 'chat', newBody);

    // Response cache (non-stream)
    if (!stream) {
      const cached = cache.getResponse(key);
      if (cached) {
        cacheHit = true;
        res.status(cached.status);
        try { return res.json(JSON.parse(cached.response)); }
        catch (_) { return res.send(cached.response); }
      }
    }

    // Request coalescing
    if (!stream && inFlight.has(key)) {
      const result = await inFlight.get(key);
      cacheHit = true;
      res.status(result.status);
      try { return res.json(JSON.parse(result.text)); }
      catch (_) { return res.send(result.text); }
    }

    if (stream) {
      const cached = cache.getResponse(key);
      if (cached) {
        cacheHit = true;
        res.status(cached.status);
        res.setHeader('Content-Type', cached.response.includes('data:') ? 'text/event-stream' : 'application/json');
        res.send(cached.response);
        return;
      }
      await forward(req, res, name, 'chat', newBody, key);
      return;
    }

    const execPromise = (async () => {
      const url = getAdapterEndpoint(adapter, name, 'chat', newBody);
      const headers = getAdapterHeaders(adapter, req, name);
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(newBody) });
      const text = await response.text();
      return { status: response.status, text };
    })();

    inFlight.set(key, execPromise);
    const result = await execPromise;
    inFlight.delete(key);

    if (result.status >= 200 && result.status < 300) {
      try { cache.setResponse(key, name, newBody.model, JSON.stringify(newBody), result.text, result.status, 300000); } catch (e) { console.error('setResponse err', e && e.message); }
    }

    res.status(result.status);
    try { return res.json(JSON.parse(result.text)); }
    catch (_) { return res.send(result.text); }
  } catch (err) {
    res.status(500).json({ error: { message: err.message, type: 'proxy_error' } });
  } finally {
    try { cache.recordRequest(name, reqModel, Date.now() - start, cacheHit); } catch (_) {}
  }
}

async function handleCompletions(req, res, name) {
  const start = Date.now();
  let cacheHit = false;
  let reqModel = (req.body && req.body.model) || '';
  try {
    const adapter = getAdapter(name);
    const body = { ...req.body };
    let resultNorm;
    if (adapter.normalizeCompletionRequest) {
      resultNorm = adapter.normalizeCompletionRequest(body);
    } else if (adapter.normalizeRequest) {
      resultNorm = adapter.normalizeRequest(body);
    } else {
      resultNorm = { body, rawTokens: 0, compressedTokens: 0 };
    }
    recordUsage(resultNorm.rawTokens, resultNorm.compressedTokens);

    const newBody = resultNorm.body;
    reqModel = (newBody && newBody.model) || reqModel;
    const stream = Boolean(newBody.stream);
    const key = cacheKey(name, 'completions', newBody);

    if (!stream) {
      const cached = cache.getResponse(key);
      if (cached) {
        cacheHit = true;
        res.status(cached.status);
        try { return res.json(JSON.parse(cached.response)); }
        catch (_) { return res.send(cached.response); }
      }
    }

    if (!stream && inFlight.has(key)) {
      const result = await inFlight.get(key);
      cacheHit = true;
      res.status(result.status);
      try { return res.json(JSON.parse(result.text)); }
      catch (_) { return res.send(result.text); }
    }

    if (stream) {
      const cached = cache.getResponse(key);
      if (cached) {
        cacheHit = true;
        res.status(cached.status);
        res.setHeader('Content-Type', cached.response.includes('data:') ? 'text/event-stream' : 'application/json');
        res.send(cached.response);
        return;
      }
      await forward(req, res, name, 'completions', newBody, key);
      return;
    }

    const execPromise = (async () => {
      const url = getAdapterEndpoint(adapter, name, 'completions', newBody);
      const headers = getAdapterHeaders(adapter, req, name);
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(newBody) });
      const text = await response.text();
      return { status: response.status, text };
    })();

    inFlight.set(key, execPromise);
    const result = await execPromise;
    inFlight.delete(key);

    if (result.status >= 200 && result.status < 300) {
      try { cache.setResponse(key, name, newBody.model, JSON.stringify(newBody), result.text, result.status, 300000); } catch (e) { console.error('setResponse err', e && e.message); }
    }

    res.status(result.status);
    try { return res.json(JSON.parse(result.text)); }
    catch (_) { return res.send(result.text); }
  } catch (err) {
    res.status(500).json({ error: { message: err.message, type: 'proxy_error' } });
  } finally {
    try { cache.recordRequest(name, reqModel, Date.now() - start, cacheHit); } catch (_) {}
  }
}

// default provider routes
router.post('/chat/completions', (req, res) => handleChat(req, res, providerNameFrom(req)));
router.post('/completions', (req, res) => handleCompletions(req, res, providerNameFrom(req)));

// explicit provider routes
router.post('/providers/:provider/chat/completions', (req, res) => handleChat(req, res, req.params.provider));
router.post('/providers/:provider/completions', (req, res) => handleCompletions(req, res, req.params.provider));

module.exports = router;
