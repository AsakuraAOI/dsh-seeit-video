// End-to-end smoke test: resolve binaries, load the SiliconFlow/DeepSeek
// provider config, ingest a real video, then ask one question.
import { createSeeitRuntime, diagnose } from '../src/runtime.js';

const SEEIT_ROOT = 'C:/Users/14506/Desktop/Seeit';
const VIDEO = `${SEEIT_ROOT}/1.mp4`;
const config = {
  seeitRoot: SEEIT_ROOT,
  dataDir: `${SEEIT_ROOT}/data`,
  configPath: `${SEEIT_ROOT}/seeit.config.json`,
  ffmpegPath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
  ffprobePath: 'C:/Program Files/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe',
};

const step = (label, value) => console.log(`\n=== ${label} ===\n${value}`);

const diag = await diagnose(config);
step('binaries', JSON.stringify(diag.binaries, null, 2));
step('ffmpeg', JSON.stringify(diag.ffmpeg));
step('ffprobe', JSON.stringify(diag.ffprobe));

const runtime = await createSeeitRuntime(config);
step('providers', JSON.stringify({
  llm: Boolean(runtime.providers.llm),
  vision: Boolean(runtime.providers.vision),
  asr: Boolean(runtime.providers.asr),
}));

const started = Date.now();
const understanding = await runtime.system.process(
  { kind: 'local', uri: VIDEO, videoId: 'smoke-1' },
  {},
);
step('process', `elapsed=${((Date.now() - started) / 1000).toFixed(1)}s
videoId=${understanding.videoId}
status=${understanding.status}
contentType=${understanding.contentType}
sections=${understanding.sections?.length ?? 0}
unresolved=${understanding.unresolved?.length ?? 0}
overview=${understanding.overview?.slice(0, 400)}`);

const transcript = await runtime.storage.readTranscript('smoke-1');
step('transcript', transcript
  ? `source=${transcript.source} cues=${transcript.cues?.length ?? 0}\nfirst=${transcript.cues?.[0]?.content ?? ''}`
  : 'none');

const answer = await runtime.system.ask('smoke-1', '这个视频主要讲了什么？');
step('ask', `reliable=${answer.reliable} usedPerception=${answer.usedPerception}
answer=${answer.answer}
evidence=${JSON.stringify(answer.evidence?.slice(0, 5))}`);