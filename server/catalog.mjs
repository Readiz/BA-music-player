import { importedSource } from './media-identity.mjs';

export const MUSIC_LIBRARY = 'https://music.readiz.com/';

export function validateCatalog(manifest, catalog, waveforms) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tracks) || !Array.isArray(catalog)) throw new Error('Invalid catalog');
  const sources = new Set();
  for (const track of manifest.tracks) {
    const peaks = waveforms[track.src];
    if (!importedSource.test(track.src) || sources.has(track.src)
      || !/^[a-f0-9]{64}$/.test(track.sha256) || typeof track.title !== 'string' || !track.title.trim()
      || !Number.isInteger(track.bytes) || track.bytes < 1 || track.bytes > 100 * 1024 * 1024
      || !catalog.includes(track.src) || !(peaks?.duration > 0 && peaks.duration <= 1801)
      || peaks.peaks?.length !== 480 || !peaks.peaks.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Incomplete synchronized track');
    sources.add(track.src);
  }
}
