'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

// PowerShell can't run a script that lives inside the pkg snapshot FS, so we read
// the embedded tray.ps1 (bundled via the pkg "assets" field) and drop it into a
// real temp file, then launch it with -File.
function materializeScript() {
  const src = fs.readFileSync(path.join(__dirname, 'tray.ps1'), 'utf8');
  const dest = path.join(os.tmpdir(), `ponisha-notifier-tray-${process.pid}.ps1`);
  fs.writeFileSync(dest, src, 'utf8');
  return dest;
}

// Locate powershell.exe (present on every supported Windows).
function powershellExe() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidate = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

class Tray extends EventEmitter {
  constructor() {
    super();
    this._scriptPath = materializeScript();
    this._proc = spawn(
      powershellExe(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', this._scriptPath],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );

    let buf = '';
    this._proc.stdout.setEncoding('utf8');
    this._proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === 'CLICK_CHECK') this.emit('check');
        else if (line === 'CLICK_EXIT') this.emit('exit');
      }
    });
    this._proc.on('exit', () => {
      this._cleanup();
      this.emit('closed');
    });
  }

  _send(line) {
    if (this._proc && this._proc.stdin.writable) {
      try {
        this._proc.stdin.write(line.replace(/[\r\n]+/g, ' ') + '\n');
      } catch {
        /* tray gone */
      }
    }
  }

  tooltip(text) {
    this._send(`TOOLTIP ${text}`);
  }

  balloon(title, text) {
    this._send(`BALLOON ${title}\t${text}`);
  }

  stop() {
    this._send('EXIT');
    setTimeout(() => {
      if (this._proc && !this._proc.killed) this._proc.kill();
    }, 800);
  }

  _cleanup() {
    try {
      fs.unlinkSync(this._scriptPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { Tray };
