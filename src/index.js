'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { getUnread, sendSms } = require('./ponisha');
const { Tray } = require('./tray');

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

let logFile = null;
function log(...args) {
  const line = `[${ts()}] ${args.join(' ')}`;
  process.stdout.write(line + '\n');
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch {
      /* ignore */
    }
  }
}

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // No tray yet — surface the config error and exit.
    process.stderr.write(`\nConfiguration error:\n${e.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  logFile = path.join(config.paths.base, 'ponisha-notifier.log');
  log(`ponisha-notifier starting · interval ${config.intervalMin} min · user ${config.username}`);

  const tray = new Tray();
  let timer = null;
  let checking = false;
  let lastUnread = -1;

  async function runCheck(trigger) {
    if (checking) {
      log(`check skipped (${trigger}): a check is already running`);
      return;
    }
    checking = true;
    try {
      const { total, unread } = await getUnread(config, log);
      log(`check (${trigger}): total=${total} unread=${unread}`);

      if (unread > 0) {
        const shouldSend = config.resendEveryInterval || unread !== lastUnread;
        if (shouldSend) {
          try {
            await sendSms(config, unread, log);
            tray.balloon('Ponisha — new message', `${unread} unread message(s)`);
          } catch (e) {
            log(`sms failed: ${e.message}`);
          }
        }
      }
      lastUnread = unread;
      tray.tooltip(`Ponisha Notifier · unread: ${unread} · ${ts().slice(11)}`);
    } catch (e) {
      log(`check error (${trigger}): ${e.message}`);
      tray.tooltip(`Ponisha Notifier · error · ${ts().slice(11)}`);
    } finally {
      checking = false;
    }
  }

  function startInterval(trigger) {
    if (timer) clearInterval(timer);
    timer = setInterval(() => runCheck('interval'), config.intervalMs);
    runCheck(trigger); // immediate check on (re)start
  }

  // "Check now" runs an immediate check AND (re)starts the interval, per spec.
  tray.on('check', () => {
    log('tray: Check now');
    startInterval('manual');
  });

  tray.on('exit', () => {
    log('tray: Exit');
    shutdown();
  });

  tray.on('closed', () => {
    log('tray closed');
    shutdown();
  });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (timer) clearInterval(timer);
    try {
      tray.stop();
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 300);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Auto-start so the notifier works unattended; "Check now" restarts it.
  startInterval('startup');
}

main();
