import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { librarySettings, publishLibrary, restoreLibrary, updateLibrary, verifyLibrary } from '../server/library.mjs';
import { prepareLibraryPublication } from './library-publication.mjs';
import { publishNasStatic } from '../server/nas-static.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const options = librarySettings();
const command = process.argv[2] || 'verify';
if (command === 'publish') {
  let current;
  try { current = await realpath(join(options.root, 'current')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const progress = { ...options, onProgress: stage => console.log(stage) };
  // Read and merge live additions while holding the publication lock.
  const result = current
    ? await updateLibrary(progress, liveMetadata => prepareLibraryPublication({ repo, liveRoot: join(options.root, 'current'), liveMetadata }))
    : await publishLibrary({ ...progress, ...await prepareLibraryPublication({ repo }) });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'stage-static') {
  const snapshot = JSON.parse(await readFile(join(options.root, 'current/snapshot.json'), 'utf8'));
  console.log(JSON.stringify(await publishNasStatic({ settings: options.static, root: options.root, snapshot, onProgress: stage => console.log(stage) }), null, 2));
} else if (command === 'verify') {
  console.log(JSON.stringify(await verifyLibrary(options), null, 2));
} else if (command === 'restore') {
  console.log(JSON.stringify(await restoreLibrary(options, process.argv[3]), null, 2));
} else throw new Error('Use library.mjs publish, stage-static, verify, or restore [revision]');
