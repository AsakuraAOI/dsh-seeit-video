import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBilibiliResolver, download } from '@local/dsh-bilibili/media';
import { BilibiliClient } from '@local/dsh-bilibili/client';
import { videoProcess } from '../src/tools.js';

const seeit = await import(pathToFileURL(join(process.env.SEEIT_ROOT || 'C:/Users/14506/Desktop/Seeit', 'dist/index.js')).href);
const BV = 'BV1xx411c7mD', id = `bilibili-${BV}-p1`;
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(),'seeit-bili-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const storage = new seeit.VideoStorage(dir), requests=[];
  const fetcher = async (url, init) => {
    requests.push({url,init});
    const path = new URL(url).pathname;
    const ok = data => Response.json({code:0,data});
    if(path==='/x/web-interface/view') return ok({bvid:BV,aid:1,title:'字幕演示',desc:'介绍主题',pages:[{page:1,cid:2,duration:60}]});
    if(path==='/x/web-interface/nav') return ok({wbi_img:{img_url:'https://i0.hdslb.com/abcdefghijklmnopqrstuvwxyz012345.png',sub_url:'https://i0.hdslb.com/012345abcdefghijklmnopqrstuvwxyz.png'}});
    if(path.includes('/player/') && !path.endsWith('playurl')) return ok({subtitle:{subtitles: options.noSubtitle ? [] : [{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/sub.json'}]}});
    if(path==='/sub.json') return Response.json({body:[{from:0,to:60,content:'这是完整的语音内容，介绍项目的三个主要步骤。'}]});
    if(path.endsWith('playurl')) return ok({durl:[{url:'https://cdn.bilivideo.com/video.mp4'}]});
    if(path==='/video.mp4') return new Response('FAKE-MP4-BYTES');
    throw new Error('unexpected request '+url);
  };
  const runner={run:async()=>{throw new Error('unexpected ffmpeg');}};
  const resolver=createBilibiliResolver({seeit,storage,commandRunner:runner,fetcher,...options});
  return {dir,storage,resolver,requests};
}
test('real Seeit adapter persists Bilibili subtitles, local video ref and reusable understanding',async t=>{
  const f=await fixture(t,{asrProvider:{transcribe:()=>assert.fail('original subtitles must skip ASR')}});
  const llm=new seeit.FakeLLMProvider({text:JSON.stringify({videoId:id,overview:'三个主要步骤',contentType:'talk',sections:[{start:0,end:60,summary:'项目介绍',importance:0.8,evidence:[{type:'subtitle',start:0,end:60}]}]})});
  const system=new seeit.VideoUnderstandingSystem({ingest:new seeit.MediaIngestService([new seeit.BilibiliVideoIngestor(f.resolver)]),storage:f.storage,llm,frameSampler:{sample:()=>assert.fail('no visual pass')},frameExtractor:{extractFrames:()=>assert.fail('no extraction')}});
  const source={kind:'bilibili',uri:BV,videoId:id};
  const result=await system.process(source,{perceptionEnabled:false});
  assert.equal(result.overview,'三个主要步骤');
  assert.equal((await f.storage.readTranscript(id)).source,'original');
  const metadata=await f.storage.readMetadata(id); assert.equal(metadata.source.kind,'bilibili');
  assert.equal((await stat(metadata.metadata.videoRef)).size,14);
  const before=f.requests.length; await system.process(source); assert.equal(f.requests.length,before); assert.equal(llm.requests.length,1);
  const text=await videoProcess({system,storage:f.storage},{path:metadata.metadata.videoRef,videoId:id});
  assert.match(text,/videoContentRead: true/); assert.match(text,new RegExp(BV));
  assert.equal(f.requests.find(r=>r.url.includes('cdn.bilivideo.com')).init.headers.Cookie,undefined);
});
test('missing subtitles enter existing Seeit ASR audio extraction and label ASR evidence',async t=>{
  const f=await fixture(t,{noSubtitle:true,asrProvider:{transcribe:async()=>({cues:[{start:0,end:60,content:'ASR内容'}]})},commandRunner:{run:async(_cmd,args)=>{await writeFile(args.at(-1),'audio');return {exitCode:0,stdout:'',stderr:''};}}});
  const result=await f.resolver.ingestBilibili({kind:'bilibili',uri:BV});
  assert.equal(result.transcript.source,'asr'); assert.equal(result.transcript.cues[0].content,'ASR内容');
});
test('streamed media download enforces actual bytes and removes incomplete file',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'bili-download-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const client=new BilibiliClient({fetcher:async()=>new Response('1234567890')});
  const target=join(dir,'video.mp4');
  await assert.rejects(()=>download(client,'https://cdn.bilivideo.com/a.mp4',target,5),{code:'VIDEO_TOO_LARGE'});
  await assert.rejects(()=>readFile(target),{code:'ENOENT'});await assert.rejects(()=>readFile(target+'.partial'),{code:'ENOENT'});
});
test('metadata-only Seeit results explicitly report no video content evidence',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'seeit-tool-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'v.mp4');await writeFile(file,'x');
  const runtime={system:{process:async()=>({videoId:'v',overview:'标题',contentType:'general',sections:[]})},storage:{readTranscript:async()=>undefined,readTimeline:async()=>({items:[{type:'description',content:'标题'}]}),readMetadata:async()=>({})}};
  assert.match(await videoProcess(runtime,{path:file}),/videoContentRead: false/);
});
