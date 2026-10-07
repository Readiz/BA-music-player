import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (process.platform !== 'darwin') throw new Error('This launchd deployment is for macOS.');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit intended changes before deploying.');
const home = homedir();
const root = join(home, '.local/share/readiz-music');
const authPath = join(home, '.config/readiz-music/discord-auth.json');
const command = join(root, 'downloader/bin/yt-dlp');
if (!existsSync(authPath) || !existsSync(command)) throw new Error('Set up music Discord configuration and yt-dlp first; see ops/README.md.');
if (!existsSync(join(root, 'library/current/library-info.json'))) throw new Error('Publish and verify the Mac/NAS library before deploying the API.');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const release = join(root, 'api-releases', `${Date.now()}-${revision.slice(0, 12)}`);
mkdirSync(release, { recursive: true });
mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
cpSync('server', join(release, 'server'), { recursive: true });
const current = join(root, 'api-current');
const previous = existsSync(current) ? readlinkSync(current) : null;
const plistPath = join(home, 'Library/LaunchAgents/com.readiz.music.api.plist');
const previousPlist = existsSync(plistPath) ? readFileSync(plistPath) : null;
const label = `gui/${process.getuid()}/com.readiz.music.api`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const env = { MUSIC_LIBRARY_ROOT: join(root, 'library'), MUSIC_NAS_ROOT: process.env.MUSIC_NAS_ROOT || '/Volumes/readiz_private/cl_backup/readiz-music', MUSIC_NAS_MOUNT: process.env.MUSIC_NAS_MOUNT || '/Volumes/readiz_private', MUSIC_AUTH_CONFIG: authPath, MUSIC_DATA_ROOT: join(root, 'data'), MUSIC_YTDLP: command, MUSIC_FFMPEG: '/opt/homebrew/bin', MUSIC_REVISION: revision, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:/opt/homebrew/bin:/usr/bin:/bin` };
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.readiz.music.api</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(current, 'server/start.mjs'))}</string></array><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key,value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>${xml(join(root, 'logs/api.log'))}</string><key>StandardErrorPath</key><string>${xml(join(root, 'logs/api.err.log'))}</string></dict></plist>`;
function link(target) { const next = `${current}.next`; rmSync(next, { force: true }); symlinkSync(target, next); renameSync(next, current); }
function stop() { try { execFileSync('launchctl', ['bootout', label], { stdio: 'ignore' }); } catch { /* First install. */ } }
async function start() {
  // bootout can return before launchd finishes unregistering the old job.
  // A bounded retry also protects rollback from the same transient error 5.
  let failure;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { stdio: 'pipe' });
      return;
    } catch (error) { failure = error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw failure;
}
try {
  stop(); link(release); writeFileSync(plistPath, plist, { mode: 0o600 }); await start();
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const health = await fetch('http://127.0.0.1:4525/api/health').then(r => r.json()); if (health.revision === revision && health.auth) { healthy = true; break; } } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!healthy) throw new Error('Music API health check failed.');
  console.log(JSON.stringify({ apiRelease: release, previous, revision }));
} catch (error) {
  stop();
  if (previous) link(previous); else rmSync(current, { force: true });
  if (previousPlist) { writeFileSync(plistPath, previousPlist, { mode: 0o600 }); await start(); }
  else rmSync(plistPath, { force: true });
  throw error;
}
