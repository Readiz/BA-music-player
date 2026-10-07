#!/usr/bin/env python3
"""Build display-only peaks from prepared files or the current Mac library."""
import array
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
from urllib.parse import unquote
import uuid

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = Path(os.environ.get('MUSIC_LIBRARY_ROOT', str(Path.home() / '.local/share/readiz-music/library'))) / 'current'
SAMPLES = 480


def waveform(entry):
    src, path = entry
    duration = float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path),
    ]))
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ac', '1',
        '-ar', '2000', '-f', 'f32le', 'pipe:1',
    ])
    samples = array.array('f', raw)
    import sys
    if sys.byteorder != 'little':
        samples.byteswap()
    peaks = []
    for i in range(SAMPLES):
        chunk = samples[i * len(samples) // SAMPLES:(i + 1) * len(samples) // SAMPLES]
        peaks.append(round(max(map(abs, chunk), default=0), 3))
    return src, {'duration': round(duration, 3), 'peaks': peaks}


if __name__ == '__main__':
    catalog = json.loads((ROOT / 'musicList.json').read_text())
    if not isinstance(catalog, list) or not catalog or len(set(catalog)) != len(catalog):
        raise SystemExit('Invalid or empty music catalog; existing waveforms are preserved')
    entries = []
    for src in catalog:
        decoded = unquote(src[2:]) if isinstance(src, str) and src.startswith('./music/') else ''
        parts = decoded.split('/')
        if len(parts) < 3 or parts[0] != 'music' or any(part in ('', '.', '..') for part in parts) or any(char in decoded for char in '\\?#') or PurePosixPath(decoded).suffix.lower() not in ('.ogg', '.mp3', '.m4a'):
            raise SystemExit('Invalid music path; existing waveforms are preserved')
        path = ROOT / decoded
        if not path.is_file():
            path = LIBRARY / decoded
        if not path.is_file():
            raise SystemExit('Audio is managed outside Git. Run npm run library:restore before regenerating waveforms.')
        entries.append((src, path))
    with ThreadPoolExecutor(max_workers=4) as pool:
        tracks = dict(pool.map(waveform, entries))
    temporary = ROOT / ('waveforms.json.' + str(uuid.uuid4()) + '.tmp')
    try:
        temporary.write_text(json.dumps(tracks, ensure_ascii=False, separators=(',', ':')) + '\n')
        temporary.replace(ROOT / 'waveforms.json')
    finally:
        if temporary.exists():
            temporary.unlink()
    print(f'Built {len(tracks)} display waveforms')
