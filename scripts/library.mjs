import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioPath, librarySettings, publishLibrary, readMetadata, restoreLibrary, verifyLibrary } from '../server/library.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const options = librarySettings();
const command = process.argv[2] || 'verify';
if (command === 'publish') {
  const metadata = await readMetadata(repo);
  const audio = new Map();
  // A source-code deployment must not erase songs already added through the live importer.
  let current;
  try { current = await realpath(join(options.root, 'current')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current) {
    const live = await readMetadata(current);
    for (const src of live['musicList.json']) if (!metadata['musicList.json'].includes(src)) {
      metadata['musicList.json'].push(src);
      metadata['waveforms.json'][src] = live['waveforms.json'][src];
      audio.set(src, join(current, audioPath(src)));
    }
    for (const track of live['imported-tracks.json'].tracks) if (!metadata['imported-tracks.json'].tracks.some(item => item.src === track.src)) metadata['imported-tracks.json'].tracks.push(track);
  }
  console.log(JSON.stringify(await publishLibrary({ ...options, sourceRoot: repo, metadata, audio, onProgress: stage => console.log(stage) }), null, 2));
} else if (command === 'verify') {
  console.log(JSON.stringify(await verifyLibrary(options), null, 2));
} else if (command === 'restore') {
  console.log(JSON.stringify(await restoreLibrary(options, process.argv[3]), null, 2));
} else throw new Error('Use library.mjs publish, verify, or restore [revision]');
