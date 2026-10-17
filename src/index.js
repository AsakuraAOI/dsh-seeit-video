import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import z from '@deepseek-ai/schemastery';
import { SeeitSetupError, createSeeitRuntime } from './runtime.js';
import { videoAsk, videoProcess, videoSummarize } from './tools.js';

export const name = 'seeit-video';
export const inject = ['tools', 'credentials', 'llm', 'agentDefaultModel'];

export const Config = z.object({
  seeitRoot: z.string().default('C:/Users/14506/Desktop/Seeit'),
  dataDir: z.string().default(''),
  dshBaseUrl: z.string().default('https://api.asakuraaoi.cn/v1'),
  dshApiKeyRef: z.string().default('HIAGENT_API_KEY'),
  dshJsonMode: z.boolean().default(false),
  asrBaseUrl: z.string().default('https://api.siliconflow.cn/v1'),
  asrModel: z.string().default('XingChenAGI/XingChenGSR-V1.0'),
  asrApiKeyRef: z.string().default('SILICONFLOW_API_KEY'),
  seeitConfigPath: z.string().default('C:/Users/14506/Desktop/Seeit/seeit.config.json'),
  ffmpegPath: z.string().default(''),
  ffprobePath: z.string().default(''),
  bilibiliAccountFile: z.string().default(''),
  bilibiliMaxDownloadMb: z.number().min(10).max(4096).default(800),
  bilibiliMaxVideoMinutes: z.number().min(1).max(600).default(60),
}).i18n({
  zh: {
    seeitRoot: 'Seeit 源码目录（需已构建 dist）',
    dataDir: '持久化数据根目录；留空使用 <seeitRoot>/data',
    dshBaseUrl: 'DSH 模型网关的 OpenAI 兼容地址',
    dshApiKeyRef: 'DSH 模型网关的凭据引用',
    dshJsonMode: '发送 response_format；DSH 网关不支持该字段，保持关闭',
    asrBaseUrl: 'ASR 服务地址',
    asrModel: 'ASR 模型 ID',
    asrApiKeyRef: 'ASR 凭据引用；解析不到时回退读取 seeitConfigPath',
    seeitConfigPath: 'ASR 凭据回退来源（Seeit 配置文件）',
    ffmpegPath: 'ffmpeg 可执行文件路径；留空使用 PATH 或 ffmpeg-static',
    ffprobePath: 'ffprobe 可执行文件路径；留空使用 PATH 或 ffprobe-static',
    bilibiliAccountFile: 'B站账号凭据文件；留空复用 B站插件默认存储；自定义时两插件须一致',
    bilibiliMaxDownloadMb: '单个 B站分 P 的下载大小上限（MB）',
    bilibiliMaxVideoMinutes: '单个 B站分 P 的时长上限（分钟）',
  },
});

const TOOL_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
};

function explain(error) {
  if (error instanceof SeeitSetupError && error.hint) {
    return new Error(`${error.message}\n${error.hint}`);
  }
  return error;
}

/**
 * A dead ASR route must not make subtitle-free videos unusable. The failure is
 * recognised from the Seeit provider stack (transcribe/audio) or an explicit
 * balance/payment rejection, so the caller can retry without ASR.
 */
function isAsrFailure(error) {
  const text = `${error?.message ?? ''}\n${error?.stack ?? ''}`;
  if (/audio\/transcriptions|ASRProvider|transcribe/iu.test(text)) return true;
  return /HTTP 402|Payment Required|balance is insufficient/iu.test(text);
}

