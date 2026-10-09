import { createApiServer } from './http.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from './auth.mjs';
import { createImports } from './imports.mjs';
import { createHandler } from './app.mjs';
import { createLocalSync } from './local-sync.mjs';
import { librarySettings } from './library.mjs';
import { createStaticResolver } from './nas-static.mjs';
const auth = getAuth();
const settings = librarySettings();
const imports = createImports({ dataRoot: process.env.MUSIC_DATA_ROOT || join(homedir(), '.local/share/readiz-music/data'), synchronize: createLocalSync({ settings }) });
const staticRoot = process.env.MUSIC_STATIC_ROOT || '/opt/homebrew/var/www/readiz-music/current';
const handler = createHandler({ auth, imports, staticRoot, resolveStatic: createStaticResolver({ root: settings.root, settings: settings.static }), revision: process.env.MUSIC_REVISION || 'development' });
const server = createApiServer({ handler, origin: auth?.origin || 'https://music.readiz.com' });
server.listen(Number(process.env.MUSIC_PORT || 4525), '127.0.0.1', () => console.log('Readiz Music API ready on loopback'));
async function stop() { server.close(); await imports.close(); auth?.close(); server.closeAllConnections(); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
