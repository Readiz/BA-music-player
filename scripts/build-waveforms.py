#!/usr/bin/env python3
"""Build display-only peaks so playback never waits for browser audio decoding.
Requires ffmpeg and ffprobe. Run after adding or replacing music files.
"""
import array
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = 480


def waveform(path):
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
    url = './' + quote(path.relative_to(ROOT).as_posix(), safe="/;,:@&=+$-_.!~*'()#")
    return url, {'duration': round(duration, 3), 'peaks': peaks}


if __name__ == '__main__':
    paths = sorted(p for p in (ROOT / 'music').rglob('*') if p.suffix.lower() in ('.ogg', '.mp3', '.m4a'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        tracks = dict(pool.map(waveform, paths))
    (ROOT / 'waveforms.json').write_text(json.dumps(tracks, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Built {len(tracks)} display waveforms')
