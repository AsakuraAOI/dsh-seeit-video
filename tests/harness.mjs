// Loads the real plugin module against a stub Cordis context, then drives one
// tool end to end. This catches module-level and provider-wiring errors without
// installing the bundle into the live profile.
import { readFile } from 'node:fs/promises';
import { apply, Config, inject, name } from '../src/index.js';

const CREDS = 'C:/Users/14506/.dsh/.credentials.yaml';
const raw = await readFile(CREDS, 'utf8');
const key = raw.match(/HIAGENT_API_KEY:\s*(\S+)/u)?.[1];
if (!key) throw new Error('HIAGENT_API_KEY not found in credentials');

console.log('plugin name:', name);
console.log('inject:', inject.join(', '));
console.log('config keys:', Object.keys(Config({}) ?? {}).join(', '));

const registered = new Map();
const disposers = [];
const ctx = {
  effect: (fn) => { const d = fn(); disposers.push(d); return d; },
  tools: {
    register: (definition) => {
      registered.set(definition.name, definition);
      return () => registered.delete(definition.name);
    },
  },
  credentials: {
    resolve: async (ref) => (ref === 'HIAGENT_API_KEY' ? { value: key, source: 'test' } : undefined),
  },
  llm: {
    resolveModelInfo: async (provider, model) => ({
      provider, id: model, name: model, inputModalities: ['text', 'image'],
    }),
  },
  agentDefaultModel: {
    currentSelection: () => ({ provider: 'hiagent', model: 'deepseek-v4.1-flash' }),
  },
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

console.log('\nregistered tools:', [...registered.keys()].join(', '));
for (const [toolName, definition] of registered) {
  const required = definition.parameters?.required ?? [];
  console.log(`- ${toolName}: required=[${required.join(', ')}]`);
}

const summarize = registered.get('video_summarize');
if (!summarize) throw new Error('video_summarize was not registered');

console.log('\n=== video_summarize on the persisted noasr-1 video ===');
const started = Date.now();
const output = await summarize.execute({ videoId: 'noasr-1', instruction: '用三条要点说明这个视频在讲什么' }, {});
console.log(`elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(String(output).slice(0, 1500));

console.log('\n=== tool schemas ===');
for (const [toolName, definition] of registered) {
  console.log(toolName, JSON.stringify(definition.parameters));
}