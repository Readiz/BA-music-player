// Legacy YouTube IDs remain stable; uploads are deduplicated by original bytes.
export function mediaIdentity(id) {
  if (/^[\w-]{11}$/.test(id || '')) return { kind: 'youtube', filename: `yt-${id}.mp3` };
  if (/^upload-[a-f0-9]{64}$/.test(id || '')) return { kind: 'upload', filename: `${id}.mp3` };
  throw new Error('Invalid music identity');
}
export const importedSource = /^\.\/music\/ETC\/(?:yt-[\w-]{11}|upload-[a-f0-9]{64})\.mp3$/;
