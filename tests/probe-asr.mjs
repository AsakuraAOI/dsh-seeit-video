// Probes every candidate ASR route so the plugin can be wired to one that
// actually answers. No secret value is printed.
import { readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';
const WAV = join(here, 'probe-tone.wav');
const CREDS = 'C:/Users/14506/.dsh/.credentials.yaml';
const SEEIT_CONFIG = 'C:/Users/14506/Desktop/Seeit/seeit.config.json';

await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '16000', '-ac', '1', WAV]);
const audio = await readFile(WAV);
console.log(`probe audio: ${audio.length} bytes`);

function extractKey(raw, key) {
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

const hiagentKey = extractKey(await readFile(CREDS, 'utf8'), 'HIAGENT_API_KEY');
const seeit = JSON.parse(await readFile(SEEIT_CONFIG, 'utf8'));
const sfKey = seeit.connections.siliconflow.apiKey;
console.log(`HIAGENT_API_KEY: ${hiagentKey ? `found (len=${hiagentKey.length})` : 'NOT FOUND'}`);

async function transcribe(label, url, key, model) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'probe.wav');
  form.append('model', model);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    const text = (await res.text()).replace(/\s+/gu, ' ');
    console.log(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
  } catch (error) {
    console.log(`${label}: FAIL ${error.message}`);
  }
}

console.log('\n=== ASR candidates ===');
await transcribe('siliconflow XingChenGSR-V1.0', 'https://api.siliconflow.cn/v1/audio/transcriptions', sfKey, 'XingChenAGI/XingChenGSR-V1.0');
await transcribe('siliconflow SenseVoiceSmall', 'https://api.siliconflow.cn/v1/audio/transcriptions', sfKey, 'FunAudioLLM/SenseVoiceSmall');
await transcribe('gateway audio/transcriptions', 'https://api.asakuraaoi.cn/v1/audio/transcriptions', hiagentKey, 'whisper-1');
await transcribe('gateway XingChenGSR-V1.0', 'https://api.asakuraaoi.cn/v1/audio/transcriptions', hiagentKey, 'XingChenAGI/XingChenGSR-V1.0');

console.log('\n=== gateway model listing ===');
try {
  const res = await fetch('https://api.asakuraaoi.cn/v1/models', { headers: { Authorization: `Bearer ${hiagentKey}` }, signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  console.log(JSON.stringify(data).slice(0, 1200));
} catch (error) {
  console.log(`FAIL ${error.message}`);
}

await rm(WAV, { force: true });