import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const clips = [
  'https://videos.pexels.com/video-files/7125369/7125369-sd_426_240_30fps.mp4',
  'https://videos.pexels.com/video-files/17700150/17700150-sd_426_240_30fps.mp4',
  'https://videos.pexels.com/video-files/34678935/14699130_640_360_50fps.mp4',
  'https://videos.pexels.com/video-files/20048065/20048065-sd_426_240_30fps.mp4',
] as const;
const encoder = new TextEncoder();
const AUDIO_SOURCE = 'anullsrc=channel_layout=stereo:sample_rate=48000';

const elements = {
  video: document.getElementById('stitched') as HTMLVideoElement | null,
  status: document.getElementById('status') as HTMLDivElement | null,
  lengthBadge: document.getElementById('length-badge') as HTMLSpanElement | null,
};

if (!elements.video || !elements.status || !elements.lengthBadge) {
  throw new Error('Missing required DOM nodes for stitched player.');
}

const ffmpeg = new FFmpeg();
let ffmpegReady = false;
let objectUrl: string | undefined;

ffmpeg.on('progress', ({ progress }) => {
  if (typeof progress === 'number') {
    const pct = Math.round(progress * 100);
    setStatus(`Processing… ${pct}%`);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await ensureCore();
    const rawFiles = await downloadClips();
    const cleanupFiles = new Set(rawFiles);
    const concatSources: string[] = [];

    for (let i = 0; i < rawFiles.length; i += 1) {
      const raw = rawFiles[i];
      const ensured = await ensureAudioTrack(raw, i);
      concatSources.push(ensured);
      cleanupFiles.add(ensured);
    }

    setStatus(`Downloaded ${rawFiles.length} clip(s)`);
    const stitched = await stitch(concatSources);
    await presentResult(stitched);
    await Promise.all(Array.from(cleanupFiles).map(safeDelete));
    setStatus('Done. Press play!');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? `Failed: ${error.message}` : 'Failed to process clips.');
  }
});

async function ensureCore() {
  if (ffmpegReady) return;
  setStatus('Loading…');
  await ffmpeg.load();
  ffmpegReady = true;
}

async function downloadClips() {
  setStatus('Fetching clips…');
  const written: string[] = [];

  for (let i = 0; i < clips.length; i += 1) {
    const url = clips[i];
    const filename = `raw-${i}.mp4`;
    setStatus(`Downloading clip ${i + 1}/${clips.length}`);
    const data = await fetchFile(url);
    await ffmpeg.writeFile(filename, data);
    written.push(filename);
  }

  return written;
}

async function ensureAudioTrack(filename: string, index: number) {
  const output = `stitch-ready-${index}.mp4`;
  const hasAudio = await clipHasAudio(filename, index);

  if (hasAudio) {
    setStatus(`Clip ${index + 1}: remuxing source audio`);
    await ffmpeg.exec([
      '-y',
      '-i',
      filename,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      output,
    ]);
    return output;
  }

  setStatus(`Clip ${index + 1}: injecting silent audio track`);
  await ffmpeg.exec([
    '-y',
    '-i',
    filename,
    '-f',
    'lavfi',
    '-i',
    AUDIO_SOURCE,
    '-shortest',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ]);

  return output;
}

async function clipHasAudio(filename: string, index: number) {
  const probeFile = `probe-audio-${index}.aac`;
  try {
    await ffmpeg.exec(['-y', '-i', filename, '-map', '0:a:0', '-c', 'copy', '-frames:a', '1', probeFile]);
    const data = await ffmpeg.readFile(probeFile).catch(() => null);
    await safeDelete(probeFile);
    return Boolean(data && data.byteLength > 0);
  } catch (error) {
    await safeDelete(probeFile);
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('matches no streams') || message.includes('output file is empty')) {
      return false;
    }
    console.warn('Audio probe failed, assuming mute', error);
    return false;
  }
}

async function stitch(files: string[]) {
  setStatus('Concatenating clips (copy mode)…');
  const manifest = files.map((name) => `file '${name}'`).join('\n');
  await ffmpeg.writeFile('concat.txt', encoder.encode(manifest));
  await ffmpeg.exec(['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'stitched.mp4']);
  await safeDelete('concat.txt');
  return 'stitched.mp4';
}

async function presentResult(filename: string) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);

  const data = await ffmpeg.readFile(filename);
  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  objectUrl = URL.createObjectURL(blob);
  elements.video.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      elements.lengthBadge.textContent = `duration: ${elements.video.duration.toFixed(1)}s`;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not load stitched video metadata.'));
    };
    const cleanup = () => {
      elements.video.removeEventListener('loadedmetadata', onLoaded);
      elements.video.removeEventListener('error', onError);
    };
    elements.video.addEventListener('loadedmetadata', onLoaded, { once: true });
    elements.video.addEventListener('error', onError, { once: true });
    elements.video.load();
  });
}

async function safeDelete(filename: string) {
  try {
    await ffmpeg.deleteFile(filename);
  } catch {
    // eat missing file errors
  }
}

function setStatus(message: string) {
  elements.status.textContent = message;
}
