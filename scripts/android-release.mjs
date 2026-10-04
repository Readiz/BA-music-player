import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function readAndroidRelease(apkPath, metadataPath = `${apkPath}.json`) {
  const apk = readFileSync(apkPath);
  const release = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (release.packageName !== 'com.readiz.music' || !Number.isSafeInteger(release.versionCode) || release.versionCode < 1
    || !/^\d+\.\d+\.\d+$/.test(release.versionName) || !/^[a-f0-9]{64}$/.test(release.sha256)
    || release.size !== apk.length || apk.length < 1 || apk.length > 150 * 1024 * 1024
    || createHash('sha256').update(apk).digest('hex') !== release.sha256) {
    throw new Error('Android APK and release metadata do not match. Rebuild the APK.');
  }
  return release;
}
