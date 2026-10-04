import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createWaveform } from '../server/waveforms.mjs';

const id = process.env.IMPORT_VIDEO_ID;
const source = process.env.IMPORT_SOURCE_SHA;
if (!/^[\w-]{11}$/.test(id || '') || !/^[a-f0-9]{40}$/.test(source || '')) throw new Error('Invalid import identity');
const gitFile = path => execFileSync('git', ['show', `${source}:${path}`], { maxBuffer: 101 * 1024 * 1024 });
const request = JSON.parse(gitFile(`music-inbox/${id}.json`).toString('utf8'));
if (request.videoId !== id || typeof request.title !== 'string') throw new Error('Import metadata mismatch');
const title = request.title.normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
if (!title) throw new Error('Missing title');
const folder = 'music/ETC';
const path = `${folder}/yt-${id}.mp3`;
const src = `./${path}`;
mkdirSync(folder, { recursive: true });
mkdirSync('output/import', { recursive: true });
const temporary = `output/import/${id}.mp3`;
writeFileSync(temporary, gitFile(`music-inbox/${id}.mp3`));
const ffmpeg = process.env.MUSIC_FFMPEG || '/usr/bin';
const probe = JSON.parse(execFileSync(join(ffmpeg, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', temporary], { encoding: 'utf8' }));
const duration = Number(probe.format.duration);
if (!(duration > 0 && duration <= 1801) || probe.streams.length !== 1 || probe.streams[0].codec_type !== 'audio' || probe.streams[0].codec_name !== 'mp3' || statSync(temporary).size > 100 * 1024 * 1024) throw new Error('Invalid or oversized MP3');
// Preserve audio samples; strip upstream tags/artwork and write a clean title.
execFileSync(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-i', temporary, '-map', '0:a:0', '-c:a', 'copy', '-map_metadata', '-1', '-metadata', `title=${title}`, '-metadata', 'artist=ETC', path]);
rmSync(temporary);
const peaks = await createWaveform(path, { ffmpeg });
const track = {
  src, title, folder: 'ETC', artist: 'ETC', sourceUrl: `https://www.youtube.com/watch?v=${id}`,
  duration: peaks.duration, bytes: statSync(path).size,
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), sourceRevision: source,
};
const manifest = JSON.parse(readFileSync('imported-tracks.json', 'utf8'));
manifest.tracks = [...manifest.tracks.filter(item => item.src !== src), track].sort((a, b) => a.src.localeCompare(b.src));
const catalog = JSON.parse(readFileSync('musicList.json', 'utf8'));
if (!catalog.includes(src)) catalog.push(src);
const waveforms = JSON.parse(readFileSync('waveforms.json', 'utf8'));
waveforms[src] = peaks;
for (const [file, data] of [['imported-tracks.json', manifest], ['musicList.json', catalog], ['waveforms.json', waveforms]]) {
  writeFileSync(`${file}.next`, JSON.stringify(data, null, file === 'waveforms.json' ? undefined : 2) + '\n');
  renameSync(`${file}.next`, file);
}
console.log(`Prepared ${id}: ${track.bytes} bytes, ${peaks.peaks.length} peaks`);
