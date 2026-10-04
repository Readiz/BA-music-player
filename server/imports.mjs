import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWaveform } from './waveforms.mjs';

export class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function youtubeVideo(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new ImportError('유튜브 영상 링크를 입력해 주세요.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new ImportError('올바른 유튜브 영상 링크를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new ImportError('유튜브 영상 링크만 사용할 수 있습니다.');
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new ImportError('재생목록 대신 유튜브 영상 한 곡의 링크를 입력해 주세요.');
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_SECONDS = 30 * 60;
function run(command, args, { signal, cwd, onLine = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '', pending = '', settled = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } };
    const timeout = setTimeout(stop, 20 * 60_000);
    const diskLimit = setInterval(() => {
      try {
        const bytes = readdirSync(cwd).reduce((sum, file) => sum + statSync(join(cwd, file)).size, 0);
        if (bytes > MAX_BYTES * 2) stop();
      } catch { stop(); }
    }, 2000);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(diskLimit);
      signal?.removeEventListener('abort', stop);
      if (error) reject(error); else resolve(output);
    };
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 2 * 1024 * 1024) { stop(); return; }
      pending += chunk.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) onLine(line);
    });
    // Upstream diagnostics can contain signed URLs; never persist or expose them.
    child.stderr.on('data', () => {});
    child.on('error', () => finish(new ImportError('다운로드 도구를 실행할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503)));
    child.on('close', code => finish(code === 0 ? null : new ImportError('영상을 가져오지 못했습니다. 공개 영상인지, 30분 이내인지 확인하고 다시 시도해 주세요.')));
  });
}
export function createDownloader({ command = process.env.MUSIC_YTDLP || 'yt-dlp', ffmpeg = process.env.MUSIC_FFMPEG || '/opt/homebrew/bin', execute = run } = {}) {
  return async ({ video, directory, signal, stage }) => {
    const common = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--no-cache-dir', '--js-runtimes', `node:${process.execPath}`, '--extractor-args', 'youtube:player_client=default'];
    const metadata = JSON.parse(await execute(command, [...common, '--skip-download', '--dump-single-json', '--', video.url], { signal, cwd: directory }));
    if (metadata.id !== video.id || metadata.is_live || ['is_live', 'is_upcoming'].includes(metadata.live_status) || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > MAX_SECONDS) throw new ImportError('30분 이내의 공개 영상만 추가할 수 있습니다. 실시간 방송은 지원하지 않습니다.');
    stage('downloading');
    await execute(command, [...common, '--format', 'bestaudio/best', '--max-filesize', String(MAX_BYTES), '--match-filters', `!is_live & duration <= ${MAX_SECONDS}`, '--output', join(directory, 'source.%(ext)s'), '--no-progress', '--', video.url], { signal, cwd: directory });
    const sources = readdirSync(directory).filter(file => /^source\.(m4a|webm|mp4|ogg|opus|mp3|aac|flac|wav)$/.test(file));
    if (sources.length !== 1 || statSync(join(directory, sources[0])).size > MAX_BYTES) throw new ImportError('음악 파일을 내려받지 못했거나 100MB를 초과했습니다.');
    stage('converting');
    const path = join(directory, 'audio.mp3');
    await execute(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-i', join(directory, sources[0]), '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-t', String(MAX_SECONDS), path], { signal, cwd: directory });
    const size = existsSync(path) ? statSync(path).size : 0;
    if (!size || size > MAX_BYTES) throw new ImportError('음악 파일을 만들지 못했거나 100MB를 초과했습니다.');
    const title = String(metadata.title || video.id).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) || video.id;
    return { path, title, duration: metadata.duration, bytes: size };
  };
}
export function createImports({ dataRoot, downloader = createDownloader(), waveform = createWaveform, now = Date.now }) {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  const staging = join(dataRoot, 'staging');
  const media = join(dataRoot, 'media', 'ETC');
  mkdirSync(media, { recursive: true });
  // A single worker owns this store. A killed process cannot publish partial files.
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  const dbPath = join(dataRoot, 'imports.sqlite');
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY, video_id TEXT UNIQUE NOT NULL, owner TEXT NOT NULL,
      status TEXT NOT NULL, title TEXT, duration REAL, bytes INTEGER, error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    UPDATE imports SET status='failed', error='서버가 재시작되었습니다. 같은 링크로 다시 추가해 주세요.' WHERE status IN ('queued','checking','downloading','converting');`);
  if (!db.prepare('PRAGMA table_info(imports)').all().some(column => column.name === 'waveform')) {
    db.exec('ALTER TABLE imports ADD COLUMN waveform TEXT');
  }
  let running = null, closed = false;
  const waveformFailures = new Set();
  const publicTrack = row => ({ src: `./music/ETC/yt-${row.video_id}.mp3`, title: row.title, folder: 'ETC', artist: 'ETC' });
  const view = row => row && ({ id: row.id, status: row.status, title: row.title, error: row.error, createdAt: row.created_at, ...(row.status === 'ready' ? { track: publicTrack(row) } : {}) });
  const update = (id, status) => db.prepare('UPDATE imports SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  const get = id => db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  async function work(row) {
    const controller = new AbortController();
    const directory = join(staging, row.id);
    mkdirSync(directory, { mode: 0o700 });
    const promise = (async () => {
      try {
        update(row.id, 'checking');
        const result = await downloader({ video: youtubeVideo(`https://youtu.be/${row.video_id}`), directory, signal: controller.signal, stage: status => update(row.id, status) });
        let peaks = null;
        try { peaks = await waveform(result.path, { signal: controller.signal }); }
        catch { waveformFailures.add(row.id); /* A display failure must not discard completed audio. */ }
        if (controller.signal.aborted) throw new Error('aborted');
        renameSync(result.path, join(media, `yt-${row.video_id}.mp3`));
        db.prepare("UPDATE imports SET status='ready', title=?, duration=?, bytes=?, waveform=?, error=NULL, updated_at=? WHERE id=?").run(result.title, result.duration, result.bytes, peaks ? JSON.stringify(peaks) : null, now(), row.id);
      } catch (error) {
        db.prepare("UPDATE imports SET status='failed', error=?, updated_at=? WHERE id=?").run(error instanceof ImportError ? error.message : '음악 추가에 실패했습니다. 잠시 후 다시 시도해 주세요.', now(), row.id);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    })();
    running = { controller, promise };
    await promise;
    running = null;
    pump();
  }
  async function backfill(row) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const data = await waveform(join(media, `yt-${row.video_id}.mp3`), { signal: controller.signal });
        if (!controller.signal.aborted) db.prepare('UPDATE imports SET waveform=? WHERE id=?').run(JSON.stringify(data), row.id);
      } catch { waveformFailures.add(row.id); }
    })();
    running = { controller, promise };
    await promise;
    running = null;
    pump();
  }
  function pump() {
    if (closed || running) return;
    const row = db.prepare("SELECT * FROM imports WHERE status='queued' ORDER BY created_at LIMIT 1").get();
    if (row) { void work(row); return; }
    const missing = db.prepare("SELECT * FROM imports WHERE status='ready' AND waveform IS NULL ORDER BY created_at").all()
      .find(item => !waveformFailures.has(item.id) && existsSync(join(media, `yt-${item.video_id}.mp3`)));
    if (missing) void backfill(missing);
  }
  queueMicrotask(pump);
  return {
    enqueue(value, owner) {
      const video = youtubeVideo(value);
      const existing = db.prepare('SELECT * FROM imports WHERE video_id=?').get(video.id);
      if (existing && existing.status !== 'failed') {
        if (existing.status !== 'ready' && existing.owner !== owner) throw new ImportError('다른 사용자가 이 곡을 추가하고 있습니다. 잠시 후 ETC에서 확인해 주세요.', 409);
        return view(existing);
      }
      if (db.prepare("SELECT count(*) AS n FROM imports WHERE status IN ('queued','checking','downloading','converting')").get().n >= 5) throw new ImportError('추가 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.', 429);
      if (db.prepare('SELECT count(*) AS n FROM imports WHERE owner=? AND updated_at>?').get(owner, now() - 3600_000).n >= 20) throw new ImportError('한 시간에 최대 20곡까지 추가할 수 있습니다. 잠시 후 다시 시도해 주세요.', 429);
      const disk = statfsSync(dataRoot);
      const used = db.prepare("SELECT coalesce(sum(bytes),0) AS bytes FROM imports WHERE status='ready'").get().bytes;
      if (disk.bavail * disk.bsize < 500 * 1024 * 1024 || used >= 10 * 1024 ** 3) throw new ImportError('음악 저장 공간이 부족합니다.', 507);
      const id = existing?.id || randomUUID();
      db.prepare(`INSERT INTO imports (id,video_id,owner,status,created_at,updated_at) VALUES (?,?,?,'queued',?,?)
        ON CONFLICT(video_id) DO UPDATE SET owner=excluded.owner,status='queued',error=NULL,updated_at=excluded.updated_at`).run(id, video.id, owner, now(), now());
      const result = view(get(id));
      queueMicrotask(pump);
      return result;
    },
    list: owner => db.prepare('SELECT * FROM imports WHERE owner=? ORDER BY updated_at DESC LIMIT 20').all(owner).map(view),
    catalog: () => db.prepare("SELECT * FROM imports WHERE status='ready' ORDER BY created_at").all().filter(row => existsSync(join(media, `yt-${row.video_id}.mp3`))).map(publicTrack),
    waveforms: () => Object.fromEntries(db.prepare("SELECT * FROM imports WHERE status='ready' AND waveform IS NOT NULL").all()
      .filter(row => existsSync(join(media, `yt-${row.video_id}.mp3`)))
      .map(row => [publicTrack(row).src, JSON.parse(row.waveform)])),
    async close() { closed = true; running?.controller.abort(); if (running) await running.promise; db.close(); },
  };
}
