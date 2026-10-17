// Probes each configured Seeit connection with one minimal chat request so a
// failure names the exact provider and HTTP status instead of a stack trace.
import { readFile } from 'node:fs/promises';

const CONFIG = 'C:/Users/14506/Desktop/Seeit/seeit.config.json';
const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));

async function probe(label, connection, model) {
  const c = cfg.connections[connection];
  if (!c) {
    console.log(`${label}: connection "${connection}" missing`);
    return;
  }
  try {
    const res = await fetch(`${c.baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await res.text()).replace(/\s+/gu, ' ').slice(0, 240);
    console.log(`${label}: HTTP ${res.status} ${body}`);
  } catch (error) {
    console.log(`${label}: FAIL ${error.message}`);
  }
}

console.log('connections:', Object.keys(cfg.connections).join(', '));
console.log('models:', JSON.stringify(cfg.models));
await probe('llm', cfg.models.llm.connection, cfg.models.llm.model);
if (cfg.models.vision) await probe('vision', cfg.models.vision.connection, cfg.models.vision.model);
if (cfg.models.asr) console.log(`asr: ${cfg.models.asr.connection} / ${cfg.models.asr.model} (audio/transcriptions; 402 already observed)`);