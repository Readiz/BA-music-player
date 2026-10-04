import { createHash } from 'node:crypto';

export function authClient(request) {
  const ua = request.headers.get('user-agent') || '';
  if (/ReadizMusic(?:TV)?\//.test(ua)) return 'android-app';
  if (/Android/.test(ua)) return 'android-browser';
  if (/iPhone|iPad/.test(ua)) return 'ios-browser';
  return 'browser-or-other';
}

// Fixed fields only: no URLs, OAuth codes/state, cookies, profiles, IPs, tokens,
// upstream bodies or exception messages. A one-way flow tag joins start/callback.
export function authLog(event, request, details = {}, write = console.info) {
  const value = {
    time: new Date().toISOString(),
    event,
    client: authClient(request),
  };
  if (typeof details.state === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(details.state)) {
    value.flow = createHash('sha256').update(details.state).digest('hex').slice(0, 16);
  }
  for (const key of ['code', 'reason']) {
    if (typeof details[key] === 'string' && /^[a-z_-]{1,64}$/.test(details[key])) value[key] = details[key];
  }
  for (const key of ['hasStateCookie', 'hasCode']) {
    if (typeof details[key] === 'boolean') value[key] = details[key];
  }
  if (Number.isInteger(details.upstreamStatus) && details.upstreamStatus >= 100 && details.upstreamStatus <= 599) {
    value.upstreamStatus = details.upstreamStatus;
  }
  write(JSON.stringify(value));
}
