// Probes the DSH main-model route and the SiliconFlow connection so the plugin
// can be wired to endpoints that actually answer. Secrets are never printed.
import { readFile } from 'node:fs/promises';

const CREDS = 'C:/Users/14506/.dsh/.credentials.yaml';
const SEEIT_CONFIG = 'C:/Users/14506/Desktop/Seeit/seeit.config.json';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const raw = await readFile(CREDS, 'utf8');

console.log('=== credentials structure (values masked) ===');
console.log(raw.split(/\r?\n/u).map((line) => {
  const m = line.match(/^(\s*[^:#]+:\s*)(\S.*)$/u);
  if (!m) return line;
  const value = m[2].trim();
  return m[1] + (value.length > 8 ? `${value.slice(0, 3)}...(len=${value.length})` : '***');
}).join('\n'));

function extract(key) {
  const lines = raw.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(new RegExp(`^(\\s*)["']?${key}["']?\\s*:\\s*(.*)$`, 'u'));
    if (!m) continue;
    const inline = m[2].trim();
    if (inline) return inline.replace(/^["']|["']$/gu, '');
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim()) continue;
      if (lines[j].match(/^\s*/u)[0].length <= indent) break;
      const vm = lines[j].match(/^\s*(?:value|key|apiKey)\s*:\s*(.+)$/u);
      if (vm) return vm[1].trim().replace(/^["']|["']$/gu, '');
    }
  }
  return undefined;
}

const hiagentKey = extract('HIAGENT_API_KEY');
console.log(`\nHIAGENT_API_KEY: ${hiagentKey ? `found (len=${hiagentKey.length})` : 'NOT FOUND'}`);

async function get(url, key) {
  try {
    const res = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(20000) });
    const text = (await res.text()).replace(/\s+/gu, ' ');
    return `HTTP ${res.status} ${text.slice(0, 400)}`;
  } catch (error) {
    return `FAIL ${error.message}`;
  }
}

async function chat(base, model, key, content) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 64 }),
      signal: AbortSignal.timeout(90000),
    });
    const text = (await res.text()).replace(/\s+/gu, ' ');
    return `HTTP ${res.status} ${text.slice(0, 400)}`;
  } catch (error) {
    return `FAIL ${error.message}`;
  }
}

console.log('\n=== DSH gateway discovery ===');
for (const base of ['https://api.asakuraaoi.cn/v1', 'https://api.asakuraaoi.cn/anthropic']) {
  console.log(`GET ${base}/models -> ${await get(`${base}/models`, hiagentKey)}`);
}

console.log('\n=== DSH gateway chat (text) ===');
for (const model of ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'mimov2.6pro']) {
  console.log(`${model} text -> ${await chat('https://api.asakuraaoi.cn/v1', model, hiagentKey, 'Reply with the single word: pong')}`);
}

console.log('\n=== DSH gateway chat (image) ===');
for (const model of ['deepseek-v4.1-flash', 'mimov2.6pro']) {
  const content = [
    { type: 'text', text: 'What color is this 1x1 image? One word.' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
  ];
  console.log(`${model} image -> ${await chat('https://api.asakuraaoi.cn/v1', model, hiagentKey, content)}`);
}

console.log('\n=== SiliconFlow models ===');
const cfg = JSON.parse(await readFile(SEEIT_CONFIG, 'utf8'));
const sf = cfg.connections.siliconflow;
try {
  const res = await fetch(`${sf.baseUrl.replace(/\/+$/u, '')}/models`, { headers: { Authorization: `Bearer ${sf.apiKey}` }, signal: AbortSignal.timeout(30000) });
  console.log(`GET ${sf.baseUrl}/models -> HTTP ${res.status}`);
  if (res.ok) {
    const data = await res.json();
    const list = (data.data ?? data.models ?? []).map((m) => m.id ?? m.name ?? String(m));
    console.log(`total=${list.length}`);
    console.log('xingchen/gsr:', list.filter((x) => /xingchen|gsr/iu.test(x)).join(', ') || '(none)');
    console.log('asr-ish:', list.filter((x) => /asr|audio|speech|whisper|sense/iu.test(x)).join(', ') || '(none)');
  } else {
    console.log((await res.text()).slice(0, 300));
  }
} catch (error) {
  console.log(`FAIL ${error.message}`);
}