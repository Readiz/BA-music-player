import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';

const execute = promisify(execFile);
const revisionPattern = /^[a-f0-9]{40}$/;
export function staticSettings(env = process.env) {
  const base = join(homedir(), '.local/share/readiz-static');
  return {
    publishMount: resolve(env.MUSIC_STATIC_PUBLISH_MOUNT || join(base, 'publish')),
    serveMount: resolve(env.MUSIC_STATIC_SERVE_MOUNT || join(base, 'serve')),
    source: '//readiz@192.168.0.5/readiz_static',
    serveSource: '//readiz@192.168.0.5/readiz_static/music',
    requireMount: true,
  };
}

export function validateMountRecord(output, mount, source, readonly) {
  const prefix = `${source} on ${mount} (`;
  const line = output.split('\n').find(line => line.startsWith(prefix));
  if (!line) throw new Error('The expected NAS static share is not mounted');
  const flags = line.slice(prefix.length).replace(/\)$/, '').split(', ');
  if (!flags.includes('smbfs') || flags.includes('read-only') !== readonly) throw new Error('NAS static mount permissions do not match');
}

export async function assertStaticMount(settings, kind) {
  const mount = settings[kind === 'publish' ? 'publishMount' : 'serveMount'];
  if (!settings.requireMount) return mount;
  const { stdout } = await execute('/sbin/mount', [], { timeout: 3000, maxBuffer: 128 * 1024 });
  validateMountRecord(stdout, mount, kind === 'serve' ? settings.serveSource : settings.source, kind === 'serve');
  const [volume, parent, actual] = await Promise.all([stat(mount), stat(dirname(mount)), realpath(mount)]);
  if (volume.dev === parent.dev || actual !== mount) throw new Error('NAS static mount is unavailable');
  return mount;
}

export function staticObject(file) {
  const extension = extname(file.path).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(file.sha256) || !['.mp3', '.ogg', '.m4a'].includes(extension)
    || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Invalid static audio object');
  return `${file.sha256.slice(0, 2)}/${file.sha256}${extension}`;
}

async function hashFile(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

async function regularFile(root, path, bytes) {
  const target = join(root, path);
  const actualRoot = await realpath(root);
  const actual = await realpath(target);
  if (!actual.startsWith(actualRoot + sep) || actual !== target || !(await lstat(target)).isFile()
    || (await stat(target)).size !== bytes) throw new Error('Static audio is missing, linked or changed');
  return target;
}

async function atomicJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// Only verified catalog audio enters this share. Objects are reused across revisions;
// SMB need not support hard links or symlinks, and no private backup tree is exposed.
export async function publishNasStatic({ settings, root, snapshot, signal, onProgress = () => {} }) {
  if (!revisionPattern.test(snapshot.revision)) throw new Error('Invalid static revision');
  await assertStaticMount(settings, 'publish');
  await assertStaticMount(settings, 'serve');
  const base = join(settings.publishMount, 'music');
  const objects = join(base, 'objects');
  await mkdir(objects, { recursive: true, mode: 0o700 });
  if (await realpath(objects) !== objects) throw new Error('Static object root cannot be linked');
  const space = await statfs(base);
  if (space.bavail * space.bsize < 1024 ** 3 + snapshot.bytes) throw new Error('Insufficient NAS publication space');
  onProgress('publishing-static');
  let copied = 0;
  for (const file of snapshot.files) {
    signal?.throwIfAborted();
    const relative = staticObject(file);
    const destination = join(objects, relative);
    await assertStaticMount(settings, 'publish');
    let present = false;
    try { await lstat(destination); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) {
      await regularFile(objects, relative, file.bytes);
      if (await hashFile(destination, signal) !== file.sha256) throw new Error('NAS static object checksum mismatch');
      continue;
    }
    const source = join(root, 'objects', file.sha256.slice(0, 2), file.sha256);
    if (!(await lstat(source)).isFile()) throw new Error('Static publication source must be a regular file');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(destination)) !== dirname(destination)) throw new Error('Static object directory cannot be linked');
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary);
      if ((await stat(temporary)).size !== file.bytes || await hashFile(temporary, signal) !== file.sha256) throw new Error('NAS static copy checksum mismatch');
      signal?.throwIfAborted();
      await assertStaticMount(settings, 'publish');
      await rename(temporary, destination);
      copied++;
    } finally { await rm(temporary, { force: true }); }
  }
  await assertStaticMount(settings, 'serve');
  const readObjects = join(settings.serveRoot || settings.serveMount, 'objects');
  for (const file of snapshot.files) await regularFile(readObjects, staticObject(file), file.bytes);
  const receipt = { schemaVersion: 1, revision: snapshot.revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, verifiedAt: new Date().toISOString(), files: snapshot.files };
  await mkdir(join(base, 'revisions'), { recursive: true, mode: 0o700 });
  await atomicJson(join(base, 'revisions', snapshot.revision + '.json'), receipt);
  await mkdir(join(root, 'static-revisions'), { recursive: true, mode: 0o700 });
  await atomicJson(join(root, 'static-revisions', snapshot.revision + '.json'), receipt);
  return { revision: snapshot.revision, trackCount: snapshot.trackCount, bytes: snapshot.bytes, copied };
}

export async function verifyNasStatic(settings, snapshot, signal) {
  await assertStaticMount(settings, 'serve');
  const objects = join(settings.serveRoot || settings.serveMount, 'objects');
  for (const file of snapshot.files) {
    const path = await regularFile(objects, staticObject(file), file.bytes);
    if (await hashFile(path, signal) !== file.sha256) throw new Error('NAS static verification failed');
  }
  return 'verified';
}

// Caddy calls this only on loopback. The mapping is taken from the exact current
// catalog, never from a user-supplied filesystem path or object hash.
export function createStaticResolver({ root, settings }) {
  let loadedRoot, files;
  return async request => {
    const response = (status, headers = {}) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
    if (!['GET', 'HEAD'].includes(request.headers.get('x-forwarded-method') || 'GET')) return response(405);
    let path;
    try {
      const uri = request.headers.get('x-forwarded-uri');
      if (!uri?.startsWith('/music/') || uri.startsWith('//')) return response(404);
      path = decodeURIComponent(uri.split('?')[0]).slice(1);
      if (path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/.test(path)) return response(404);
    } catch { return response(404); }
    try {
      const current = await realpath(join(root, 'current'));
      if (current !== loadedRoot) {
        const snapshot = JSON.parse(await readFile(join(current, 'snapshot.json'), 'utf8'));
        if (!revisionPattern.test(snapshot.revision)) throw new Error('Invalid snapshot');
        const receipt = JSON.parse(await readFile(join(root, 'static-revisions', snapshot.revision + '.json'), 'utf8'));
        if (receipt.revision !== snapshot.revision || JSON.stringify(receipt.files) !== JSON.stringify(snapshot.files)) throw new Error('Static publication is not verified');
        files = new Map(snapshot.files.map(file => [file.path, file]));
        loadedRoot = current;
      }
      const file = files.get(path);
      if (!file) return response(404);
      await assertStaticMount(settings, 'serve');
      const object = staticObject(file);
      await regularFile(join(settings.serveRoot || settings.serveMount, 'objects'), object, file.bytes);
      return response(200, { 'X-Readiz-Music-Object': object });
    } catch { return response(503, { 'Retry-After': '30' }); }
  };
}
