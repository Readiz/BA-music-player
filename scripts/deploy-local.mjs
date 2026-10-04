import { readAndroidRelease } from './android-release.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('Commit intended changes before deploying.');
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const build = JSON.parse(readFileSync('dist/app-config.json', 'utf8'));
if (build.dirty || build.revision !== revision) throw new Error('Rebuild the clean current commit before deploying.');
readAndroidRelease('dist/app.apk', 'dist/android-update.json');
const root = resolve(process.env.MUSIC_DEPLOY_ROOT || '/opt/homebrew/var/www/readiz-music');
mkdirSync(`${root}/releases`, { recursive: true });
const release = `${root}/releases/${Date.now()}-${revision.slice(0, 12)}`;
cpSync('dist', release, { recursive: true });
const previous = existsSync(`${root}/current`) ? readlinkSync(`${root}/current`) : null;
const next = `${root}/current.next`;
rmSync(next, { force: true });
symlinkSync(release, next);
renameSync(next, `${root}/current`);
console.log(JSON.stringify({ release, previous, revision, tracks: build.trackCount }, null, 2));
