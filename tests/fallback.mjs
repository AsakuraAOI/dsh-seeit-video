// Verifies the ASR-degradation path through the real plugin module: the first
// attempt uses XingChenGSR-V1.0, fails, and the tool retries without ASR.
import { readFile } from 'node:fs/promises';
import { apply } from '../src/index.js';

const raw = await readFile('C:/Users/14506/.dsh/.credentials.yaml', 'utf8');
const key = raw.match(/HIAGENT_API_KEY:\s*(\S+)/u)?.[1];
if (!key) throw new Error('HIAGENT_API_KEY not found');

const registered = new Map();
const ctx = {
  effect: (fn) => fn(),
  tools: { register: (definition) => { registered.set(definition.name, definition); return () => {}; } },
  credentials: { resolve: async (ref) => (ref === 'HIAGENT_API_KEY' ? { value: key, source: 'test' } : undefined) },
  llm: { resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, inputModalities: ['text', 'image'] }) },
  agentDefaultModel: { currentSelection: () => ({ provider: 'hiagent', model: 'deepseek-v4.1-flash' }) },
};

apply(ctx, {
  seeitRoot: 'C:/Users/14506/Desktop/Seeit',
  dataDir: 'C:/Users/14506/Desktop/Seeit/data',
  dshBaseUrl: 'https://api.asakuraaoi.cn/v1',
  dshApiKeyRef: 'HIAGENT_API_KEY',
  dshJsonMode: false,
  asrBaseUrl: 'https://api.siliconflow.cn/v1',
  asrModel: 'XingChenAGI/XingChenGSR-V1.0',
  asrApiKeyRef: 'SILICONFLOW_API_KEY',
  seeitConfigPath: 'C:/Users/14506/Desktop/Seeit/seeit.config.json',
  ffmpegPath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
  ffprobePath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe',
});

const process = registered.get('video_process');
if (!process) throw new Error('video_process not registered');

const started = Date.now();
const output = await process.execute({
  path: 'C:/Users/14506/Desktop/Seeit/1.mp4',
  videoId: 'fallback-1',
  force: true,
}, {});
console.log(`elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(String(output).slice(0, 2000));
