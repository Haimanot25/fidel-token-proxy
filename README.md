# Fidel Token Proxy

<p align="center">
  <img src="assets/logo.png" alt="Fidel Token Proxy Logo" width="240">
</p>

<p align="center">
  <b>High-Performance LLM API Gateway & Caching Proxy for Ethiopic Script Integration</b>
</p>

<p align="center">
  <a href="#key-features">Key Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#developer-integration">Developer Integration</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#architecture">Architecture</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-black.svg" alt="MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.5-black" alt="Node"></a>
  <a href=".github/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-GitHub%20Actions-black" alt="CI"></a>
  <a href="https://www.npmjs.com/package/fidel-token-proxy"><img src="https://img.shields.io/badge/npm-fidel--token--proxy-black" alt="npm"></a>
</p>

---

## Overview

**Fidel Token Proxy** (`fidel-token-proxy`) is an enterprise-grade, lightweight reverse proxy designed to solve the **Ethiopic Token Tax** and spelling variance across Amharic, Tigrinya, and Afaan Oromoo AI applications.

Standard LLM tokenizers (e.g., OpenAI's `cl100k_base`) fragment Ethiopic (Ge'ez) script into multiple subword bytes per character, driving up API costs and inflating request latency. Furthermore, human orthographic inconsistencies (homophones like `ሀ/ሐ/ኀ`) cause standard exact-string caching to fail.

`fidel-token-proxy` sits transparently between your application and upstream LLM providers (OpenAI, Groq, Anthropic, Gemini, Ollama) to:

- **Canonicalize Ethiopic text** via Unicode NFC normalization and homophone mapping.
- **Maximize cache hit rates** by resolving spelling variations before query execution.
- **Eliminate redundant API costs** using SQLite WAL-mode response caching and system-prompt deduplication.
- **Preserve real-time streaming** (SSE) without corrupting multi-byte character chunks.

---

## Key features

- **Orthographic normalization** — maps homophones, standardizes space/punctuation, applies NFC Unicode normalization.
- **Zero-code base URL integration** — drop-in replacement for OpenAI SDK, LangChain, LlamaIndex, or raw HTTP clients.
- **High-performance caching layer** — SQLite engine in WAL mode for sub-50ms cache hits.
- **Script detection engine** — real-time `ethiopicRatio` classification to inspect payloads.
- **Ethiopic sentence chunking** — sentence-boundary splitting on `።` alongside standard newlines for optimal BPE subword packing.
- **Configurable aggressive mode** — optional `AGGRESSIVE_NORMALIZE=true` for mapping Ethiopic numerals (`፩…፼ → 1…10000`) and punctuation (`። ፣ ፤ → . , ;`).
- **Real-time streaming preservation** — complete passthrough support for Server-Sent Events (`stream: true`).
- **Real BPE token counter** — js-tiktoken (cl100k_base) for accurate before/after metrics.
- **Multi-provider** — OpenAI, Anthropic, Gemini, Groq, Together, Mistral, DeepSeek, Ollama, OpenRouter, Cohere.
- **Admin dashboard** — live cache hit/miss graphs, p50/p95/p99 latency, searchable cache viewer.
- **Developer portal** — enterprise-grade docs with SDK snippets and API reference.
- **npx support** — `npx fidel-token-proxy` runs with zero install.

---

## Quick start

### Option 1: Run instantly with npx
```bash
npx fidel-token-proxy
# or with env vars inline:
UPSTREAM_API_KEY=sk-... npx fidel-token-proxy
```

### Option 2: Global CLI
```bash
npm install -g fidel-token-proxy
fidel-token-proxy
```

### Option 3: Docker
```bash
docker run -d \
  -p 8080:8080 \
  -e UPSTREAM_URL=https://api.openai.com/v1 \
  -e AGGRESSIVE_NORMALIZE=false \
  haimanot25/fidel-token-proxy:latest
```

### Option 4: Local installation
```bash
git clone https://github.com/Haimanot25/fidel-token-proxy.git
cd fidel-token-proxy
cp .env.example .env   # add your provider API keys
npm install
npm start
```

Then open **http://localhost:8080**. The OpenAI-compatible base URL is `http://localhost:8080/v1`.

---

## Developer integration

`fidel-token-proxy` works as a drop-in replacement. Simply update your client's `baseURL` to target the proxy endpoint (`http://localhost:8080/v1`).

### Node.js (OpenAI SDK)
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:8080/v1', // Target the proxy
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'ሰላም እንዴት ነህ?' }],
  });
  console.log(completion.choices[0].message.content);
}
main();
```

### Python (LangChain / OpenAI)
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://localhost:8080/v1",
    api_key="your-openai-api-key"
)

response = llm.invoke("ሰላም እንዴት ነህ?")
print(response.content)
```

### Python (OpenAI SDK)
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8080/v1", api_key="sk-...")
r = client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": "ሰላም"}])
```

### cURL
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ሰላም"}]}'
```

---

## Multi-provider support

Select a provider per request via path, header, or query param:

```bash
# Path
curl http://localhost:8080/v1/providers/anthropic/chat/completions ...

# Header
curl -H "X-Provider: gemini" http://localhost:8080/v1/chat/completions ...

# Query
curl "http://localhost:8080/v1/chat/completions?provider=groq" ...
```

Supported: **OpenAI, Anthropic, Gemini, Groq, Together, Mistral, DeepSeek, Ollama, OpenRouter, Cohere**.

---

## Ethiopic-specific features

