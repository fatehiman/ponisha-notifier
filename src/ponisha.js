'use strict';

const { loadSession, saveSession } = require('./config');

// Present as a normal Chrome on Windows (headers only — this is a plain HTTPS
// client, but ponisha's WAF is friendlier to browser-looking requests).
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function baseHeaders() {
  return {
    'User-Agent': CHROME_UA,
    Accept: 'application/json',
    'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
    Origin: 'https://ponisha.ir',
    Referer: 'https://ponisha.ir/',
    'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
}

// The login response shape isn't documented, so pull the token out defensively:
// the first long string living under a key that looks like an auth token.
function findToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const keyRe = /(^|_|\b)(token|jwt|access[_-]?token|api[_-]?token|bearer)($|_|\b)/i;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && keyRe.test(k) && v.length >= 16) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const t = findToken(v, depth + 1);
      if (t) return t;
    }
  }
  return null;
}

async function login(config, log) {
  const url = `${config.apiBase}/auth/login`;
  const body = { [config.loginField]: config.username, password: config.password };
  log(`login → ${config.loginField}=${config.username}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* keep raw */
  }

  if (!res.ok) {
    const msg = (json && (json.message || JSON.stringify(json.errors))) || raw.slice(0, 200);
    throw new Error(`login failed (HTTP ${res.status}): ${msg}`);
  }

  const token = findToken(json);
  if (!token) {
    throw new Error(
      `login succeeded but no token found in response. Keys: ${
        json ? Object.keys(json).join(', ') : '(non-JSON)'
      }`,
    );
  }
  const session = { token, savedAt: new Date().toISOString(), username: config.username };
  saveSession(session);
  log('login ok — token cached');
  return token;
}

// Returns { total, unread }. Re-logs in once on 401 (expired/invalid session).
async function getUnread(config, log, { forceLogin = false } = {}) {
  let token = forceLogin ? null : (loadSession() || {}).token;
  if (!token) token = await login(config, log);

  const url = `${config.apiBase}/users/me/notifications/count`;
  let res = await fetch(url, { headers: { ...baseHeaders(), Authorization: `Bearer ${token}` } });

  if (res.status === 401 && !forceLogin) {
    log('session expired — re-logging in');
    token = await login(config, log);
    res = await fetch(url, { headers: { ...baseHeaders(), Authorization: `Bearer ${token}` } });
  }

  if (!res.ok) {
    throw new Error(`count check failed (HTTP ${res.status})`);
  }
  const json = await res.json();
  const data = (json && json.data) || {};
  const total = Number(data.total ?? 0);
  const unread = Number(data.unread ?? 0);
  return { total, unread };
}

// Fire the SMS/Telegram webhook with the unread count substituted for {count}.
async function sendSms(config, count, log) {
  const url = config.smsUrl.replace(/\{count\}/g, String(count));
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } });
  const body = (await res.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ').trim();
  log(`sms webhook → HTTP ${res.status}${body ? ` · ${body}` : ''}`);
  if (!res.ok) throw new Error(`sms webhook HTTP ${res.status}`);
}

module.exports = { login, getUnread, sendSms };
