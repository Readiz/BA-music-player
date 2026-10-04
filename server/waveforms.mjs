import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const RATE = 2000;
const PEAKS = 480;

// Match the static catalog's display peaks without decoding audio in the player.
export async function createWaveform(path, { signal, ffmpeg = process.env.MUSIC_FFMPEG || '/opt/homebrew/bin' } = {}) {
  const { stdout } = await execute(join(ffmpeg, 'ffmpeg'), [
    '-nostdin', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(RATE),
    '-t', '1800', '-f', 'f32le', 'pipe:1',
  ], { signal, encoding: 'buffer', maxBuffer: 15 * 1024 * 1024, timeout: 120_000 });
  const length = stdout.length / 4;
  if (!Number.isInteger(length) || !length) throw new Error('No waveform samples');
  const peaks = Array.from({ length: PEAKS }, (_, i) => {
    let peak = 0;
    for (let j = Math.floor(i * length / PEAKS); j < Math.floor((i + 1) * length / PEAKS); j++) {
      const value = Math.abs(stdout.readFloatLE(j * 4));
      if (!Number.isFinite(value)) throw new Error('Invalid waveform sample');
      peak = Math.max(peak, value);
    }
    return Math.round(peak * 1000) / 1000;
  });
  return { duration: length / RATE, peaks };
}
