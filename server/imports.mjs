import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { mediaIdentity } from './media-identity.mjs';
import { DatabaseSync } from 'node:sqlite';

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
export const MAX_BYTES = 100 * 1024 * 1024;
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
export function createFileConverter({ ffmpeg = process.env.MUSIC_FFMPEG || '/opt/homebrew/bin', execute = run } = {}) {
  return async ({ source, title, directory, signal, stage }) => {
    try {
      // Treat uploads as untrusted media: no playlists, network protocols, or auxiliary files.
      const local = ['-protocol_whitelist', 'file', '-format_whitelist', 'mp3,wav,flac,ogg,mov,aac,matroska,webm'];
      const probe = JSON.parse(await execute(join(ffmpeg, 'ffprobe'), ['-v', 'error', ...local, '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', source], { signal, cwd: directory }));
      const duration = Number(probe.format?.duration);
      if (!(duration > 0 && duration <= MAX_SECONDS) || !probe.streams?.some(stream => stream.codec_type === 'audio')) throw new ImportError('오디오가 있는 30분 이내 파일만 추가할 수 있습니다.');
      stage('converting');
      const path = join(directory, 'audio.mp3');
      await execute(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', ...local, '-i', source, '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '192k', '-t', String(MAX_SECONDS), path], { signal, cwd: directory });
      const bytes = statSync(path).size;
      if (!bytes || bytes > MAX_BYTES) throw new ImportError('변환한 음악이 비어 있거나 100MB를 초과했습니다.');
      return { path, title, duration, bytes };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ImportError && !/영상|도구/.test(error.message)) throw error;
      throw new ImportError('음악 파일을 읽지 못했습니다. 지원 형식과 파일 손상 여부를 확인해 주세요.');
    }
  };
}
export function createImports({ dataRoot, downloader = createDownloader(), converter = createFileConverter(), synchronize, now = Date.now }) {
  if (typeof synchronize !== 'function') throw new Error('A durable music synchronizer is required');
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  const staging = join(dataRoot, 'staging');
  const media = join(dataRoot, 'media', 'ETC');
  const uploads = join(dataRoot, 'uploads');
  const incoming = join(dataRoot, 'incoming');
  mkdirSync(uploads, { recursive: true, mode: 0o700 });
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { recursive: true, mode: 0o700 });
  mkdirSync(media, { recursive: true });
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
    );`);
  const columns = new Set(db.prepare('PRAGMA table_info(imports)').all().map(column => column.name));
  for (const column of ['sync_state', 'sync_revision', 'sync_stage']) if (!columns.has(column)) db.exec(`ALTER TABLE imports ADD COLUMN ${column} TEXT`);
  // Resume interrupted synchronization, and migrate audio from the old local-only library.
  db.exec("UPDATE imports SET status='queued',error=NULL WHERE status IN ('checking','downloading','converting','syncing') OR (status='ready' AND sync_revision IS NULL)");
  let running = null, closed = false;
  const receiving = new Set();
  const publicTrack = row => ({ src: `./music/ETC/${mediaIdentity(row.video_id).filename}`, title: row.title, folder: 'ETC', artist: 'ETC' });
  const view = row => row && ({ id: row.id, status: row.status, title: row.title, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, syncStage: row.status === 'syncing' ? row.sync_stage : null,
    ...(row.status === 'ready' && row.sync_revision ? { track: publicTrack(row) } : {}) });
  const update = (id, status) => db.prepare('UPDATE imports SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  const get = id => db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  async function work(row) {
    const controller = new AbortController();
    const directory = join(staging, row.id);
    const path = join(media, mediaIdentity(row.video_id).filename);
    mkdirSync(directory, { mode: 0o700 });
    const promise = (async () => {
      try {
        const identity = mediaIdentity(row.video_id);
        const video = identity.kind === 'upload' ? { id: row.video_id } : youtubeVideo(`https://youtu.be/${row.video_id}`);
        let result;
        if (existsSync(path) && row.title && row.bytes) {
          result = { path, title: row.title, duration: row.duration, bytes: statSync(path).size };
        } else {
          update(row.id, 'checking');
          const options = { video, directory, signal: controller.signal, stage: status => update(row.id, status) };
          result = identity.kind === 'upload'
            ? await converter({ ...options, source: join(uploads, row.video_id), title: row.title })
            : await downloader(options);
          controller.signal.throwIfAborted();
          renameSync(result.path, path);
          result.path = path;
          db.prepare('UPDATE imports SET title=?,duration=?,bytes=? WHERE id=?').run(result.title, result.duration, result.bytes, row.id);
        }
        if (identity.kind === 'upload') rmSync(join(uploads, row.video_id), { force: true });
        update(row.id, 'syncing');
        const synced = await synchronize({ video, result, signal: controller.signal, checkpoint: JSON.parse(row.sync_state || '{}'),
          saveCheckpoint: state => db.prepare('UPDATE imports SET sync_state=? WHERE id=?').run(JSON.stringify(state), row.id),
          onProgress: stage => {
            if (!['uploading', 'waiting', 'preparing', 'waveform', 'testing', 'backing-up', 'publishing', 'publishing-static', 'verifying'].includes(stage)) return;
            db.prepare('UPDATE imports SET sync_stage=?,updated_at=? WHERE id=? AND (sync_stage IS NULL OR sync_stage!=?)').run(stage, now(), row.id, stage);
          } });
        controller.signal.throwIfAborted();
        if (!/^[a-f0-9]{40}$/.test(synced.revision || '')) throw new Error('Missing synchronization proof');
        db.prepare("UPDATE imports SET status='ready',title=?,sync_revision=?,error=NULL,updated_at=? WHERE id=?").run(synced.track?.title || result.title, synced.revision, now(), row.id);
        // The verified Mac library and NAS backup now own the final file.
        try { rmSync(path, { force: true }); } catch { /* A cache cleanup failure cannot undo verified publication. */ }
      } catch (error) {
        if (controller.signal.aborted) update(row.id, 'queued');
        else {
          if (row.video_id.startsWith('upload-')) rmSync(join(uploads, row.video_id), { force: true });
          const message = error instanceof ImportError ? error.message : get(row.id).status === 'syncing'
            ? '음악 동기화에 실패했습니다. 같은 링크나 파일로 다시 요청해 주세요. 준비된 음악은 보관됩니다.'
            : '음악 추가에 실패했습니다. 잠시 후 다시 시도해 주세요.';
          db.prepare("UPDATE imports SET status='failed',error=?,updated_at=? WHERE id=?").run(message, now(), row.id);
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    })();
    running = { controller, promise };
    await promise;
    running = null;
    pump();
  }
  function pump() {
    if (closed || running) return;
    const row = db.prepare("SELECT * FROM imports WHERE status='queued' ORDER BY created_at LIMIT 1").get();
    if (row) void work(row);
  }
  queueMicrotask(pump);
  function checkCapacity(owner) {
    if (closed) throw new ImportError('서비스를 다시 시작하고 있습니다. 잠시 후 다시 시도해 주세요.', 503);
    if (db.prepare("SELECT count(*) AS n FROM imports WHERE status IN ('queued','checking','downloading','converting','syncing')").get().n + receiving.size >= 5) throw new ImportError('추가 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.', 429);
    if (db.prepare('SELECT count(*) AS n FROM imports WHERE owner=? AND updated_at>?').get(owner, now() - 3600_000).n >= 20) throw new ImportError('한 시간에 최대 20곡까지 추가할 수 있습니다. 잠시 후 다시 시도해 주세요.', 429);
    const disk = statfsSync(dataRoot);
    const used = db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM imports').get().bytes;
    if (disk.bavail * disk.bsize < 500 * 1024 * 1024 || used >= 10 * 1024 ** 3) throw new ImportError('음악 저장 공간이 부족합니다.', 507);
  }
  function enqueueIdentity(video, owner, title = null, source = null) {
    const existing = db.prepare('SELECT * FROM imports WHERE video_id=?').get(video.id);
    if (existing && existing.status !== 'failed') {
      if (existing.status !== 'ready' && existing.owner !== owner) throw new ImportError('다른 사용자가 이 곡을 추가하고 있습니다. 동기화 후 ETC에서 확인해 주세요.', 409);
      return view(existing);
    }
    checkCapacity(owner);
    if (source) renameSync(source, join(uploads, video.id));
    const id = existing?.id || randomUUID();
    db.prepare(`INSERT INTO imports (id,video_id,owner,status,title,created_at,updated_at) VALUES (?,?,?,'queued',?,?,?)
      ON CONFLICT(video_id) DO UPDATE SET owner=excluded.owner,status='queued',error=NULL,sync_state=NULL,sync_stage=NULL,updated_at=excluded.updated_at`).run(id, video.id, owner, title, now(), now());
    const result = view(get(id));
    queueMicrotask(pump);
    return result;
  }
  return {
    enqueue: (value, owner) => enqueueIdentity(youtubeVideo(value), owner),
    async upload(request, owner) {
      const name = new URL(request.url).searchParams.get('name') || '';
      if (name.length > 255 || /[\/\\\x00-\x1f\x7f]/.test(name) || !/\.(mp3|m4a|mp4|wav|flac|ogg|opus|aac|webm)$/i.test(name)) throw new ImportError('MP3, M4A, MP4, WAV, FLAC, OGG, OPUS, AAC, WebM 파일을 선택해 주세요.');
      const title = (new URL(request.url).searchParams.get('title') || name.replace(/\.[^.]+$/, '')).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
      if (!title) throw new ImportError('곡 제목을 입력해 주세요.');
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new ImportError('파일은 최대 100MB까지 업로드할 수 있습니다.', 413);
      checkCapacity(owner);
      if (receiving.has(owner)) throw new ImportError('진행 중인 업로드가 끝난 뒤 다시 시도해 주세요.', 429);
      receiving.add(owner);
      const temporary = join(incoming, randomUUID());
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        const hash = createHash('sha256');
        let bytes = 0;
        if (!request.body) throw new ImportError('빈 파일은 업로드할 수 없습니다.');
        // Leave the socket open long enough to return a useful 413 on overflow.
        for await (const chunk of request.body.values({ preventCancel: true })) {
          request.signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > MAX_BYTES) throw new ImportError('파일은 최대 100MB까지 업로드할 수 있습니다.', 413);
          hash.update(chunk);
          await file.writeFile(chunk);
        }
        if (!bytes || (length !== null && bytes !== Number(length))) throw new ImportError('파일 전송이 완료되지 않았습니다. 다시 선택해 주세요.');
        await file.sync(); await file.close(); file = null;
        receiving.delete(owner);
        return enqueueIdentity({ id: `upload-${hash.digest('hex')}` }, owner, title, temporary);
      } finally {
        await file?.close();
        rmSync(temporary, { force: true });
        receiving.delete(owner);
      }
    },
    list: owner => db.prepare('SELECT * FROM imports WHERE owner=? ORDER BY updated_at DESC LIMIT 20').all(owner).map(view),
    async close() { closed = true; running?.controller.abort(); if (running) await running.promise; db.close(); },
  };
}
