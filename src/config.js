require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  defaultProvider: (process.env.DEFAULT_PROVIDER || 'openai').toLowerCase(),
  dbPath: process.env.DB_PATH || './data/fidel.db',
  cacheEnabled: (process.env.CACHE_ENABLED || 'true').toLowerCase() !== 'false',
  normalizeEnabled: (process.env.NORMALIZE_ENABLED || 'true').toLowerCase() !== 'false',
  aggressiveNormalize: (process.env.AGGRESSIVE_NORMALIZE || 'false').toLowerCase() === 'true',
  inputCostPer1k: parseFloat(process.env.INPUT_COST_PER_1K || '0.005'),
  outputCostPer1k: parseFloat(process.env.OUTPUT_COST_PER_1K || '0.015'),
  providers: {
    openai: {
      baseUrl: (process.env.OPENAI_BASE_URL || process.env.UPSTREAM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: process.env.OPENAI_API_KEY || process.env.UPSTREAM_API_KEY || '',
    },
    anthropic: {
      baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      version: process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    gemini: {
      baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
      apiKey: process.env.GEMINI_API_KEY || '',
    },
    // OpenAI-compatible providers (Groq, Together, Mistral, DeepSeek, Ollama, OpenRouter, Azure, Cohere v2, ...)
    groq: {
      baseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      apiKey: process.env.GROQ_API_KEY || '',
    },
    together: {
      baseUrl: (process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1').replace(/\/+$/, ''),
      apiKey: process.env.TOGETHER_API_KEY || '',
    },
    mistral: {
      baseUrl: (process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, ''),
      apiKey: process.env.MISTRAL_API_KEY || '',
    },
    deepseek: {
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      apiKey: process.env.DEEPSEEK_API_KEY || '',
    },
    ollama: {
      baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
      apiKey: process.env.OLLAMA_API_KEY || 'ollama',
    },
    openrouter: {
      baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      apiKey: process.env.OPENROUTER_API_KEY || '',
    },
    cohere: {
      baseUrl: (process.env.COHERE_BASE_URL || 'https://api.cohere.ai/compatibility/v1').replace(/\/+$/, ''),
      apiKey: process.env.COHERE_API_KEY || '',
    },
  },
};

module.exports = config;
