// electron-builder afterPack hook. ffmpeg-static only downloads the FFmpeg for the
// machine running `npm install`, so a macOS build for the other architecture would
// ship an FFmpeg that cannot run. Swap in the matching binary before signing.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Arch } = require('electron-builder');

const ffmpegStatic = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static');
const cache = path.join(__dirname, '..', 'node_modules', '.cache');
const CPU_TYPES = { x64: 0x01000007, arm64: 0x0100000c };

// Reads the CPU type from a 64-bit Mach-O header; null for anything else.
function machOArch(file) {
  const header = Buffer.alloc(8);
  const descriptor = fs.openSync(file, 'r');
  try { fs.readSync(descriptor, header, 0, 8, 0); } finally { fs.closeSync(descriptor); }
  if (header.readUInt32LE(0) !== 0xfeedfacf) return null;
  return Object.keys(CPU_TYPES).find(arch => CPU_TYPES[arch] === header.readUInt32LE(4)) || null;
}

// Reuse ffmpeg-static's own installer so the release tag and source stay the pinned ones.
function downloadFfmpeg(arch) {
  const binary = path.join(cache, `ffmpeg-darwin-${arch}`, 'ffmpeg');
  if (fs.existsSync(binary) && machOArch(binary) === arch) return binary;
  fs.rmSync(path.dirname(binary), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  execFileSync(process.execPath, [path.join(ffmpegStatic, 'install.js')], { stdio: 'inherit', env: { ...process.env, FFMPEG_BIN: binary, npm_config_platform: 'darwin', npm_config_arch: arch } });
  return binary;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = Arch[context.arch];
  if (!CPU_TYPES[arch]) throw new Error(`No FFmpeg build is configured for macOS ${arch}.`);
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  const packaged = path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (machOArch(packaged) === arch) return;
  const source = downloadFfmpeg(arch);
  fs.copyFileSync(source, packaged);
  fs.chmodSync(packaged, 0o755);
  fs.copyFileSync(`${source}.LICENSE`, path.join(resources, 'licenses', 'FFmpeg-LICENSE.txt'));
  fs.copyFileSync(`${source}.README`, path.join(resources, 'licenses', 'FFmpeg-BUILD.txt'));
  if (machOArch(packaged) !== arch) throw new Error(`Packaged FFmpeg is not a macOS ${arch} binary: ${packaged}`);
  console.log(`  • replaced FFmpeg with the darwin-${arch} build`);
};
