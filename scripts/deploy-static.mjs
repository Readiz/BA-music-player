import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Static mount service requires macOS');
const root = join(homedir(), '.local/share/readiz-music');
const script = join(root, 'api-current/scripts/mount-static.mjs');
execFileSync(process.execPath, [script], { stdio: 'inherit', timeout: 110_000 });
const label = 'com.readiz.static.mounts';
const job = `gui/${process.getuid()}/${label}`;
const path = join(homedir(), 'Library/LaunchAgents', label + '.plist');
const previous = existsSync(path) ? readFileSync(path) : null;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const env = Object.fromEntries(['MUSIC_STATIC_PUBLISH_MOUNT', 'MUSIC_STATIC_SERVE_MOUNT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer><key>StandardOutPath</key><string>${xml(join(root, 'logs/static-mount.log'))}</string><key>StandardErrorPath</key><string>${xml(join(root, 'logs/static-mount.err.log'))}</string></dict></plist>`;
function stop() { try { execFileSync('launchctl', ['bootout', job], { stdio: 'ignore' }); } catch { /* Not installed yet. */ } }
async function start() {
  for (let i = 0; i < 10; i++) {
    try { execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, path], { stdio: 'pipe' }); return; }
    catch (error) { if (i === 9) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
  }
}
stop();
try { writeFileSync(path, plist, { mode: 0o600 }); await start(); }
catch (error) {
  stop();
  if (previous) { writeFileSync(path, previous, { mode: 0o600 }); await start(); }
  else rmSync(path, { force: true });
  throw error;
}
console.log(JSON.stringify({ service: label, intervalSeconds: 60, credentialsStored: false, authentication: 'macOS login Keychain' }));
