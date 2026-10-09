import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { staticSettings, validateMountRecord } from '../server/nas-static.mjs';

const execute = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('Static SMB mounts require macOS');
const settings = staticSettings();
for (const kind of ['publish', 'serve']) {
  const mount = settings[kind + 'Mount'];
  const readonly = kind === 'serve';
  const source = readonly ? settings.serveSource : settings.source;
  const { stdout } = await execute('/sbin/mount');
  if (stdout.includes(` on ${mount} (`)) {
    validateMountRecord(stdout, mount, source, readonly);
    continue;
  }
  await mkdir(dirname(mount), { recursive: true, mode: 0o700 });
  await mkdir(mount, { mode: 0o500 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(mount);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (await readdir(mount)).length) throw new Error('Refusing an unsafe or nonempty mount point');
  // An unmounted stub is not writable, so a lost mount cannot fill the Mac.
  await chmod(mount, 0o500);
  if (readonly) await mkdir(settings.publishMount + '/music', { recursive: false, mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const flags = ['nobrowse', 'nopassprompt', 'nodev', 'nosuid', 'noexec', 'soft', ...(readonly ? ['ro'] : [])];
  try { await execute('/sbin/mount', ['-t', 'smbfs', '-o', flags.join(','), source, mount], { timeout: 20_000 }); }
  catch { throw new Error(`NAS ${kind} mount unavailable; reconnect the existing authenticated SMB session`); }
  validateMountRecord((await execute('/sbin/mount')).stdout, mount, source, readonly);
  console.log(JSON.stringify({ mounted: kind, readonly }));
}
