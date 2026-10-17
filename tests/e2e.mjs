// End-to-end run of the exact provider routing the plugin builds:
// LLM + vision on the DSH gateway main model, ASR on XingChenGSR-V1.0.
import { readFile } from 'node:fs/promises';
import { createSeeitRuntime, diagnose } from '../src/runtime.js';

const SEEIT_ROOT = 'C:/Users/14506/Desktop/Seeit';
const VIDEO = `${SEEIT_ROOT}/1.mp4`;
const CREDS = 'C:/Users/14506/.dsh/.credentials.yaml';
const SEEIT_CONFIG = `${SEEIT_ROOT}/seeit.config.json`;
const DSH_BASE = 'https://api.asakuraaoi.cn/v1';
const DSH_MODEL = 'deepseek-v4.1-flash';
const ASR_MODEL = 'XingChenAGI/XingChenGSR-V1.0';

const step = (label, value) => console.log(`\n=== ${label} ===\n${value}`);

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

const dshKey = extractKey(await readFile(CREDS, 'utf8'), 'HIAGENT_API_KEY');
const seeitCfg = JSON.parse(await readFile(SEEIT_CONFIG, 'utf8'));
const asrKey = seeitCfg.connections.siliconflow?.apiKey;
step('credentials', `dsh=${dshKey ? `found(${dshKey.length})` : 'MISSING'} asr=${asrKey ? `found(${asrKey.length})` : 'MISSING'}`);

const providerConfig = {
  schemaVersion: 1,
  connections: {
    dsh: { type: 'openai-compatible', baseUrl: DSH_BASE, apiKey: dshKey, timeoutMs: 300000, jsonMode: false },
    ...(asrKey ? { asr: { type: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: asrKey, timeoutMs: 600000, jsonMode: false } } : {}),
  },
  models: {
    llm: { connection: 'dsh', model: DSH_MODEL },
    vision: { connection: 'dsh', model: DSH_MODEL },
    ...(asrKey ? { asr: { connection: 'asr', model: ASR_MODEL } } : {}),
  },
};

const diag = await diagnose({ seeitRoot: SEEIT_ROOT, ffmpegPath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe', ffprobePath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe' });
step('binaries', JSON.stringify(diag, null, 2));

const runtime = await createSeeitRuntime({
  seeitRoot: SEEIT_ROOT,
  dataDir: `${SEEIT_ROOT}/data`,
  providerConfig,
  ffmpegPath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
  ffprobePath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe',
});
step('providers', JSON.stringify({ llm: !!runtime.providers.llm, vision: !!runtime.providers.vision, asr: !!runtime.providers.asr }));

const started = Date.now();
try {
  const understanding = await runtime.system.process({ kind: 'local', uri: VIDEO, videoId: 'e2e-1' }, {});
  step('process', `elapsed=${((Date.now() - started) / 1000).toFixed(1)}s
videoId=${understanding.videoId}
status=${understanding.status}
contentType=${understanding.contentType}
sections=${understanding.sections?.length ?? 0}
unresolved=${understanding.unresolved?.length ?? 0}
overview=${understanding.overview?.slice(0, 500)}`);

  const transcript = await runtime.storage.readTranscript('e2e-1');
  step('transcript', transcript
    ? `source=${transcript.source} cues=${transcript.cues?.length ?? 0}\nfirst=${transcript.cues?.[0]?.content ?? ''}\nlast=${transcript.cues?.at(-1)?.content ?? ''}`
    : 'none');

  const answer = await runtime.system.ask('e2e-1', '这个视频主要讲了什么？');
  step('ask', `reliable=${answer.reliable} usedPerception=${answer.usedPerception}
answer=${answer.answer}
evidence=${JSON.stringify(answer.evidence?.slice(0, 4))}`);
} catch (error) {
  step('FAILED', `${error.name}: ${error.message}`);
  process.exitCode = 1;
}