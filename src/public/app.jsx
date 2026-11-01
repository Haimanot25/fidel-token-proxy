const { useState, useEffect, useRef } = React;

const defaultModels = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-flash',
  groq: 'openai/gpt-oss-20b',
  together: 'meta-llama/Llama-3-8b-chat-hf',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  ollama: 'llama3.1',
  openrouter: 'openai/gpt-4o-mini',
  cohere: 'command-r',
};

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('fidel-theme') !== 'light'; } catch (e) { return true; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('dark'); else root.classList.remove('dark');
    try { localStorage.setItem('fidel-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }, [dark]);
  return [dark, setDark];
}

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-3xl font-bold mt-2 ${accent || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-br-sm shadow'
          : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-bl-sm shadow-sm'
      }`}>
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        {msg.streaming && <span className="inline-block w-2 h-4 ml-1 bg-current align-middle animate-pulse" />}
      </div>
    </div>
  );
}

function App() {
  const [dark, setDark] = useDarkMode();
  const [view, setView] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem('fidel-api-key') || ''; } catch (e) { return ''; } });
  const [provider, setProvider] = useState('openai');
  const [providers, setProviders] = useState([]);
  const [model, setModel] = useState('gpt-4o-mini');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState('openai');
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsBaseUrl, setSettingsBaseUrl] = useState('');
  const [settingsModel, setSettingsModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/stats');
        if (r.ok) setStats(await r.json());
      } catch (e) {}
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/providers');
        if (r.ok) {
          const d = await r.json();
          setProviders(d.providers || []);
          if (d.default) setProvider(d.default);
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, view]);

  useEffect(() => {
    if (view !== 'settings') return;
    (async () => {
      try {
        const r = await fetch(`/api/providers/${settingsProvider}/models`);
        if (r.ok) {
          const d = await r.json();
          setAvailableModels(d.models || []);
          setSettingsModel(d.defaultModel || defaultModels[settingsProvider] || '');
        }
        const sr = await fetch('/api/settings');
        if (sr.ok) {
          const sd = await sr.json();
          const p = (sd.providers || []).find((x) => x.provider === settingsProvider);
          if (p) {
            setSettingsApiKey(p.apiKey || '');
            setSettingsBaseUrl(p.baseUrl || '');
            if (p.defaultModel) setSettingsModel(p.defaultModel);
          }
        }
      } catch (e) {}
    })();
  }, [view, settingsProvider]);

  const saveApiKey = (v) => {
    setApiKey(v);
    try { localStorage.setItem('fidel-api-key', v); } catch (e) {}
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await fetch(`/api/providers/${settingsProvider}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: settingsApiKey, baseUrl: settingsBaseUrl, defaultModel: settingsModel }),
      });
      const r = await fetch('/api/providers');
      if (r.ok) {
        const d = await r.json();
        setProviders(d.providers || []);
      }
      setShowSettings(false);
    } catch (e) {}
    setSavingSettings(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    const assistantMsg = { role: 'assistant', content: '', streaming: true };
    setMessages([...next, assistantMsg]);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const endpoint = provider && provider !== 'openai'
        ? `/v1/providers/${provider}/chat/completions`
        : '/v1/chat/completions';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: next, stream: true }),
      });

      if (!res.ok) {
        const errText = await res.text();
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${errText}`, streaming: false };
          return copy;
        });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (delta) {
              accumulated += delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: accumulated, streaming: true };
                return copy;
              });
            }
          } catch (e) {}
        }
      }

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: accumulated, streaming: false };
        return copy;
      });
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err.message}`, streaming: false };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const resetChat = () => setMessages([]);

  const ratio = stats && stats.total_raw_tokens > 0
    ? ((stats.tokens_saved / stats.total_raw_tokens) * 100).toFixed(1)
    : '0.0';

  const navItems = [
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'admin', label: 'Admin', icon: '🛠️' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-black">
      {/* Top bar */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-gray-900 dark:text-white">፨ Fidel</span>
            <span className="hidden sm:inline text-xs text-gray-400">Token Proxy</span>
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map((n) => (
              <button key={n.id} onClick={() => { if (n.id === 'admin') { window.location.href = '/admin'; return; } setView(n.id); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === n.id ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <span className="mr-1">{n.icon}</span>{n.label}
              </button>
            ))}
            <a href="/developers.html" target="_blank" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Docs</a>
          </nav>
          <div className="flex items-center gap-2">
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(defaultModels[e.target.value] || model); }} className="text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              {(providers.length ? providers : [{name:'openai'}]).map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <input value={model} onChange={(e) => setModel(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-36" />
            <button onClick={() => setDark(!dark)} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
              {dark ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {view === 'chat' && (
          <div className="max-w-4xl mx-auto flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-semibold text-sm">Conversation</span>
                <span className="text-xs text-gray-400">· {provider} · {model}</span>
              </div>
              <button onClick={resetChat} className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition">Clear</button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-6xl mb-4 opacity-80">፨</div>
                  <h3 className="text-lg font-semibold mb-1">Start a conversation</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">Type in Amharic, Afaan Oromoo, Tigrinya, or English. Ethiopic text is normalized and compressed automatically.</p>
                  <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    {['ሰላም', 'ፀሐይ', 'አማርኛ', 'እንዴት ነህ?'].map((s) => (
                      <button key={s} onClick={() => setInput(s)} className="px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => <ChatMessage key={i} msg={m} />)}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 p-4">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  rows={2}
                  placeholder="Type a message..."
                  className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white transition"
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="px-6 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-200 transition"
                >
                  {loading ? '…' : 'Send'}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                <span>Enter to send · Shift+Enter for newline</span>
                <span>{messages.length} messages</span>
              </div>
            </div>
          </div>
        )}

        {view === 'analytics' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Analytics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total requests" value={stats ? stats.total_requests.toLocaleString() : '0'} />
              <StatCard label="Raw tokens" value={stats ? stats.total_raw_tokens.toLocaleString() : '0'} />
              <StatCard label="Compressed tokens" value={stats ? stats.total_compressed_tokens.toLocaleString() : '0'} />
              <StatCard label="Tokens saved" value={stats ? stats.tokens_saved.toLocaleString() : '0'} accent="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Compression ratio" value={`${ratio}%`} />
              <StatCard label="USD saved (est.)" value={stats ? `$${stats.estimated_usd_saved.toFixed(4)}` : '$0.0000'} />
              <StatCard label="Cache hits" value={stats ? stats.cache_hits : '0'} hint={`${stats ? stats.cached_system_prompts : 0} cached prompts`} />
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="font-semibold mb-3">Raw vs compressed</h3>
              <div className="flex items-end gap-4 h-40">
                <div className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-gray-300 dark:bg-gray-700 rounded-t" style={{ height: `${stats && stats.total_raw_tokens > 0 ? 100 : 0}%` }}></div>
                  <div className="text-xs mt-2 text-gray-500">Raw</div>
                </div>
                <div className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-gray-400 dark:bg-gray-600 rounded-t" style={{ height: `${stats && stats.total_raw_tokens > 0 ? (stats.total_compressed_tokens / stats.total_raw_tokens * 100) : 0}%` }}></div>
                  <div className="text-xs mt-2 text-gray-500">Compressed</div>
                </div>
              </div>
            </div>
            <button onClick={async () => { await fetch('/api/stats/reset', { method: 'POST' }); }} className="px-4 py-2 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50 dark:hover:bg-red-900/20">Reset stats</button>
          </div>
        )}

        {view === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-2xl font-bold">Settings</h2>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300 font-medium">Provider</span>
                <select value={settingsProvider} onChange={(e) => setSettingsProvider(e.target.value)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  {(providers.length ? providers : [{name:'openai'}]).map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300 font-medium">API Key</span>
                <input type="password" value={settingsApiKey} onChange={(e) => setSettingsApiKey(e.target.value)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300 font-medium">Base URL</span>
                <input value={settingsBaseUrl} onChange={(e) => setSettingsBaseUrl(e.target.value)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300 font-medium">Default Model</span>
                <select value={settingsModel} onChange={(e) => setSettingsModel(e.target.value)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  {(availableModels.length ? availableModels : [settingsModel]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end">
                <button onClick={saveSettings} disabled={savingSettings} className="px-5 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium disabled:opacity-50">
                  {savingSettings ? 'Saving...' : 'Save to DB'}
                </button>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="font-semibold mb-2">API Key (chat)</h3>
              <input type="password" value={apiKey} onChange={(e) => saveApiKey(e.target.value)} placeholder="OpenAI API key (optional)" className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" />
              <p className="text-xs text-gray-400 mt-1">Used when no provider key is stored. Stored in browser localStorage.</p>
            </div>
          </div>
        )}
      </main>

      {showSettings && null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
