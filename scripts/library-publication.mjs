import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { audioPath, readMetadata } from '../server/library.mjs';

export async function prepareLibraryPublication({ repo, liveRoot, liveMetadata }) {
  const metadata = await readMetadata(repo);
  const live = liveMetadata || (liveRoot ? await readMetadata(liveRoot) : undefined);
  const audio = new Map();
  if (live) {
    for (const src of live['musicList.json']) if (!metadata['musicList.json'].includes(src)) {
      metadata['musicList.json'].push(src);
      metadata['waveforms.json'][src] = live['waveforms.json'][src];
    }
    for (const track of live['imported-tracks.json'].tracks) {
      if (!metadata['imported-tracks.json'].tracks.some(item => item.src === track.src)) metadata['imported-tracks.json'].tracks.push(track);
    }
  }
  const liveTracks = new Set(live?.['musicList.json'] || []);
  for (const src of metadata['musicList.json']) {
    const path = audioPath(src);
    try {
      if (!(await lstat(join(repo, path))).isFile()) throw new Error('Prepared audio must be a regular file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!liveRoot || !liveTracks.has(src)) throw new Error('Audio is managed outside Git. Run npm run library:restore before publishing, or prepare the new track locally.');
      audio.set(src, join(liveRoot, path));
    }
  }
  return { sourceRoot: repo, metadata, audio };
}
