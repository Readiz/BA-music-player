import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readAndroidRelease } from './android-release.mjs';

test('publishes only a matching APK and rejects wrong package, size and hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'music-release-'));
  try {
    const apk = join(dir, 'app.apk');
    writeFileSync(apk, 'abc');
    const release = { packageName: 'com.readiz.music', versionCode: 3, versionName: '0.3.0', size: 3,
      sha256: createHash('sha256').update('abc').digest('hex') };
    writeFileSync(`${apk}.json`, JSON.stringify(release));
    assert.deepEqual(readAndroidRelease(apk), release);
    for (const override of [{ packageName: 'com.readiz.tv' }, { versionCode: 0 }, { size: 4 }, { sha256: '0'.repeat(64) }]) {
      writeFileSync(`${apk}.json`, JSON.stringify({ ...release, ...override }));
      assert.throws(() => readAndroidRelease(apk));
    }
  } finally { rmSync(dir, { recursive: true }); }
});
