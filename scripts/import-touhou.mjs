import { createDownloader, youtubeVideo } from '../server/imports.mjs';
import { mediaIdentity, importedSource } from '../server/media-identity.mjs';
import { validateCatalog } from '../server/github-sync.mjs';
import { createWaveform } from '../server/waveforms.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const execute = promisify(execFile);
const command = process.env.MUSIC_YTDLP || join(homedir(), '.local/share/readiz-music/downloader/bin/yt-dlp');
const ffmpeg = process.env.MUSIC_FFMPEG || '/opt/homebrew/bin';
const collection = JSON.parse(readFileSync('touhou-arrange.json', 'utf8'));
const manifest = JSON.parse(readFileSync('imported-tracks.json', 'utf8'));
const catalog = JSON.parse(readFileSync('musicList.json', 'utf8'));
const waveforms = JSON.parse(readFileSync('waveforms.json', 'utf8'));
if (collection.schemaVersion !== 1 || collection.folder !== '동방 어레인지' || collection.name !== 'Touhou') throw new Error('Invalid collection');
const seen = new Set();
for (const entry of collection.tracks) {
  const source = `./music/${collection.folder}/${mediaIdentity(entry.videoId).filename}`;
  if (!importedSource.test(source) || seen.has(source) || !entry.title || !entry.artist || !/^UC[\w-]{22}$/.test(entry.channelId)) throw new Error('Invalid collection entry');
  seen.add(source);
}
const download = createDownloader({ command, ffmpeg });
for (const [index, entry] of collection.tracks.entries()) {
  const src = `./music/${collection.folder}/${mediaIdentity(entry.videoId).filename}`;
  const existing = manifest.tracks.find(track => track.src === src);
  if (existing && existsSync(src) && statSync(src).size === existing.bytes
    && createHash('sha256').update(readFileSync(src)).digest('hex') === existing.sha256
    && existing.title === entry.title && existing.artist === entry.artist && waveforms[src]?.peaks?.length === 480) {
    console.log(`[${index + 1}/${collection.tracks.length}] Already prepared: ${entry.title}`);
    continue;
  }
  const directory = resolve(`output/import/touhou/${entry.videoId}`);
  mkdirSync(directory, { recursive: true });
  const video = youtubeVideo(`https://www.youtube.com/watch?v=${entry.videoId}`);
  try {
    // Keep only public provenance; never print upstream signed media URLs.
    const { stdout } = await execute(command, ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--no-cache-dir', '--js-runtimes', `node:${process.execPath}`, '--skip-download', '--dump-single-json', '--', video.url], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
    const metadata = JSON.parse(stdout);
    if (metadata.id !== entry.videoId || metadata.channel_id !== entry.channelId) throw new Error('Official source identity changed');
    console.log(`[${index + 1}/${collection.tracks.length}] Downloading: ${entry.title}`);
    const result = await download({ video, directory, stage: () => {} });
    mkdirSync(`music/${collection.folder}`, { recursive: true });
    const temporary = `${src}.next.mp3`;
    await execute(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-i', result.path, '-map', '0:a:0', '-c:a', 'copy', '-map_metadata', '-1', '-metadata', `title=${entry.title}`, '-metadata', `artist=${entry.artist}`, '-metadata', `album=${collection.name}`, temporary]);
    const peaks = await createWaveform(temporary, { ffmpeg });
    const bytes = statSync(temporary).size;
    const track = { src, title: entry.title, folder: collection.folder, artist: entry.artist, album: entry.album,
      originalWork: entry.originalWork, originalTracks: entry.originalTracks, referenceUrl: entry.referenceUrl,
      sourceUrl: video.url, sourceTitle: metadata.title, sourceChannel: metadata.channel, sourceChannelId: metadata.channel_id,
      collectedOn: collection.checkedOn, duration: peaks.duration, bytes, sha256: createHash('sha256').update(readFileSync(temporary)).digest('hex') };
    renameSync(temporary, src);
    manifest.tracks = [...manifest.tracks.filter(item => item.src !== src), track].sort((a, b) => a.src.localeCompare(b.src));
    if (!catalog.includes(src)) catalog.push(src);
    waveforms[src] = peaks;
    validateCatalog(manifest, catalog, waveforms);
    for (const [file, data] of [['imported-tracks.json', manifest], ['musicList.json', catalog], ['waveforms.json', waveforms]]) {
      writeFileSync(`${file}.next`, JSON.stringify(data, null, file === 'waveforms.json' ? undefined : 2) + '\n');
      renameSync(`${file}.next`, file);
    }
    rmSync(directory, { recursive: true });
    console.log(`[${index + 1}/${collection.tracks.length}] Prepared: ${entry.title} (${bytes} bytes, ${peaks.peaks.length} peaks)`);
  } catch {
    throw new Error(`Collection import failed for ${entry.videoId}; prepared tracks can be resumed safely.`);
  }
}
validateCatalog(manifest, catalog, waveforms);
console.log(`Prepared ${collection.tracks.length} Touhou arrangements. Run tests and publish the verified catalog.`);
