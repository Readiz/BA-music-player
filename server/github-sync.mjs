import { mediaIdentity, importedSource } from './media-identity.mjs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const MUSIC_PAGES = 'https://blog.readiz.com/BA-music-player/';
const REPO = 'Readiz/BA-music-player';
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function githubClient({ command = process.env.MUSIC_GH || '/opt/homebrew/bin/gh', fetcher = fetch } = {}) {
  return {
    api(method, path, body, signal) {
      return new Promise((resolve, reject) => {
        const child = execFile(command, ['api', '--hostname', 'github.com', '--method', method,
          '-H', 'X-GitHub-Api-Version: 2026-03-10', ...(body ? ['--input', '-'] : []), `repos/${REPO}/${path}`],
        { signal, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (error, stdout) => {
          if (error) { reject(new Error('GitHub request failed')); return; }
          try { resolve(stdout.trim() ? JSON.parse(stdout) : {}); } catch { reject(new Error('Invalid GitHub response')); }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(body ? JSON.stringify(body) : undefined);
      });
    },
    async raw(path, revision, signal, limit = 8 * 1024 * 1024) {
      if (!sha(revision) || !/^[\w./-]+$/.test(path) || path.includes('..')) throw new Error('Invalid GitHub file');
      const response = await fetcher(`https://raw.githubusercontent.com/${REPO}/${revision}/${path}`, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(120_000)]) });
      if (!response.ok) throw new Error('GitHub file unavailable');
      let length = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > limit) throw new Error('GitHub file exceeds limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}

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

// Completion means the existing Pages site serves the committed audio and metadata.
export async function waitForPages({ client, revision, videoId, signal, fetcher = fetch, pause = delay }) {
  const json = async file => JSON.parse((await client.raw(file, revision, signal)).toString('utf8'));
  const [manifest, catalog, waveforms] = await Promise.all(['imported-tracks.json', 'musicList.json', 'waveforms.json'].map(json));
  validateCatalog(manifest, catalog, waveforms);
  const track = manifest.tracks.find(item => item.src === `./music/ETC/${mediaIdentity(videoId).filename}`);
  if (!track) throw new Error('Track missing from committed catalog');
  const published = async (file, limit = 8 * 1024 * 1024) => {
    const url = new URL(file, MUSIC_PAGES);
    url.searchParams.set('sync', `${revision}-${Date.now()}`);
    const response = await fetcher(url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90_000)]), cache: 'no-store' });
    if (!response.ok) throw new Error('Pages publication is not ready');
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > limit) throw new Error('Pages file exceeds limit');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    signal?.throwIfAborted();
    try {
      const [visible, list, waves] = await Promise.all(['imported-tracks.json', 'musicList.json', 'waveforms.json'].map(async file => JSON.parse((await published(file)).toString('utf8'))));
      const visibleTrack = visible.tracks?.find(item => item.src === track.src);
      if (visibleTrack?.sha256 !== track.sha256 || !list.includes(track.src) || JSON.stringify(waves[track.src]) !== JSON.stringify(waveforms[track.src])) throw new Error('Pages catalogs still propagating');
      const bytes = await published(track.src, 100 * 1024 * 1024);
      if (bytes.length !== track.bytes || hash(bytes) !== track.sha256) throw new Error('Pages audio is not synchronized');
      return { revision, track: visibleTrack };
    } catch (error) { if (signal?.aborted) throw error; }
    await pause(15_000, undefined, { signal });
  }
  throw new Error('Pages publication timed out');
}

export function createGithubSync({ client = githubClient(), pause = delay, publish = waitForPages } = {}) {
  return async ({ video, result, checkpoint = {}, saveCheckpoint, signal, onProgress = () => {} }) => {
    mediaIdentity(video.id);
    const call = (method, path, body) => client.api(method, path, body, signal);
    let source = checkpoint.source;
    if (!source) {
      onProgress('uploading');
      const head = await call('GET', 'git/ref/heads/master');
      const commit = await call('GET', `git/commits/${head.object.sha}`);
      const blob = await call('POST', 'git/blobs', { encoding: 'base64', content: readFileSync(result.path).toString('base64') });
      const tree = await call('POST', 'git/trees', { base_tree: commit.tree.sha, tree: [
        { path: `music-inbox/${video.id}.mp3`, mode: '100644', type: 'blob', sha: blob.sha },
        { path: `music-inbox/${video.id}.json`, mode: '100644', type: 'blob', content: JSON.stringify({ videoId: video.id, title: result.title }) },
      ] });
      const candidate = await call('POST', 'git/commits', { message: `Prepare music import ${video.id}`, parents: [head.object.sha], tree: tree.sha });
      source = candidate.sha;
      await call('POST', 'git/refs', { ref: `refs/heads/music-imports/${source}`, sha: source });
      checkpoint = { source };
      saveCheckpoint(checkpoint);
    }
    if (!sha(source)) throw new Error('Invalid import checkpoint');
    let runId = checkpoint.runId;
    if (!runId) {
      // Recover a dispatched run after an interrupted/unknown response before creating another.
      const runs = await call('GET', 'actions/workflows/import-music.yml/runs?event=workflow_dispatch&per_page=100');
      const prior = runs.workflow_runs.find(run => run.display_title === `Sync music ${video.id} / ${source}`);
      if (prior) runId = prior.id;
      else {
        const dispatched = await call('POST', 'actions/workflows/import-music.yml/dispatches', { ref: 'master', inputs: { video_id: video.id, source_sha: source } });
        runId = dispatched.workflow_run_id;
      }
      if (runId) { checkpoint = { source, runId }; saveCheckpoint(checkpoint); }
    }
    onProgress('waiting');
    let complete = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      signal?.throwIfAborted();
      if (!runId) {
        const runs = await call('GET', 'actions/workflows/import-music.yml/runs?event=workflow_dispatch&per_page=100');
        runId = runs.workflow_runs.find(run => run.display_title === `Sync music ${video.id} / ${source}`)?.id;
        if (runId) saveCheckpoint({ source, runId });
      }
      if (runId) {
        const run = await call('GET', `actions/runs/${runId}`);
        if (run.status !== 'completed') {
          let stage = run.status === 'in_progress' ? 'preparing' : 'waiting';
          if (run.status === 'in_progress') {
            // Optional detail must never interrupt a durable publication.
            try {
              const jobs = await call('GET', `actions/runs/${runId}/jobs`);
              const step = jobs.jobs?.flatMap(job => job.steps || []).find(step => step.status === 'in_progress')?.name || '';
              if (/Prepare audio/.test(step)) stage = 'waveform';
              else if (/npm test/.test(step)) stage = 'testing';
              else if (/Commit only|npm run build|github-pages-deploy/.test(step)) stage = 'publishing';
            } catch { signal?.throwIfAborted(); }
          }
          onProgress(stage);
        }
        if (run.status === 'completed') {
          if (run.conclusion !== 'success') throw new Error('GitHub synchronization failed');
          complete = true; break;
        }
      }
      await pause(15_000, undefined, { signal });
    }
    if (!complete) throw new Error('GitHub synchronization timed out');
    const head = await call('GET', 'git/ref/heads/master');
    onProgress('verifying');
    const published = await publish({ client, revision: head.object.sha, videoId: video.id, signal });
    // The immutable candidate is only a transfer branch; master now owns the final audio.
    try { await call('DELETE', `git/refs/heads/music-imports/${source}`); } catch { /* Safe to retry cleanup separately. */ }
    return published;
  };
}
