// Validates the DSH-gateway path on its own: LLM + vision on the main model,
// no ASR. A subtitle-free video must still produce a visual understanding.
import { readFile } from 'node:fs/promises';
import { createSeeitRuntime, diagnose } from '../src/runtime.js';

const SEEIT_ROOT = 'C:/Users/14506/Desktop/Seeit';
const VIDEO = `${SEEIT_ROOT}/1.mp4`;
const CREDS = 'C:/Users/14506/.dsh/.credentials.yaml';
const DSH_BASE = 'https://api.asakuraaoi.cn/v1';
const DSH_MODEL = 'deepseek-v4.1-flash';
const FFMPEG = 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';
const FFPROBE = 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';

const step = (label, value) => console.log(`\n=== ${label} ===\n${value}`);

const raw = await readFile(CREDS, 'utf8');
const dshKey = raw.match(/HIAGENT_API_KEY:\s*(\S+)/u)?.[1];
step('credentials', dshKey ? `dsh=found(${dshKey.length})` : 'dsh=MISSING');

step('binaries', JSON.stringify(await diagnose({ seeitRoot: SEEIT_ROOT, ffmpegPath: FFMPEG, ffprobePath: FFPROBE }), null, 2));

const runtime = await createSeeitRuntime({
  seeitRoot: SEEIT_ROOT,
  dataDir: `${SEEIT_ROOT}/data`,
  ffmpegPath: FFMPEG,
  ffprobePath: FFPROBE,
  providerConfig: {
    schemaVersion: 1,
    connections: {
      dsh: { type: 'openai-compatible', baseUrl: DSH_BASE, apiKey: dshKey, timeoutMs: 300000, jsonMode: false },
    },
    models: {
      llm: { connection: 'dsh', model: DSH_MODEL },
      vision: { connection: 'dsh', model: DSH_MODEL },
    },
  },
});
step('providers', JSON.stringify({ llm: !!runtime.providers.llm, vision: !!runtime.providers.vision, asr: !!runtime.providers.asr }));

const started = Date.now();
try {
  const understanding = await runtime.system.process({ kind: 'local', uri: VIDEO, videoId: 'noasr-1' }, {});
  step('process', `elapsed=${((Date.now() - started) / 1000).toFixed(1)}s
videoId=${understanding.videoId}
status=${understanding.status}
contentType=${understanding.contentType}
sections=${understanding.sections?.length ?? 0}
unresolved=${understanding.unresolved?.length ?? 0}
overview=${understanding.overview?.slice(0, 600)}`);

  const state = await runtime.storage.readPerceptionState('noasr-1');
  step('perception', `observations=${state?.observations?.length ?? 0} requests=${state?.executedRequests?.length ?? 0}`);

  const answer = await runtime.system.ask('noasr-1', '这个视频里能看到什么？');
  step('ask', `reliable=${answer.reliable} usedPerception=${answer.usedPerception}
answer=${answer.answer}
evidence=${JSON.stringify(answer.evidence?.slice(0, 4))}`);
} catch (error) {
  step('FAILED', `${error.name}: ${error.message}`);
  process.exitCode = 1;
}