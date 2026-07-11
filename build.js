'use strict';

// Build a single Windows .exe from the Node sources and stamp it with the icon.
//
//   npm install     # once, to fetch @yao-pkg/pkg + rcedit
//   npm run build   # -> dist/ponisha-notifier.exe
//
// The tray.ps1 is bundled into the snapshot via the "pkg.assets" resolution of
// fs.readFileSync(path.join(__dirname,'tray.ps1')); pkg detects that literal
// path automatically. If it ever misses it, add "src/tray.ps1" to package.json
// "pkg": { "assets": [...] }.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = __dirname;
const outDir = path.join(root, 'dist');
const outExe = path.join(outDir, 'ponisha-notifier.exe');
const icon = path.join(root, 'assets', 'icon.ico');

fs.mkdirSync(outDir, { recursive: true });

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
}

// 1) Compile. node22 has prebuilt bases in @yao-pkg/pkg-fetch (node18 does not).
run('npx', ['--yes', '@yao-pkg/pkg', 'src/index.js', '--targets', 'node22-win-x64', '--output', outExe]);

// 2) Stamp the exe icon with resedit. NOTE: rcedit does NOT work here — it drops
// pkg's appended payload and the exe fails with "Pkg: Error reading from file".
// stamp-icon.js edits the PE resources and re-attaches the overlay.
try {
  run('node', [path.join('scripts', 'stamp-icon.js'), outExe, icon]);
} catch (e) {
  console.warn(`icon stamp skipped (exe still works, just no file icon): ${e.message}`);
}

console.log(`\nBuilt: ${outExe}`);
