import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { staticSettings, validateMountRecord } from '../server/nas-static.mjs';

const execute = promisify(execFile);
const keychainHelper = fileURLToPath(new URL('mount-static-keychain', import.meta.url));

export async function mountStatic({ settings = staticSettings(), run = execute, helper = keychainHelper } = {}) {
  for (const kind of ['publish', 'serve']) {
    const mount = settings[kind + 'Mount'];
    const readonly = kind === 'serve';
    const source = readonly ? settings.serveSource : settings.source;
    const { stdout } = await run('/sbin/mount', [], { timeout: 3000 });
    if (stdout.includes(` on ${mount} (`)) {
      validateMountRecord(stdout, mount, source, readonly);
      continue;
    }
    await mkdir(dirname(mount), { recursive: true, mode: 0o700 });
    await mkdir(mount, { mode: 0o500 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(mount);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (await readdir(mount)).length) throw new Error('Refusing an unsafe or nonempty mount point');
    // A lost mount must never become a writable local audio directory.
    await chmod(mount, 0o500);
    if (readonly) {
      validateMountRecord((await run('/sbin/mount', [], { timeout: 3000 })).stdout, settings.publishMount, settings.source, false);
      // Publication owns creation of the music directory; recovery only reads it.
      const music = await lstat(settings.publishMount + '/music');
      if (!music.isDirectory() || music.isSymbolicLink()) throw new Error('NAS music directory is unavailable');
    }
    const flags = ['nobrowse', 'nopassprompt', 'nodev', 'nosuid', 'noexec', 'soft', ...(readonly ? ['ro'] : [])];
    try {
      await run('/sbin/mount', ['-t', 'smbfs', '-o', flags.join(','), source, mount], { timeout: 20_000 });
    } catch {
      // mount_smbfs can reuse a live session but cannot restore Finder's saved
      // credentials after reboot. NetAuth can, without exposing them to Node.
      try { await run(helper, [kind, mount], { timeout: 25_000 }); }
      catch { throw new Error(`NAS ${kind} mount unavailable; unlock the login Keychain or reconnect NAS in Finder and save its password`); }
    }
    validateMountRecord((await run('/sbin/mount', [], { timeout: 3000 })).stdout, mount, source, readonly);
    console.log(JSON.stringify({ mounted: kind, readonly }));
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') throw new Error('Static SMB mounts require macOS');
  try { await mountStatic(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
