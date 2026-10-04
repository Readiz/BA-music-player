#!/usr/bin/env python3
"""Build an unsigned WGT with Python stdlib only; no SDK, secrets or network."""
from pathlib import Path
import argparse
import json
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
import hashlib
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tizen'
FILES = ('app-url.js', 'config.xml', 'index.html', 'launcher.js', 'launcher.css', 'icon.png')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='https://music.readiz.com/')
args = parser.parse_args()
url = urlsplit(args.url)
if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
    parser.error('--url must be an HTTPS origin without credentials, path, query or fragment')
config = ET.parse(SOURCE / 'config.xml').getroot()
version = config.attrib['version']
assert all(x.isdigit() for x in version.split('.')) and len(version.split('.')) == 3
ns = {'w': 'http://www.w3.org/ns/widgets', 't': 'http://tizen.org/ns/widgets'}
assert config.find('w:content', ns).attrib['src'] in FILES
assert config.find('w:icon', ns).attrib['src'] in FILES
assert config.find('t:application', ns).attrib['id'] == 'ReadizMU01.ReadizMusic'
output = ROOT / 'dist' / 'tizen'
output.mkdir(parents=True, exist_ok=True)
artifact = output / ('readiz-music-' + version + '-unsigned.wgt')
with zipfile.ZipFile(artifact, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in FILES:
        entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        if name == 'app-url.js':
            data = ('window.READIZ_APP_URL = ' + json.dumps(args.url) + ';\n').encode()
        elif name == 'config.xml':
            data = (SOURCE / name).read_text().replace('https://music.readiz.com</tizen:allow-navigation>', escape(url.scheme + '://' + url.netloc) + '</tizen:allow-navigation>').replace('origin="https://music.readiz.com"', 'origin="' + escape(url.scheme + '://' + url.netloc, {'"': '&quot;'}) + '"').encode()
        else:
            data = (SOURCE / name).read_bytes()
        archive.writestr(entry, data)
with zipfile.ZipFile(artifact) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(FILES)
latest = output / 'readiz-music-unsigned.wgt'
temporary = output / '.readiz-music-unsigned.wgt.tmp'
temporary.write_bytes(artifact.read_bytes())
temporary.replace(latest)
digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
artifact.with_suffix('.wgt.sha256').write_text(digest + '  ' + artifact.name + '\n')
(ROOT / 'dist' / 'app.wgt').write_bytes(artifact.read_bytes())
(ROOT / 'dist' / 'app.wgt.sha256').write_text(digest + '  app.wgt\n')
print(str(artifact))
print('UNSIGNED: sign and install with Apps2Samsung; not yet verified on a TV.')
print('SHA256: ' + digest)
