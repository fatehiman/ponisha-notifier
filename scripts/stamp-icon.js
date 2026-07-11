'use strict';

// Stamp a Windows icon onto a pkg-built .exe WITHOUT breaking pkg's appended
// payload (the "overlay" after the last PE section). rcedit drops that overlay
// and corrupts the exe; resedit lets us re-attach it.

const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

const exePath = process.argv[2];
const icoPath = process.argv[3] || path.join(__dirname, '..', 'assets', 'icon.ico');
if (!exePath) {
  console.error('usage: node stamp-icon.js <exe> [ico]');
  process.exit(1);
}

const data = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });

// Capture the overlay (bytes past the end of the PE image) so we can re-append
// it — this is where pkg stores its snapshot.
function overlayOf(buf, ntexe) {
  // Highest end offset among sections + headers = the PE image size on disk.
  let end = 0;
  for (const s of ntexe.getAllSections()) {
    const e = s.info.pointerToRawData + s.info.sizeOfRawData;
    if (e > end) end = e;
  }
  return end < buf.length ? buf.subarray(end) : Buffer.alloc(0);
}
const overlay = overlayOf(data, exe);

const res = ResEdit.NtExecutableResource.from(exe);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,
  1033,
  iconFile.icons.map((i) => i.data),
);
res.outputResource(exe);

let out = Buffer.from(exe.generate());
if (overlay.length) out = Buffer.concat([out, overlay]);

// Flip the PE subsystem from Console (3) to Windows GUI (2) so Windows never
// attaches a console window (a console-subsystem exe shows a cmd window that,
// when closed, kills the app). Subsystem field sits at optionalHeader+68, and
// optionalHeader starts at e_lfanew(0x3C) + 4 (PE sig) + 20 (COFF header).
function setGuiSubsystem(buf) {
  const eLfanew = buf.readUInt32LE(0x3c);
  if (buf.toString('ascii', eLfanew, eLfanew + 4) !== 'PE\0\0') {
    console.warn('subsystem patch skipped: PE signature not found');
    return;
  }
  const subsystemOff = eLfanew + 4 + 20 + 68;
  const current = buf.readUInt16LE(subsystemOff);
  if (current === 3) {
    buf.writeUInt16LE(2, subsystemOff);
    console.log('subsystem set to Windows GUI (no console window)');
  } else {
    console.log(`subsystem already ${current} (left unchanged)`);
  }
}
setGuiSubsystem(out);

fs.writeFileSync(exePath, out);
console.log(`icon stamped (overlay ${overlay.length} bytes re-attached) -> ${exePath}`);
