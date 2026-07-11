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
fs.writeFileSync(exePath, out);
console.log(`icon stamped (overlay ${overlay.length} bytes re-attached) -> ${exePath}`);
