import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createBilibiliResolver } from '@local/dsh-bilibili/media';

const require = createRequire(import.meta.url);

/** A setup problem the user can act on, with an actionable hint. */
export class SeeitSetupError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'SeeitSetupError';
    this.hint = hint;
  }
}

const FFMPEG_COMMANDS = new Set(['ffmpeg', 'ffprobe']);

/**
 * Seeit invokes bare `ffmpeg`/`ffprobe` names, including for audio extraction
 * where no executable can be injected. Rewriting the command name here keeps
 * every call on the resolved binary without patching Seeit.
 */
export class ResolvingCommandRunner {
  constructor(inner, overrides = {}) {
    this.inner = inner;
    this.overrides = overrides;
  }

  run(command, args, options) {
    const replacement = FFMPEG_COMMANDS.has(command) ? this.overrides[command] : undefined;
    return this.inner.run(replacement ?? command, args, options);
  }
}

function fromModule(name, pick) {
  try {
    const value = pick(require(require.resolve(name)));
    if (typeof value === 'string' && value.trim() && existsSync(value)) return value;
  } catch {
    // Package absent; fall back to PATH below.
  }
  return undefined;
}

/** Explicit config wins, then the environment, then a bundled package, then PATH. */
export function resolveBinaries(config = {}) {
  return {
    ffmpeg: config.ffmpegPath?.trim() || process.env.SEEIT_FFMPEG
      || fromModule('ffmpeg-static', (m) => m?.default ?? m),
    ffprobe: config.ffprobePath?.trim() || process.env.SEEIT_FFPROBE
      || fromModule('ffprobe-static', (m) => m?.path),
  };
}

/** Load the built Seeit library from the configured checkout. */
export async function loadSeeit(seeitRoot) {
  const root = resolve(seeitRoot);
  const entry = join(root, 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new SeeitSetupError(
      `Seeit 构建产物不存在：${entry}`,
      `请在 ${root} 执行 npm install 与 npm run build 后重试。`,
    );
  }
  return import(pathToFileURL(entry).href);
}

/**
 * Compose the same pipeline the Seeit CLI builds, but from a provider config
 * object the caller assembled (DSH model route + ASR route) instead of a file.
 */
export async function createSeeitRuntime(config) {
  const seeit = await loadSeeit(config.seeitRoot);
  const binaries = resolveBinaries(config);
  const providers = seeit.createConfiguredProviders(config.providerConfig);
  const storage = new seeit.VideoStorage(resolve(config.dataDir));
  const commandRunner = new ResolvingCommandRunner(new seeit.NodeCommandRunner(), binaries);
  const frameExtractor = new seeit.FfmpegFrameExtractor(commandRunner);
  const requestContext = new AsyncLocalStorage();
  const bilibiliResolver = createBilibiliResolver({
    seeit, storage, commandRunner, asrProvider: providers.asr,
    accountFile: config.bilibiliAccountFile?.trim() || undefined,
    maxDownloadMb: config.bilibiliMaxDownloadMb ?? 800,
    maxVideoMinutes: config.bilibiliMaxVideoMinutes ?? 60,
    getSignal: () => requestContext.getStore(),
  });
  const ingest = new seeit.MediaIngestService([
    new seeit.BilibiliVideoIngestor(bilibiliResolver),
    new seeit.LocalVideoIngestor({
      ...(providers.asr ? { asrProvider: providers.asr } : {}),
      commandRunner,
      cacheDirForVideo: (videoId) => storage.getCacheDir(videoId),
    }),
  ]);
  const system = new seeit.VideoUnderstandingSystem({
    ingest,
    frameSampler: new seeit.SparseFrameSampler(frameExtractor),
    frameExtractor,
    storage,
    llm: providers.llm,
    ...(providers.vision ? { vision: providers.vision } : {}),
    perception: providers.perception,
  });
  return {
    seeit,
    system,
    storage,
    binaries,
    providers,
    bilibiliAccountFile: config.bilibiliAccountFile,
    withSignal: (signal, run) => requestContext.run(signal, run),
    notes: config.notes ?? [],
  };
}

/** Report what the plugin can actually reach, so failures name the cause. */
export async function diagnose(config) {
  const binaries = resolveBinaries(config);
  const runner = new ResolvingCommandRunner(
    new (await loadSeeit(config.seeitRoot)).NodeCommandRunner(),
    binaries,
  );
  const check = async (name) => {
    try {
      const result = await runner.run(name, ['-version'], { timeoutMs: 15000 });
      const first = `${result.stdout}${result.stderr}`.split('\n')[0].trim();
      return result.exitCode === 0
        ? { ok: true, detail: first || 'ok' }
        : { ok: false, detail: first || `exit ${result.exitCode}` };
    } catch (error) {
      return { ok: false, detail: error.message };
    }
  };
  return { binaries, ffmpeg: await check('ffmpeg'), ffprobe: await check('ffprobe') };
}
