import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { MUSIC_LIBRARY } from './catalog.mjs';
import { ImportError } from './imports.mjs';
import { hashFile, librarySettings, updateLibrary } from './library.mjs';
import { mediaIdentity } from './media-identity.mjs';
import { createWaveform } from './waveforms.mjs';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);

export async function verifyPublishedTrack({ track, waveform, signal, fetcher = fetch, base = MUSIC_LIBRARY, pause = delay }) {
  const get = async (file, headers) => {
    const url = new URL(file, base);
    url.searchParams.set('sync', Date.now().toString());
    const response = await fetcher(url, { headers, cache: 'no-store', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90_000)]) });
    if (!response.ok) throw new Error('Music publication is not ready');
    return response;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    try {
      const [manifest, catalog, waves] = await Promise.all(['imported-tracks.json', 'musicList.json', 'waveforms.json'].map(async name => (await get(name)).json()));
      const visible = manifest.tracks?.find(item => item.src === track.src);
      if (visible?.sha256 !== track.sha256 || visible?.title !== track.title || !catalog.includes(track.src)
        || JSON.stringify(waves[track.src]) !== JSON.stringify(waveform)) throw new Error('Published catalog mismatch');
      const response = await get(track.src);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > track.bytes) throw new Error('Published audio exceeds expected size');
        hash.update(chunk);
      }
      if (bytes !== track.bytes || hash.digest('hex') !== track.sha256) throw new Error('Published audio checksum mismatch');
      const range = await get(track.src, { Range: 'bytes=0-1023' });
      if (range.status !== 206 || !range.headers.get('content-range')?.endsWith('/' + track.bytes)
        || (await range.arrayBuffer()).byteLength !== Math.min(1024, track.bytes)) throw new Error('Published audio range is unavailable');
      return visible;
    } catch (error) {
      if (signal?.aborted || attempt === 2) throw error;
      await pause(1000, undefined, { signal });
    }
  }
}

export function createLocalSync({ settings = librarySettings(), ffmpeg = process.env.MUSIC_FFMPEG || '/opt/homebrew/bin', prepareWaveform = createWaveform, verify = verifyPublishedTrack } = {}) {
  return async ({ video, result, signal, saveCheckpoint = () => {}, onProgress = () => {} }) => {
    const identity = mediaIdentity(video.id);
    const title = String(result.title).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) throw new Error('Missing music title');
    const prepared = join(dirname(result.path), `${randomUUID()}.prepared.mp3`);
    let track, waveform;
    try {
      onProgress('preparing');
      // Preserve the encoded audio and install clean tags without another lossy conversion.
      await execute(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-i', result.path, '-map', '0:a:0', '-c:a', 'copy', '-map_metadata', '-1', '-metadata', `title=${title}`, '-metadata', 'artist=ETC', prepared], { signal, timeout: 120_000 });
      onProgress('waveform');
      waveform = await prepareWaveform(prepared, { signal, ffmpeg });
      track = { src: `./music/ETC/${identity.filename}`, title, folder: 'ETC', artist: 'ETC',
        ...(identity.kind === 'youtube' ? { sourceUrl: `https://www.youtube.com/watch?v=${video.id}` } : { sourceType: 'upload' }),
        duration: waveform.duration, bytes: (await stat(prepared)).size, sha256: await hashFile(prepared, signal) };
      let published;
      try {
        published = await updateLibrary({ ...settings, signal, onProgress }, async metadata => {
          const manifest = metadata['imported-tracks.json'];
          manifest.tracks = [...manifest.tracks.filter(item => item.src !== track.src), track].sort((a, b) => a.src.localeCompare(b.src));
          if (!metadata['musicList.json'].includes(track.src)) metadata['musicList.json'].push(track.src);
          metadata['waveforms.json'][track.src] = waveform;
          return { audio: new Map([[track.src, prepared]]) };
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ImportError('백업이나 공개 반영을 완료하지 못했습니다. 준비한 음악은 보관됩니다. 같은 링크나 파일로 다시 요청해 주세요.', 503);
      }
      saveCheckpoint({ libraryRevision: published.revision });
      onProgress('verifying');
      const visible = await verify({ track, waveform, signal });
      return { revision: published.revision, track: visible };
    } finally { await rm(prepared, { force: true }); }
  };
}
