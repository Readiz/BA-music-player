import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { validateCatalog } from './catalog.mjs';
import { publishNasStatic, staticSettings, verifyNasStatic } from './nas-static.mjs';

export const METADATA_FILES = ['musicList.json', 'imported-tracks.json', 'waveforms.json', 'blue-archive-ost.json'];
const sha = data => createHash('sha256').update(data).digest('hex');
const revisionPattern = /^[a-f0-9]{40}$/;

export function librarySettings(env = process.env) {
  return {
    root: resolve(env.MUSIC_LIBRARY_ROOT || join(homedir(), '.local/share/readiz-music/library')),
    nasRoot: resolve(env.MUSIC_NAS_ROOT || '/Volumes/readiz_private/cl_backup/readiz-music'),
    nasMount: resolve(env.MUSIC_NAS_MOUNT || '/Volumes/readiz_private'),
    requireMount: true,
    static: staticSettings(env),
  };
}

export function audioPath(src) {
  if (typeof src !== 'string' || !src.startsWith('./music/')) throw new Error('Invalid audio path');
  const path = decodeURIComponent(src.slice(2));
  const parts = path.split('/');
  if (parts.length < 3 || parts[0] !== 'music' || parts.some(part => !part || part === '.' || part === '..')
    || /[\\\x00-\x1f\x7f?#]/.test(path) || !/\.(mp3|ogg|m4a)$/i.test(path)) throw new Error('Invalid audio path');
  return path;
}

export async function hashFile(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function assertNasMounted(options) {
  const { nasRoot, nasMount, requireMount = true } = options;
  if (!requireMount) return;
  if (!nasRoot.startsWith(nasMount + sep)) throw new Error('NAS backup must be inside the configured mounted share');
  const [volume, parent] = await Promise.all([stat(nasMount), stat(dirname(nasMount))]);
  if (volume.dev === parent.dev || await realpath(nasMount) !== nasMount) throw new Error('NAS share is not mounted; existing library is preserved');
}

async function lock(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, '.publish.lock');
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = JSON.parse(await readFile(path, 'utf8'));
    if (!Number.isInteger(prior.pid)) throw new Error('Library publication is locked');
    try { process.kill(prior.pid, 0); throw new Error('Library publication is already running'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    await rm(path);
    handle = await open(path, 'wx', 0o600);
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  return async () => { await handle.close(); await rm(path, { force: true }); };
}

async function atomicJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

async function switchCurrent(root, revision) {
  const next = join(root, `current.${randomUUID()}.next`);
  try { await symlink(join(root, 'snapshots', revision), next); await rename(next, join(root, 'current')); }
  finally { await rm(next, { force: true }); }
}

function objectPath(root, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid object hash');
  return join(root, 'objects', hash.slice(0, 2), hash);
}

async function installObject(source, target, expected, signal) {
  signal?.throwIfAborted();
  if (await exists(target)) {
    if ((await stat(target)).size !== expected.bytes || await hashFile(target, signal) !== expected.sha256) throw new Error('Stored audio checksum mismatch');
    return;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    if ((await stat(temporary)).size !== expected.bytes || await hashFile(temporary, signal) !== expected.sha256) throw new Error('Copied audio checksum mismatch');
    signal?.throwIfAborted();
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

function validateMetadata(metadata) {
  const catalog = metadata['musicList.json'];
  const imported = metadata['imported-tracks.json'];
  const waveforms = metadata['waveforms.json'];
  validateCatalog(imported, catalog, waveforms);
  if (!catalog.length || new Set(catalog).size !== catalog.length) throw new Error('Empty or duplicate library catalog');
  const paths = new Set();
  for (const src of catalog) {
    const path = audioPath(src);
    if (paths.has(path)) throw new Error('Aliased audio path');
    paths.add(path);
    const waveform = waveforms[src];
    if (!(waveform?.duration > 0) || waveform.peaks?.length !== 480
      || !waveform.peaks.every(peak => Number.isFinite(peak) && peak >= 0)) throw new Error('Missing audio waveform');
  }
}

function snapshotIdentity(metadata, files) {
  return sha(JSON.stringify({ metadata, files })).slice(0, 40);
}

export async function readMetadata(root) {
  const entries = await Promise.all(METADATA_FILES.map(async name => [name, JSON.parse(await readFile(join(root, name), 'utf8'))]));
  const metadata = Object.fromEntries(entries);
  validateMetadata(metadata);
  return metadata;
}

async function publishUnlocked(options) {
  const { root, nasRoot, sourceRoot, signal, onProgress = () => {}, audio = new Map() } = options;
  const metadata = options.metadata || await readMetadata(sourceRoot);
  validateMetadata(metadata);
  const imports = new Map(metadata['imported-tracks.json'].tracks.map(track => [track.src, track]));
  const files = [];
  onProgress('testing');
  for (const src of metadata['musicList.json']) {
    signal?.throwIfAborted();
    const path = audioPath(src);
    const source = audio.get(src) || join(sourceRoot, path);
    if (!(await lstat(source)).isFile()) throw new Error('Audio source must be a regular file');
    const file = { src, path, bytes: (await stat(source)).size, sha256: await hashFile(source, signal) };
    const imported = imports.get(src);
    if (!file.bytes || (imported && (file.bytes !== imported.bytes || file.sha256 !== imported.sha256))) throw new Error('Audio does not match imported metadata');
    await installObject(source, objectPath(root, file.sha256), file, signal);
    files.push(file);
  }
  const revision = snapshotIdentity(metadata, files);
  const createdAt = new Date().toISOString();
  const snapshot = { schemaVersion: 1, revision, createdAt, trackCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
  onProgress('backing-up');
  await assertNasMounted(options);
  await mkdir(join(nasRoot, 'snapshots'), { recursive: true, mode: 0o700 });
  for (const file of files) await installObject(objectPath(root, file.sha256), objectPath(nasRoot, file.sha256), file, signal);
  // Backups hold immutable objects and small catalogs, so additions do not duplicate the library.
  const backup = join(nasRoot, 'snapshots', revision);
  if (!await exists(backup)) {
    const stage = join(nasRoot, 'snapshots', `.pending-${randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      for (const name of METADATA_FILES) await writeFile(join(stage, name), JSON.stringify(metadata[name], null, name === 'waveforms.json' ? undefined : 2) + '\n');
      await atomicJson(join(stage, 'snapshot.json'), snapshot);
      for (const name of METADATA_FILES) if (JSON.stringify(JSON.parse(await readFile(join(stage, name), 'utf8'))) !== JSON.stringify(metadata[name])) throw new Error('NAS catalog copy mismatch');
      signal?.throwIfAborted();
      await rename(stage, backup);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  const savedMetadata = await readMetadata(backup);
  const savedSnapshot = JSON.parse(await readFile(join(backup, 'snapshot.json'), 'utf8'));
  if (snapshotIdentity(savedMetadata, savedSnapshot.files) !== revision) throw new Error('NAS catalog verification failed');
  await assertNasMounted(options);
  await atomicJson(join(nasRoot, 'current.json'), { schemaVersion: 1, revision, verifiedAt: createdAt });
  // Publish the Mac catalog only after every referenced NAS object is verified.
  onProgress('publishing');
  await mkdir(join(root, 'snapshots'), { recursive: true, mode: 0o700 });
  const target = join(root, 'snapshots', revision);
  if (!await exists(target)) {
    const stage = join(root, 'snapshots', `.pending-${randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      for (const file of files) {
        const destination = join(stage, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await link(objectPath(root, file.sha256), destination);
      }
      for (const name of METADATA_FILES) await writeFile(join(stage, name), JSON.stringify(metadata[name], null, name === 'waveforms.json' ? undefined : 2) + '\n');
      await writeFile(join(stage, 'lastUpdated.txt'), createdAt + '\n');
      await atomicJson(join(stage, 'snapshot.json'), snapshot);
      await writeFile(join(stage, 'library-info.json'), JSON.stringify({ schemaVersion: 1, revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, publishedAt: createdAt, backupVerifiedAt: createdAt, serving: 'mac', backup: 'nas' }, null, 2) + '\n');
      signal?.throwIfAborted();
      await rename(stage, target);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  if (snapshotIdentity(await readMetadata(target), JSON.parse(await readFile(join(target, 'snapshot.json'), 'utf8')).files) !== revision) throw new Error('Mac catalog verification failed');
  if (options.static) {
    await publishNasStatic({ settings: options.static, root, snapshot, signal, onProgress });
    await atomicJson(join(target, 'library-info.json'), { schemaVersion: 1, revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, publishedAt: createdAt, backupVerifiedAt: createdAt, serving: 'nas-via-mac', backup: 'mac-and-nas' });
  }
  await assertNasMounted(options);
  await switchCurrent(root, revision);
  await atomicJson(join(root, 'backup-status.json'), { revision, verifiedAt: createdAt, trackCount: snapshot.trackCount, bytes: snapshot.bytes });
  return { revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, backupVerifiedAt: createdAt };
}

export async function publishLibrary(options) {
  await assertNasMounted(options);
  const unlock = await lock(options.root);
  try { return await publishUnlocked(options); } finally { await unlock(); }
}

export async function updateLibrary(options, update) {
  await assertNasMounted(options);
  const unlock = await lock(options.root);
  try {
    const sourceRoot = join(options.root, 'current');
    const metadata = await readMetadata(sourceRoot);
    const additions = await update(metadata);
    return await publishUnlocked({ ...options, sourceRoot, metadata, ...additions });
  } finally { await unlock(); }
}

export async function verifyLibrary(options) {
  await assertNasMounted(options);
  const current = join(options.root, 'current');
  const snapshot = JSON.parse(await readFile(join(current, 'snapshot.json'), 'utf8'));
  if (!revisionPattern.test(snapshot.revision)) throw new Error('Invalid library snapshot');
  const metadata = await readMetadata(current);
  if (snapshotIdentity(metadata, snapshot.files) !== snapshot.revision) throw new Error('Snapshot identity mismatch');
  const backup = join(options.nasRoot, 'snapshots', snapshot.revision);
  const backupMetadata = await readMetadata(backup);
  const backupSnapshot = JSON.parse(await readFile(join(backup, 'snapshot.json'), 'utf8'));
  if (snapshotIdentity(backupMetadata, backupSnapshot.files) !== snapshot.revision) throw new Error('NAS snapshot mismatch');
  for (const file of snapshot.files) {
    options.signal?.throwIfAborted();
    const path = audioPath(file.src);
    if (path !== file.path) throw new Error('Invalid inventory path');
    for (const filename of [join(current, path), objectPath(options.nasRoot, file.sha256)]) {
      if ((await stat(filename)).size !== file.bytes || await hashFile(filename, options.signal) !== file.sha256) throw new Error('Library verification failed');
    }
  }
  const serving = options.static ? await verifyNasStatic(options.static, snapshot, options.signal) : undefined;
  return { revision: snapshot.revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, mac: 'verified', nas: 'verified', ...(serving ? { nasStatic: serving } : {}) };
}

export async function restoreLibrary(options, revision) {
  await assertNasMounted(options);
  if (!revision) revision = JSON.parse(await readFile(join(options.nasRoot, 'current.json'), 'utf8')).revision;
  if (!revisionPattern.test(revision)) throw new Error('Invalid restore revision');
  const backup = join(options.nasRoot, 'snapshots', revision);
  const metadata = await readMetadata(backup);
  const snapshot = JSON.parse(await readFile(join(backup, 'snapshot.json'), 'utf8'));
  if (snapshotIdentity(metadata, snapshot.files) !== revision) throw new Error('Backup identity mismatch');
  const audio = new Map();
  for (const file of snapshot.files) {
    if (audioPath(file.src) !== file.path) throw new Error('Invalid backup inventory');
    const path = objectPath(options.nasRoot, file.sha256);
    if ((await stat(path)).size !== file.bytes || await hashFile(path, options.signal) !== file.sha256) throw new Error('Backup audio checksum mismatch');
    audio.set(file.src, path);
  }
  return publishLibrary({ ...options, metadata, audio });
}