export function apply(ctx, config = {}) {
  const current = () => (typeof config.get === 'function' ? config.get() : config);

  async function resolveRef(ref) {
    if (!ref?.trim()) return undefined;
    try {
      const resolved = await ctx.credentials.resolve(ref.trim());
      return resolved?.value || undefined;
    } catch {
      return undefined;
    }
  }

  /** ASR credentials: DSH credential ref first, then the Seeit config file. */
  async function resolveAsrKey(cfg) {
    const direct = await resolveRef(cfg.asrApiKeyRef);
    if (direct) return direct;
    const path = cfg.seeitConfigPath?.trim();
    if (!path) return undefined;
    try {
      const raw = JSON.parse(await readFile(path, 'utf8'));
      const connections = Object.values(raw.connections ?? {});
      let host;
      try {
        host = new URL(cfg.asrBaseUrl).hostname;
      } catch {
        host = undefined;
      }
      if (host) {
        const matched = connections.find((connection) => {
          try {
            return new URL(connection?.baseUrl).hostname === host && connection?.apiKey;
          } catch {
            return false;
          }
        });
        if (matched?.apiKey) return matched.apiKey;
      }
      return connections.find((connection) => connection?.apiKey)?.apiKey;
    } catch {
      return undefined;
    }
  }

  /**
   * The DSH main model drives both text and vision. Vision is enabled only when
   * the resolved model actually declares image input; otherwise the plugin says
   * so instead of silently sending images to a text-only model.
   */
  async function buildProviderConfig(cfg, withAsr = true) {
    const notes = [];
    const selection = ctx.agentDefaultModel.currentSelection() ?? {};
    const provider = selection.provider;
    const model = selection.model;
    if (!provider || !model) {
      throw new SeeitSetupError(
        'DSH 未配置默认模型，无法为 Seeit 提供 LLM。',
        '请在 DSH 模型设置中选择一个默认模型后重试。',
      );
    }

    let supportsImage = false;
    try {
      const info = await ctx.llm.resolveModelInfo(provider, model);
      supportsImage = (info?.inputModalities ?? []).includes('image');
    } catch (error) {
      notes.push(`视觉不可用：无法解析 DSH 主模型 ${provider}/${model} 的能力（${error.message}）。`);
    }
    if (!supportsImage && !notes.length) {
      notes.push(
        `视觉不可用：DSH 主模型 ${provider}/${model} 未声明 image 输入，`
        + 'Seeit 将只使用字幕/简介等文字证据，不会抽帧调用视觉模型。'
        + '如需画面理解，请在 DSH 中把默认模型切换为支持视觉的模型。',
      );
    }

    const dshKey = await resolveRef(cfg.dshApiKeyRef);
    if (!dshKey) {
      throw new SeeitSetupError(
        `无法解析 DSH 模型凭据 ${cfg.dshApiKeyRef}。`,
        '请在 DSH 模型设置中配置该密钥，或在插件配置里改 dshApiKeyRef。',
      );
    }

    const connections = {
      dsh: {
        type: 'openai-compatible',
        baseUrl: cfg.dshBaseUrl,
        apiKey: dshKey,
        timeoutMs: 300000,
        jsonMode: cfg.dshJsonMode === true,
      },
    };
    const models = { llm: { connection: 'dsh', model } };
    if (supportsImage) models.vision = { connection: 'dsh', model };

    const asrKey = withAsr ? await resolveAsrKey(cfg) : undefined;
    if (asrKey) {
      connections.asr = {
        type: 'openai-compatible',
        baseUrl: cfg.asrBaseUrl,
        apiKey: asrKey,
        timeoutMs: 600000,
        jsonMode: false,
      };
      models.asr = { connection: 'asr', model: cfg.asrModel };
    } else if (withAsr) {
      notes.push(
        `ASR 不可用：未取得 ${cfg.asrApiKeyRef} 凭据，也没有可回退的 Seeit 配置。`
        + '无原字幕的视频将只能使用简介/弹幕等文字证据。',
      );
    }

    notes.push(
      `模型路由：LLM=${provider}/${model}，`
      + `视觉=${supportsImage ? `${provider}/${model}` : '关闭'}，`
      + `ASR=${asrKey ? cfg.asrModel : '关闭'}。`,
    );
    return { providerConfig: { schemaVersion: 1, connections, models }, notes };
  }

  const runtimes = new Map();
  const runtime = (withAsr = true) => {
    const key = JSON.stringify([withAsr, current(), ctx.agentDefaultModel.currentSelection()]);
    if (!runtimes.has(key)) {
      const cfg = current();
      const seeitRoot = cfg.seeitRoot?.trim() || 'C:/Users/14506/Desktop/Seeit';
      const built = (async () => {
        const prepared = await buildProviderConfig(cfg, withAsr);
        return createSeeitRuntime({
          seeitRoot,
          dataDir: cfg.dataDir?.trim() || join(seeitRoot, 'data'),
          providerConfig: prepared.providerConfig,
          notes: prepared.notes,
          ffmpegPath: cfg.ffmpegPath,
          ffprobePath: cfg.ffprobePath,
          bilibiliAccountFile: cfg.bilibiliAccountFile,
          bilibiliMaxDownloadMb: cfg.bilibiliMaxDownloadMb,
          bilibiliMaxVideoMinutes: cfg.bilibiliMaxVideoMinutes,
        });
      })().catch((error) => {
        runtimes.delete(key);
        throw error;
      });
      runtimes.set(key, built);
    }
    return runtimes.get(key);
  };

  const register = (toolName, description, parameters, run) => ctx.tools.register({
    name: toolName,
    description,
    parameters,
    output: TOOL_OUTPUT,
    execute: async (args, exec = {}) => {
      let active = await runtime();
      let value;
      try {
        value = await active.withSignal(exec.signal, () => run(active, args ?? {}, exec));
      } catch (error) {
        if (toolName !== 'video_process' || !isAsrFailure(error)) throw explain(error);
        active = await runtime(false);
        active.notes.push(
          `ASR 调用失败，已降级为无字幕处理：${String(error.message).slice(0, 300)}`,
        );
        value = await active.withSignal(exec.signal, () => run(active, args ?? {}, exec));
      }
      return active.notes?.length ? `${active.notes.join('\n')}\n\n${value}` : value;
    },
  });

  ctx.effect(() => register(
    'video_process',
    '阅读本地视频或 B站视频链接/BV/av/短链并建立持久化理解：优先字幕，无字幕用 ASR，必要时按预算抽帧。返回 videoId，供 video_summarize / video_ask 复用。注意 videoContentRead=false 表示尚无视频内容证据。',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本地绝对路径，或 B站视频链接、BV/av号、b23.tv 分享文本；链接支持 ?p=2。' },
        videoId: { type: 'string', description: '稳定的持久化 ID；省略时由文件路径派生。' },
        instruction: { type: 'string', description: '处理时的关注点，例如“重点关注图表和排名变化”。' },
        force: { type: 'boolean', description: '重建派生理解；原始证据与已有缓存保留。' },
        noPerception: { type: 'boolean', description: '禁用本次处理阶段的视觉感知；后续问答仍可局部回看。' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    videoProcess,
  ));

  ctx.effect(() => register(
    'video_summarize',
    '只读取已持久化的视频理解生成总结，不重新打开视频、不重新抽帧。',
    {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: 'video_process 返回的 videoId。' },
        instruction: { type: 'string', description: '覆盖默认总结格式，例如“用三条要点说明排名变化”。' },
      },
      required: ['videoId'],
      additionalProperties: false,
    },
    videoSummarize,
  ));

  ctx.effect(() => register(
    'video_ask',
    '基于已持久化的视频理解与时间线证据回答问题；证据不足时按有限预算执行局部回看，并返回可靠性、证据与缺失信息。',
    {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: 'video_process 返回的 videoId。' },
        question: { type: 'string', description: '关于视频的问题，例如“3:20 发生了什么？”。' },
      },
      required: ['videoId', 'question'],
      additionalProperties: false,
    },
    videoAsk,
  ));
}
