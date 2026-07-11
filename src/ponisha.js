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

const PAGE_LIMIT = 50; // conversations per page (matches the web app)
const MAX_PAGES = 20; // safety cap

function sumUnread(list) {
  return (list || []).reduce((s, c) => s + (Number(c.unread_count) || 0), 0);
}

// Unread MESSAGES come from the chat service — each conversation carries an
// `unread_count`; the badge is the sum. (The api.ponisha.ir notifications/count
// endpoint only counts site notifications, not chat messages.)
//
// Returns { total, unread }: total = conversations scanned, unread = sum of
// unread_count. Re-logs in once on 401 (expired/invalid session).
async function getUnread(config, log, { forceLogin = false } = {}) {
  let token = forceLogin ? null : (loadSession() || {}).token;
  if (!token) token = await login(config, log);

  const fetchPage = (tok, page) =>
    fetch(`${config.chatBase}/conversations?limit=${PAGE_LIMIT}&page=${page}`, {
      headers: { ...baseHeaders(), Authorization: `Bearer ${tok}` },
    });

  let res = await fetchPage(token, 1);
  if (res.status === 401 && !forceLogin) {
    log('session expired — re-logging in');
    token = await login(config, log);
    res = await fetchPage(token, 1);
  }
  if (!res.ok) throw new Error(`unread check failed (HTTP ${res.status})`);

  let json = await res.json();
  let list = Array.isArray(json.data) ? json.data : [];
  let unread = sumUnread(list);
  let total = list.length;

  // Conversations are newest-first, so unread ones are on early pages; still,
  // page through any full pages to be exact (bounded by MAX_PAGES).
  let page = 1;
  while (list.length >= PAGE_LIMIT && page < MAX_PAGES) {
    page += 1;
    const r = await fetchPage(token, page);
    if (!r.ok) break;
    json = await r.json();
    list = Array.isArray(json.data) ? json.data : [];
    unread += sumUnread(list);
    total += list.length;
  }

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
