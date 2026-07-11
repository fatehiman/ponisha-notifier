'use strict';

const fs = require('node:fs');
const path = require('node:path');

// When packaged into an .exe with pkg, config/session live next to the .exe so
// the user can edit `ponisha-notifier.conf` without touching the binary. In dev
// they live in the project root.
const isPackaged = !!process.pkg;
const baseDir = isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..');

const CONF_NAME = 'ponisha-notifier.conf';
const CONF_PATH = path.join(baseDir, CONF_NAME);
const SESSION_PATH = path.join(baseDir, '.ponisha-notifier.session.json');

// Defaults. `sms_url` keeps the exact webhook the user gave; {count} is replaced
// with the number of unread messages (a plain integer, no encoding needed).
const DEFAULTS = {
  interval: 5, // minutes
  api_base: 'https://api.ponisha.ir/api/v1',
  sms_url:
    'https://sms.kimiasoft.com/sendMsg?p=8798495&c=t&r=monitoring&m=ponisha%20new%20msg%3d{count}',
  // Resend the SMS every interval while unread > 0 (true), or only when the
  // unread count changes / newly rises above zero (false).
  resend_every_interval: true,
};

function parseConf(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function toBool(v, dflt) {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function loadConfig() {
  if (!fs.existsSync(CONF_PATH)) {
    throw new Error(
      `Config file not found: ${CONF_PATH}\n` +
        `Copy "${CONF_NAME}.sample" to "${CONF_NAME}" and fill in your credentials.`,
    );
  }
  const parsed = parseConf(fs.readFileSync(CONF_PATH, 'utf8'));

  const username = (parsed.username || '').trim();
  const password = parsed.password || '';
  if (!username || !password) {
    throw new Error(`"username" and "password" are required in ${CONF_PATH}`);
  }

  const intervalMin = Number(parsed.interval) > 0 ? Number(parsed.interval) : DEFAULTS.interval;

  return {
    username,
    password,
    // A username with "@" is an email; otherwise treat it as a mobile number.
    loginField: username.includes('@') ? 'email' : 'mobile',
    intervalMs: Math.round(intervalMin * 60 * 1000),
    intervalMin,
    apiBase: (parsed.api_base || DEFAULTS.api_base).replace(/\/$/, ''),
    smsUrl: parsed.sms_url || DEFAULTS.sms_url,
    resendEveryInterval: toBool(parsed.resend_every_interval, DEFAULTS.resend_every_interval),
    paths: { conf: CONF_PATH, session: SESSION_PATH, base: baseDir },
  };
}

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), 'utf8');
  } catch {
    /* non-fatal: we just re-login next time */
  }
}

module.exports = { loadConfig, loadSession, saveSession, DEFAULTS };
