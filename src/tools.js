import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BilibiliClient, isBilibiliInput } from '@local/dsh-bilibili/client';

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '?';
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${(total - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * Ingest one local video and build its persistent understanding. Seeit decides
 * whether any vision call is needed at all; `noPerception` only disables the
 * process-time pass and leaves later QA look-back available.
 */
export async function videoProcess(runtime, args, exec = {}) {
  const requested = requireString(args.path, 'path');
  const bilibili = isBilibiliInput(requested);
  const videoPath = bilibili ? requested : resolve(requested);
  if (!bilibili && !existsSync(videoPath)) {
    throw new Error(`视频文件不存在：${videoPath}`);
  }
  let videoId = optionalString(args.videoId);
  let source = { kind: 'local', uri: videoPath, ...(videoId ? { videoId } : {}) };
  if (bilibili) {
    const client = new BilibiliClient({ accountFile: runtime.bilibiliAccountFile || undefined, signal: exec.signal });
    const video = await client.resolveVideo(requested);
    videoId ||= video.videoId;
    source = { kind: 'bilibili', uri: video.url, videoId };
  }
  const instruction = optionalString(args.instruction);
  const understanding = await runtime.system.process(
    source,
    {
      ...(args.force === true ? { force: true } : {}),
      ...(instruction ? { instruction } : {}),
      ...(args.noPerception === true ? { perceptionEnabled: false } : {}),
    },
  );
  const transcript = await runtime.storage.readTranscript(understanding.videoId);
  const timeline = await runtime.storage.readTimeline(understanding.videoId);
  const metadata = await runtime.storage.readMetadata(understanding.videoId);
  return formatUnderstanding(understanding, transcript, timeline, metadata);
}

/** Summaries read only the persisted understanding; the video is not reopened. */
export async function videoSummarize(runtime, args) {
  const videoId = requireString(args.videoId, 'videoId');
  return runtime.system.summarize(videoId, optionalString(args.instruction));
}

/** QA answers from persisted evidence and reports reliability and citations. */
export async function videoAsk(runtime, args) {
  const videoId = requireString(args.videoId, 'videoId');
  const question = requireString(args.question, 'question');
  return formatAnswer(await runtime.system.ask(videoId, question));
}

function formatUnderstanding(understanding, transcript, timeline, metadata) {
  const contentRead = Boolean(transcript?.cues?.length || timeline?.items?.some(item => ['frame','clip','ocr'].includes(item.type)));
  const lines = [
    `videoId: ${understanding.videoId}`,
    `status: ${understanding.status ?? 'base'}`,
    `contentType: ${understanding.contentType}`,
    `videoContentRead: ${contentRead}`,
  ];
  if (metadata?.source?.kind === 'bilibili') lines.push(`source: ${metadata.source.uri}`);
  for (const note of metadata?.metadata?.ingestWarnings || []) lines.push(`读取提示：${note}`);
  if (!contentRead) lines.push('证据不足：当前仅有标题/简介等元数据，不能声称已理解视频内容。');
  lines.push(
    transcript
      ? `transcript: ${transcript.source ?? 'unknown'}（${transcript.cues?.length ?? 0} 条）`
      : 'transcript: 无（未找到原字幕，且未配置 ASR）',
  );
  lines.push('', 'overview:', understanding.overview);

  const sections = understanding.sections ?? [];
  if (sections.length) {
    lines.push('', `sections (${sections.length}):`);
    for (const section of sections) {
      lines.push(`- [${formatTime(section.start)}-${formatTime(section.end)}] ${section.summary}`);
      if (section.visual) lines.push(`  视觉：${section.visual}`);
    }
  }

  const unresolved = understanding.unresolved ?? [];
  if (unresolved.length) {
    lines.push('', `未解决 (${unresolved.length}):`);
    for (const item of unresolved) lines.push(`- ${item.question}（${item.reason}）`);
  }
  return lines.join('\n');
}

function formatAnswer(result) {
  const lines = [
    `reliable: ${result.reliable === true}`,
    `usedPerception: ${result.usedPerception === true}`,
    '',
    result.answer,
  ];
  if (result.missingInformation) lines.push('', `缺失信息：${result.missingInformation}`);

  const evidence = result.evidence ?? [];
  if (evidence.length) {
    lines.push('', `证据 (${evidence.length}):`);
    for (const item of evidence) {
      const range = Number.isFinite(item.start)
        ? ` @${formatTime(item.start)}${Number.isFinite(item.end) ? `-${formatTime(item.end)}` : ''}`
        : '';
      lines.push(`- ${item.type}${range}${item.ref ? ` ${item.ref}` : ''}`);
    }
  }
  return lines.join('\n');
}
