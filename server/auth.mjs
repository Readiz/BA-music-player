// Adapted from new-home Discord auth; music owns separate cookies, state and storage.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

                             
                 
                   
                       
                      
                           
                        
                    
 
                           
             
                   
                      
 
                                                                              
export class AuthError extends Error {
  code               ;
  constructor(code, reason = code, upstreamStatus) {
    super(code);
    this.code = code;
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

const STATE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;
const cookiePattern = /^[A-Za-z0-9_-]{32,100}$/;

export function safeReturnTo(value                           )         {
  if (!value || !value.startsWith('/') || value.startsWith('//'))
    return '/#add-music';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\x00-\x20\x7f]/.test(decoded))
      return '/#add-music';
    const url = new URL(value, 'https://local.invalid');
    return url.origin === 'https://local.invalid'
      ? `${url.pathname}${url.search}${url.hash}`
      : '/#add-music';
  } catch {
    return '/#add-music';
  }
}

export function cookieValue(request         , name        )         {
  const parts = (request.headers.get('cookie') || '').split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function validateConfig(config            )       {
  const origin = new URL(config.origin);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (
    origin.origin !== config.origin ||
    (!local && origin.protocol !== 'https:')
  ) {
    throw new Error(
      'MUSIC_AUTH_CONFIG requires an HTTPS origin (HTTP is allowed only on loopback).',
    );
  }
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('Invalid auth origin.');
  if (
    !config.clientId ||
    !config.clientSecret ||
    typeof config.sessionSecret !== 'string' ||
    config.sessionSecret.length < 32
  ) {
    throw new Error(
      'MUSIC_AUTH_CONFIG is missing credentials or a session secret of at least 32 characters.',
    );
  }
  if (
    !Array.isArray(config.allowedUserIds) ||
    !config.allowedUserIds.length ||
    !config.allowedUserIds.every((id) => /^\d+$/.test(id))
  ) {
    throw new Error(
      'MUSIC_AUTH_CONFIG requires an explicit Discord user allowlist.',
    );
  }
  const redirect = new URL(config.redirectUri);
  if (
    redirect.protocol !== 'https:' &&
    !(local && redirect.origin === origin.origin)
  ) {
    throw new Error('Invalid Discord callback URL.');
  }
  if (config.storePath !== ':memory:' && !isAbsolute(config.storePath)) {
    throw new Error(
      'The session database path must be absolute and outside public build directories.',
    );
  }
}

export function createAuth(
  config            ,
  options                                               = {},
) {
  validateConfig(config);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const secure = config.origin.startsWith('https:');
  const sessionCookie = `${secure ? '__Host-' : ''}readiz_music_session`;
  const stateCookie = `${secure ? '__Host-' : ''}readiz_music_oauth`;
  const allowed = new Set(config.allowedUserIds);
  if (config.storePath !== ':memory:')
    mkdirSync(dirname(config.storePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.storePath);
  if (config.storePath !== ':memory:') chmodSync(config.storePath, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, return_to TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL, expires_at INTEGER NOT NULL);
  `);
  const hash = (value        ) =>
    createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  const cookie = (name        , value        , ttl        ) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}${secure ? '; Secure' : ''}`;
  function prune() {
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(now());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  }
  const rate = new Map                                            ();
  function limited(key        , max        )          {
    for (const [id, bucket] of rate)
      if (bucket.expires <= now()) rate.delete(id);
    const bucket = rate.get(key);
    if (bucket) return ++bucket.count > max;
    if (rate.size >= 1024) return true;
    rate.set(key, { count: 1, expires: now() + 60_000 });
    return false;
  }

  function begin(returnTo                ) {
    prune();
    const count = db
      .prepare('SELECT count(*) AS count FROM oauth_states')
      .get()                     ;
    if (count.count >= 256) throw new AuthError('busy');
    const state = `music_${randomBytes(32).toString('base64url')}`;
    db.prepare('INSERT INTO oauth_states VALUES (?, ?, ?)').run(
      hash(state),
      safeReturnTo(returnTo),
      now() + STATE_TTL,
    );
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    return {
      location: `https://discord.com/oauth2/authorize?${params}`,
      cookie: cookie(stateCookie, state, STATE_TTL),
    };
  }

  function user(request         )                  {
    const token = cookieValue(request, sessionCookie);
    if (!cookiePattern.test(token)) return null;
    const row = db
      .prepare('SELECT * FROM sessions WHERE hash = ? AND expires_at > ?')
      .get(hash(token), now())   
                                                                             ;
    if (!row || !allowed.has(row.user_id)) return null;
    return {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
    };
  }

  function revoke(request         ) {
    const token = cookieValue(request, sessionCookie);
    if (cookiePattern.test(token))
      db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(token));
  }

  async function complete(request         ) {
    const params = new URL(request.url).searchParams;
    const state = params.get('state') ?? '';
    const bound = cookieValue(request, stateCookie);
    if (!cookiePattern.test(state)) throw new AuthError('state', 'state_invalid');
    if (!bound) throw new AuthError('state', 'state_cookie_missing');
    if (!cookiePattern.test(bound)) throw new AuthError('state', 'state_cookie_invalid');
    if (state.length !== bound.length || !timingSafeEqual(Buffer.from(state), Buffer.from(bound)))
      throw new AuthError('state', 'state_cookie_mismatch');
    // DELETE ... RETURNING consumes the state atomically before any network await.
    const saved = db
      .prepare(
        'DELETE FROM oauth_states WHERE hash = ? RETURNING return_to, expires_at',
      )
      .get(hash(state))   
                                                           ;
    if (!saved) throw new AuthError('state', 'state_consumed_or_unknown');
    if (saved.expires_at <= now()) throw new AuthError('state', 'state_expired');
    if (params.has('error')) throw new AuthError('cancelled');
    const code = params.get('code');
    if (!code || code.length > 2048) throw new AuthError('state', 'code_missing_or_invalid');
    let profile;
    let stage = 'token';
    try {
      const tokenResponse = await fetcher(
        'https://discord.com/api/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirectUri,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!tokenResponse.ok) throw new AuthError('discord', 'token_http_error', tokenResponse.status);
      const token = await tokenResponse.json();
      if (typeof token.access_token !== 'string' || !token.access_token)
        throw new AuthError('discord', 'token_invalid_response');
      stage = 'profile';
      const profileResponse = await fetcher(
        'https://discord.com/api/users/@me',
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!profileResponse.ok) throw new AuthError('discord', 'profile_http_error', profileResponse.status);
      profile = await profileResponse.json();
      if (
        typeof profile.id !== 'string' ||
        typeof profile.username !== 'string'
      )
        throw new AuthError('discord', 'profile_invalid_response');
    } catch (error) {
      // Only controlled reason labels and HTTP status leave this boundary.
      if (error instanceof AuthError) throw error;
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new AuthError('discord', `${stage}_${timeout ? 'timeout' : 'request_failed'}`);
    }
    if (!allowed.has(profile.id)) throw new AuthError('forbidden');
    prune();
    revoke(request);
    // Keep at most ten active devices per account.
    db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND hash NOT IN (SELECT hash FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 9)',
    ).run(profile.id, profile.id);
    const token = randomBytes(32).toString('base64url');
    const displayName =
      typeof profile.global_name === 'string' && profile.global_name
        ? profile.global_name
        : profile.username;
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(
      hash(token),
      profile.id,
      profile.username,
      displayName,
      now() + SESSION_TTL,
    );
    return {
      location: saved.return_to,
      cookie: cookie(sessionCookie, token, SESSION_TTL),
    };
  }

  return {
    origin: config.origin,
    storePath: config.storePath,
    sessionCookie,
    stateCookie,
    isAllowedUser: (id        ) => allowed.has(id),
    begin,
    complete,
    user,
    revoke,
    limited,
    clearState: () => cookie(stateCookie, '', 0),
    clearSession: () => cookie(sessionCookie, '', 0),
    close: () => db.close(),
  };
}

                                                        
let instance                                ;
export function getAuth()                     {
  if (instance !== undefined) return instance;
  const path = process.env.MUSIC_AUTH_CONFIG;
  instance = path ? createAuth(JSON.parse(readFileSync(path, 'utf8'))) : null;
  return instance;
}
