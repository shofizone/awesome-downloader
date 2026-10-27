import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { promises as fs, accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

function executablesOnPath(name) {
  const found = [];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try { accessSync(candidate, fsConstants.X_OK); found.push(candidate); }
    catch { /* Try the next directory. */ }
  }
  return found;
}

const unpacked = value => String(value).replace('app.asar', 'app.asar.unpacked');

// Ordered FFmpeg candidates. A user override always wins; otherwise the
// bundled binary is preferred, with every distribution FFmpeg found on PATH as
// a fallback on Linux because some fully static builds crash while demuxing
// MPEG-TS (HLS). Listing all matches matters when a broken build sits earlier
// on PATH than a working one. Windows keeps using the bundled executable only.
function ffmpegCandidates() {
  const candidates = [];
  if (process.env.AWESOME_FFMPEG_PATH) candidates.push(process.env.AWESOME_FFMPEG_PATH);
  candidates.push(ffmpegPath);
  if (process.platform !== 'win32') candidates.push(...executablesOnPath('ffmpeg'));
  return [...new Set(candidates.filter(Boolean).map(unpacked))];
}

let workingExecutable = null;
export function ffmpegExecutable() {
  return workingExecutable || ffmpegCandidates()[0];
}

function mediaProcessError(action, code, stderr) {
  const detail = stderr || `media process exited ${code}`;
  // A null exit code means the process died from a signal (it crashed), which
  // on Linux usually points at an incompatible bundled static build.
  const hint = code === null && process.platform !== 'win32'
    ? ' The media process failed to run or crashed; install your distribution FFmpeg (it is used automatically as a fallback) or set AWESOME_FFMPEG_PATH to a working ffmpeg executable.'
    : '';
  return new Error(`Could not ${action}: ${detail}${hint}`);
}

function runMedia(executable, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, signal, stdio: ['ignore','ignore','pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.once('error', reject);
    child.once('close', (code, terminatedBy) => resolve({ code, terminatedBy, stderr }));
  });
}

async function transcode(args, signal, action) {
  const candidates = ffmpegCandidates();
  const current = candidates.indexOf(workingExecutable);
  // Keep using the build that worked last, then try the rest.
  if (current > 0) candidates.unshift(...candidates.splice(current, 1));
  let last = null;
  for (const executable of candidates) {
    let result;
    try { result = await runMedia(executable, args, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      // A missing or non-executable candidate must not block the others.
      last = { code: null, stderr: error.message };
      continue;
    }
    if (result.code === 0) { workingExecutable = executable; return; }
    last = result;
    // Retry another build only when the process crashed (a signal). Ordinary
    // failures would repeat with the same input on any build.
    if (result.code !== null || signal?.aborted) break;
  }
  throw mediaProcessError(action, last?.code ?? null, last?.stderr);
}

export async function muxTracks(directory, videoCount, count, signal) {
  for (const [name, start, end] of [['video',0,videoCount],['audio',videoCount,count]]) {
    const output = await fs.open(path.join(directory, name+'.track'), 'w');
    try {
      for (let i=start;i<end;i++) {
        const input = await fs.open(path.join(directory, `${i}.part`), 'r');
        try { for await (const chunk of input.createReadStream()) { signal.throwIfAborted(); await output.writeFile(chunk); } }
        finally { await input.close(); }
      }
    } finally { await output.close(); }
  }
  const output = path.join(directory,'combined.mp4');
  await transcode(['-nostdin','-v','error','-y','-protocol_whitelist','file,pipe','-i',path.join(directory,'video.track'),'-protocol_whitelist','file,pipe','-i',path.join(directory,'audio.track'),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',output], signal, 'combine video and audio');
  return output;
}

export async function convertMedia(directory, files, format, signal) {
  if(!['mp4','mp3'].includes(format))throw new Error('Unsupported output format.');
  const source=path.join(directory,'conversion-source.track');
  const out=await fs.open(source,'w');
  try {for(const file of files){const input=await fs.open(file,'r');try{for await(const chunk of input.createReadStream()){signal.throwIfAborted();await out.writeFile(chunk);}}finally{await input.close();}}}finally{await out.close();}
  const output=path.join(directory,'converted.'+format);
  const args=['-nostdin','-v','error','-y','-protocol_whitelist','file,pipe','-i',source];
  args.push(...(format==='mp3'?['-map','0:a:0','-vn','-c:a','libmp3lame','-q:a','2']:['-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart']),output);
  await transcode(args, signal, `create ${format.toUpperCase()}`);
  return output;
}

// The codec of a file's first video stream as FFmpeg names it, e.g. 'h264' or 'av1'.
export async function videoCodec(file, signal) {
  // Without an output FFmpeg exits with an error, but it has printed the stream list.
  const { stderr } = await runMedia(ffmpegExecutable(), ['-hide_banner', '-nostdin', '-i', file], signal);
  return /Stream #\d+:\d+\S*: Video: (\w+)/.exec(stderr)?.[1] ?? null;
}

// Re-encodes the video track to H.264, which every player plays, and copies the audio.
// bitsPerSecond is the chosen H.264 format's bitrate, so the result is about the size
// of a direct H.264 download; without it a fixed quality is used.
export async function convertVideoToH264(directory, input, signal, bitsPerSecond) {
  const output = path.join(directory, 'converted-h264.mp4');
  const rate = bitsPerSecond ? ['-b:v', String(bitsPerSecond), '-maxrate', String(bitsPerSecond * 2), '-bufsize', String(bitsPerSecond * 4)] : null;
  // macOS encodes in hardware with VideoToolbox, which has no -crf; use a fixed rate instead.
  const encoder = process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', ...(rate || ['-b:v', '6000000'])] : ['-c:v', 'libx264', '-preset', 'veryfast', ...(rate || ['-crf', '21'])];
  await transcode(['-nostdin','-v','error','-y','-i',input,'-map','0:v:0','-map','0:a:0?',...encoder,'-pix_fmt','yuv420p','-tag:v','avc1','-c:a','copy','-movflags','+faststart',output], signal, 'convert the video to H.264');
  return output;
}
