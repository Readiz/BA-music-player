// Use the sharp runtime from a configured workspace: SHARP_MODULE=/absolute/path/to/sharp.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const source = readFileSync(new URL('../assets/icons/music.svg', import.meta.url));
for (const size of [192, 512, 180]) {
  await sharp(source).resize(size, size).png().toFile(new URL(`../assets/icons/${size === 180 ? 'apple-touch-icon' : `icon-${size}`}.png`, import.meta.url).pathname);
}
const opaque = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#17212b"/></svg>';
await sharp(Buffer.from(opaque)).composite([{ input: await sharp(source).resize(410, 410).png().toBuffer(), gravity: 'centre' }]).png().toFile(new URL('../assets/icons/icon-maskable-512.png', import.meta.url).pathname);
// TV launcher icons are rasterized directly, without screenshot cropping.
await sharp(source).resize(117, 117).png().toFile(new URL('../tizen/icon.png', import.meta.url).pathname);
await sharp(readFileSync(new URL('../android/tv-banner.svg', import.meta.url))).png().toFile(new URL('../android/app/src/main/res/drawable-xhdpi/tv_banner.png', import.meta.url).pathname);