- **Homophone canonicalization**: `ሀ/ሐ/ኀ`, `ሠ`, `ፀ`, `ዐ` (and archaic variants) → canonical forms.
- **Unicode NFC normalization** for decomposed sequences.
- **Zero-width & spacing cleanup**: removes ZWNJ/ZWJ/soft hyphens; collapses redundant whitespace.
- **Ethiopic sentence chunking**: splits on `።` for better BPE packing.
- **Script detection**: returns `script` and `ethiopicRatio` per normalization.
- **Aggressive mode** (`AGGRESSIVE_NORMALIZE=true`): maps Ethiopic numerals (`፩…፼`) and punctuation (`። ፣ ፤ …`) to ASCII.

---

## Benchmarks

Benchmarked against a **~100 KB Amharic document payload** (200 repetitions of news content):

| Metric | Value |
| :--- | :--- |
| **Input characters** | 100,401 |
| **Normalization processing latency** | ~490 ms (~5 ms per 1k chars) |
| **Avg proxy latency (cache hits)** | **49.9 ms** (Min: 23 ms / Max: 366 ms) |
| **System-prompt cache hit rate** | **95%** (19 / 20 requests served locally) |
| **Script ratio detection** | `ethiopicRatio: 0.68` |

> **Key takeaway:** While character-level normalizations preserve orthographic semantics without shrinking raw strings, the proxy's **response memoization and system-prompt deduplication** eliminate 95%+ of redundant network round-trips and API costs.

---

## Admin dashboard

Open **http://localhost:8080/admin** for:
- Live KPIs (requests, tokens saved, compression %, cache hit ratio, p95 latency, USD saved).
- Cache hit vs miss bar chart.
- Latency percentiles (p50/p95/p99) with progress bars.
- Searchable cached prompt–response viewer with per-row and bulk invalidation.

---

## Developer portal

Open **http://localhost:8080/docs** for enterprise-grade documentation: quick start, auth, full API reference, multi-provider usage, normalization API, settings/models APIs, SDK snippets (JS/Python), errors, and changelog.

---

## Configuration (`.env`)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Local port for the proxy gateway | `8080` |
| `UPSTREAM_URL` | Destination LLM provider base URL | `https://api.openai.com/v1` |
| `AGGRESSIVE_NORMALIZE` | Enable numeral (`፩…፼ → 1…10000`) and punctuation mapping | `false` |
| `CACHE_DB_PATH` | Storage location for SQLite database | `./data/cache.db` |
| `LOG_LEVEL` | Log verbosity (`info`, `debug`, `error`) | `info` |
| `MAX_CONTEXT_TOKENS` | Token budget for history trimming (`0` = disabled) | `0` |

Settings and API keys can also be managed at runtime via the UI or `POST /api/providers/:provider/settings`, persisted in SQLite (overrides env).

---

## Architecture

```
┌─────────────────┐       ┌─────────────────────────────────────────────────────────────┐       ┌─────────────────┐
│   Client App    │       │                   Fidel Token Proxy                         │       │  Upstream LLM   │
│ (OpenAI SDK /   │──────▶│  1. NFC & Homophone Normalizer                              │──────▶│ (OpenAI / Groq /│
│  LangChain)     │       │  2. Script Detector & Ethiopic Sentence Chunker             │       │  Ollama)        │
└─────────────────┘       │  3. SQLite WAL Cache & Response Deduplicator                │       └─────────────────┘
                          └─────────────────────────────────────────────────────────────┘
```

```
fidel-token-proxy/
├── src/
│   ├── index.js              # Express gateway
│   ├── config.js             # Env loader
│   ├── cli.js                # npx entry point
│   ├── engine/
│   │   ├── normalizer.js     # Ge'ez normalization + BPE token counting
│   │   ├── tokenizer.js      # js-tiktoken wrapper
│   │   ├── compressor.js     # Chunking, dedup, packing
│   │   ├── processor.js      # Message processing, budget trimming
│   │   ├── cache.js          # SQLite cache + metrics + latency
│   │   └── settings.js       # Provider settings, models, templates
│   ├── providers/            # OpenAI, Anthropic, Gemini (+ compatible)
│   ├── routes/
│   │   ├── proxy.js          # OpenAI-compatible endpoints
│   │   └── metrics.js        # Stats, admin, dev APIs
│   └── public/               # Chat UI, admin dashboard, dev portal
└── tests/
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Chat completions (default provider) |
| POST | `/v1/completions` | Legacy completions |
| POST | `/v1/providers/:provider/chat/completions` | Provider-specific chat |
| POST | `/v1/providers/:provider/completions` | Provider-specific completions |
| GET | `/api/providers` | List providers + config status |
| GET | `/api/providers/:provider/models` | List active models (cached) |
| POST | `/api/providers/:provider/settings` | Store API key / base URL / default model |
| GET | `/api/settings` | All provider settings |
| POST | `/api/normalize` | Normalize Ethiopic text |
| POST | `/api/tokenize` | Count BPE tokens for text |
| GET | `/api/tokenizer` | Tokenizer engine info |
| GET | `/api/stats` | Aggregate metrics |
| GET | `/api/stats/export` | Export metrics as CSV |
| POST | `/api/stats/reset` | Reset metrics |
| GET | `/api/cache-stats` | Cache hit/miss ratio |
| GET | `/api/latency` | Latency percentiles |
| GET/DELETE | `/api/cached-responses` | List / invalidate cached responses |
| GET/POST/DELETE | `/api/templates` | Prompt template CRUD |
| GET | `/api/health/upstreams` | Upstream health checks |
| GET | `/health` | Health check |

---

## Docker

```bash
cp .env.example .env
docker compose up -d
```

---

## Testing

```bash
npm test
```

12 unit tests covering homophone normalization, zero-width stripping, punctuation/whitespace collapse, and scenario mappings.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Run `npm install && npm test`.
3. Open a pull request with a clear description.

See `SECURITY.md` for reporting vulnerabilities.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.