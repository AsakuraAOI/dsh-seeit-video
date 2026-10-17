// Checks whether fnlp/MOSS-TTSD-v0.5 exists on SiliconFlow and whether it can
// serve the audio/transcriptions route the Seeit ASR provider calls.
import { readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';
const WAV = join(here, 'probe-moss.wav');
const SEEIT_CONFIG = 'C:/Users/14506/Desktop/Seeit/seeit.config.json';

await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '16000', '-ac', '1', WAV]);
const audio = await readFile(WAV);
console.log(`probe audio: ${audio.length} bytes`);

const cfg = JSON.parse(await readFile(SEEIT_CONFIG, 'utf8'));
const sf = cfg.connections.siliconflow;
const base = sf.baseUrl.replace(/\/+$/u, '');

const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${sf.apiKey}` }, signal: AbortSignal.timeout(30000) });
const data = await res.json();
const list = (data.data ?? []).map((m) => m.id ?? m.name ?? String(m));
console.log(`\n=== SiliconFlow models (total ${list.length}) ===`);
console.log('moss:', list.filter((x) => /moss/iu.test(x)).join(', ') || '(none)');
console.log('tts-ish:', list.filter((x) => /tts|speech|voice|cosy/i.test(x)).join(', ') || '(none)');
console.log('asr-ish:', list.filter((x) => /asr|transcri|whisper|sense/i.test(x)).join(', ') || '(none)');

async function transcribe(label, model) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'probe.wav');
  form.append('model', model);
  try {
    const r = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sf.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    const text = (await r.text()).replace(/\s+/gu, ' ');
    console.log(`${label}: HTTP ${r.status} ${text.slice(0, 300)}`);
  } catch (error) {
    console.log(`${label}: FAIL ${error.message}`);
  }
}

console.log('\n=== audio/transcriptions attempts ===');
await transcribe('fnlp/MOSS-TTSD-v0.5', 'fnlp/MOSS-TTSD-v0.5');
await transcribe('XingChenAGI/XingChenGSR-V1.0', 'XingChenAGI/XingChenGSR-V1.0');

console.log('\n=== audio/speech (TTS) attempt with the same model ===');
try {
  const r = await fetch(`${base}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sf.apiKey}` },
    body: JSON.stringify({ model: 'fnlp/MOSS-TTSD-v0.5', input: '测试', voice: 'default' }),
    signal: AbortSignal.timeout(60000),
  });
  const text = (await r.text()).replace(/\s+/gu, ' ');
  console.log(`audio/speech: HTTP ${r.status} ${text.slice(0, 200)}`);
} catch (error) {
  console.log(`audio/speech: FAIL ${error.message}`);
}

await rm(WAV, { force: true });