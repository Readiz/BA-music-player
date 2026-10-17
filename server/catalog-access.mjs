import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { audioPath } from './library.mjs';

export const PUBLIC_ALBUMS = new Set(['Blue Archive', 'th original']);
export function publicTrack(src) {
  try { const parts = audioPath(src).split('/'); return parts.length === 3 && PUBLIC_ALBUMS.has(parts[1]); }
  catch { return false; }
}
export function publicResource(uri) {
  try {
    const path = decodeURIComponent(uri.split('?')[0]);
    if (path.startsWith('/music/')) return publicTrack('.' + path);
    return ['/assets/albums/blue-archive.jpg', '/assets/albums/touhou-original.jpg'].includes(path);
  } catch { return false; }
}
export const catalogFiles = new Set(['musicList.json', 'imported-tracks.json', 'blue-archive-ost.json', 'waveforms.json', 'lastUpdated.txt', 'library-info.json']);
export function catalogView(metadata, authenticated) {
  const list = metadata['musicList.json'].filter(src => authenticated || publicTrack(src));
  const allowed = new Set(list);
  return {
    list,
    imported: { schemaVersion: 1, tracks: (metadata['imported-tracks.json']?.tracks || []).filter(track => allowed.has(track.src)) },
    ost: metadata['blue-archive-ost.json'] || { titles: {} },
    waves: Object.fromEntries(Object.entries(metadata['waveforms.json'] || {}).filter(([src]) => allowed.has(src))),
  };
}
export function createCatalogReader(root) {
  let current, data;
  return async authenticated => {
    const location = await realpath(root);
    if (current !== location) {
      const entries = await Promise.all([...catalogFiles].map(async name => {
        try { const value = await readFile(join(location, name), 'utf8'); return [name, name.endsWith('.json') ? JSON.parse(value) : value]; }
        catch (error) { if (name === 'musicList.json') throw error; return [name, null]; }
      }));
      const next = Object.fromEntries(entries);
      if (!Array.isArray(next['musicList.json'])) throw Error('Invalid music catalog');
      data = next; current = location;
    }
    const view = catalogView(data, authenticated);
    return { ...view, updated: data['lastUpdated.txt'] || '', info: { schemaVersion: 1, trackCount: view.list.length, serving: 'nas-via-mac' } };
  };
}
export function catalogHeaders(request) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Origin', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' };
  const origin = request.headers.get('origin');
  if (['https://www.readiz.com', 'https://newblog.dev.readiz.com', 'https://music.readiz.com'].includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else headers['Access-Control-Allow-Origin'] = '*';
  return headers;
}
