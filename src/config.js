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

// Bundled sample (added to pkg "assets"); used to seed the .conf on first run.
const SAMPLE_PATH = path.join(__dirname, '..', `${CONF_NAME}.sample`);

// Placeholder values shipped in the sample — treated as "not configured yet".
const PLACEHOLDERS = new Set(['you@example.com', 'your-ponisha-password']);

// A friendly, typed error so index.js can show a message box (vs. a raw crash).
class ConfigError extends Error {
  constructor(message, { created = false } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.confPath = CONF_PATH;
    this.created = created; // true → we just wrote a fresh .conf to edit
  }
}

// Full commented sample, embedded so it always works even if the bundled asset
// can't be read from the pkg snapshot. Kept in sync with the .sample file.
const SAMPLE_TEXT = [
  '# ===============================================================',
  '#  Ponisha Notifier - configuration',
  '#  Fill in your details below, save, then start the app again.',
  '#  Lines starting with # are ignored.',
  '# ===============================================================',
  '',
  '# How often to check for new messages, in MINUTES (default: 5)',
  'interval=5',
  '',
  '# Your ponisha.ir login.',
  '#   username = the email OR mobile number you log in with',
  '#              (contains "@"  -> treated as email,',
  '#               otherwise     -> treated as mobile)',
  'username=you@example.com',
  'password=your-ponisha-password',
  '',
  '# -- Advanced (optional) - the defaults below match the spec -----',
  '',
  '# Webhook fired when there are unread messages. {count} is replaced',
  '# with the number of unread messages (reaches Telegram via kimiasoft SMS).',
  '# sms_url=https://sms.kimiasoft.com/sendMsg?p=8798495&c=t&r=monitoring&m=ponisha%20new%20msg%3d{count}',
  '',
  '# Ponisha API base URL (used for login).',
  '# api_base=https://api.ponisha.ir/api/v1',
  '',
  '# Chat service base URL. Unread MESSAGES are counted here (sum of each',
  '# conversation unread_count); notifications/count does NOT count messages.',
  '# chat_base=https://chat.ponisha.ir/v1',
  '',
  '# true  -> fire the webhook every interval while unread > 0',
  '# false -> fire only when the unread count changes (rises)',
  '# resend_every_interval=true',
  '',
].join('\r\n');

function readSampleText() {
  try {
    return fs.readFileSync(SAMPLE_PATH, 'utf8');
  } catch {
    return SAMPLE_TEXT;
  }
}

// Defaults. `sms_url` keeps the exact webhook the user gave; {count} is replaced
// with the number of unread messages (a plain integer, no encoding needed).
const DEFAULTS = {
  interval: 5, // minutes
  api_base: 'https://api.ponisha.ir/api/v1',
  // Unread MESSAGES live in the separate chat service (not notifications/count).
  chat_base: 'https://chat.ponisha.ir/v1',
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
  // First run (no .conf next to the exe): create one from the sample and tell
  // the user to fill it in — instead of flashing a console and vanishing.
  if (!fs.existsSync(CONF_PATH)) {
    fs.writeFileSync(CONF_PATH, readSampleText(), 'utf8');
    throw new ConfigError(
      `A configuration file was created for you:\n\n${CONF_PATH}\n\n` +
        `Open it, enter your ponisha email/mobile and password, save, then start the app again.`,
      { created: true },
    );
  }
  const parsed = parseConf(fs.readFileSync(CONF_PATH, 'utf8'));

  const username = (parsed.username || '').trim();
  const password = parsed.password || '';
  if (!username || !password || PLACEHOLDERS.has(username) || PLACEHOLDERS.has(password)) {
    throw new ConfigError(
      `Please finish setting up your credentials in:\n\n${CONF_PATH}\n\n` +
        `Set "username" (your ponisha email or mobile) and "password", then start the app again.`,
    );
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
    chatBase: (parsed.chat_base || DEFAULTS.chat_base).replace(/\/$/, ''),
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

module.exports = { loadConfig, loadSession, saveSession, DEFAULTS, ConfigError };
