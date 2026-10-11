// Record only fixed diagnostic labels. Never serialize exceptions: ffmpeg/network
// errors can contain local paths, private metadata, credentials or signed URLs.
const reasons = new Map([
  ['NAS share is not mounted; existing library is preserved', 'nas-unmounted'],
  ['The expected NAS static share is not mounted', 'static-unmounted'],
  ['NAS static mount permissions do not match', 'static-permissions'],
  ['NAS static mount is unavailable', 'static-unavailable'],
  ['Insufficient NAS publication space', 'static-no-space'],
  ['Static audio is missing, linked or changed', 'static-file-invalid'],
  ['NAS static object checksum mismatch', 'static-checksum'],
  ['NAS static copy checksum mismatch', 'static-copy-checksum'],
  ['Stored audio checksum mismatch', 'backup-checksum'],
  ['Copied audio checksum mismatch', 'backup-copy-checksum'],
  ['NAS catalog verification failed', 'backup-catalog'],
  ['Music publication is not ready', 'public-unavailable'],
  ['Published catalog mismatch', 'public-catalog'],
  ['Published audio checksum mismatch', 'public-checksum'],
  ['Published audio range is unavailable', 'public-range'],
]);
const codes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOSPC', 'ETIMEDOUT', 'ESTALE', 'ENOTCONN', 'ECONNRESET', 'ECONNREFUSED']);
const stages = new Set(['queued', 'checking', 'downloading', 'converting', 'syncing', 'preparing', 'waveform', 'testing', 'backing-up', 'publishing', 'publishing-static', 'verifying']);
export function importFailureLog({ id, stage, error }, write = line => console.error(line)) {
  let reason = 'unknown';
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (codes.has(current.code)) { reason = current.code; break; }
    if (reasons.has(current.message)) { reason = reasons.get(current.message); break; }
  }
  const record = { time: new Date().toISOString(), event: 'import_failure',
    ...(/^[a-f0-9-]{36}$/.test(id || '') ? { job: id } : {}),
    stage: stages.has(stage) ? stage : 'unknown', reason };
  try { write(JSON.stringify(record)); } catch { /* Diagnostics must not break the queue. */ }
  return record;
}
