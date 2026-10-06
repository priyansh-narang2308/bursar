import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { type BeatTime, type Narration, plan } from '../src/timeline';
import type { DemoProps } from '../src/Video';

/*
 * Renders the finished demo video: the screen recording, a voice for each beat, and captions, to MP4.
 *
 *   pnpm demo:video                 # MODE=live by default
 *
 * Needs the take (`pnpm demo:record`), the narration (`pnpm demo:narrate`), and Chrome. It uses the Chrome that is
 * installed (set CHROME to another path if it is somewhere else), so nothing extra is downloaded.
 */
const MODE = process.env['MODE'] ?? 'live';
const ROOT = join(import.meta.dirname, '..', '..', '..');
const PUBLIC = join(ROOT, '.demo');
const DOCS = join(ROOT, 'docs', 'submission');
const OUT = join(PUBLIC, MODE, 'final.mp4');

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const beats = read<BeatTime[]>(join(DOCS, `timeline-${MODE}.json`));
const narration = read<Narration[]>(join(DOCS, `narration-${MODE}.json`));
const durationsMs = read<Record<string, number>>(join(PUBLIC, 'voice', MODE, 'durations.json'));

const result = plan({ beats, narration, durationsMs });
if (result.overruns.length > 0) {
  throw new Error(
    `The voice runs into the next beat in: ${result.overruns.join(', ')}. Run pnpm demo:record again so the beats are held for the real audio.`,
  );
}

const props: DemoProps = {
  videoSrc: `${MODE}/demo.mp4`,
  durationMs: result.durationMs,
  audio: result.audio.map((clip) => ({ ...clip, src: `voice/${MODE}/${clip.id}.wav` })),
  cues: result.cues,
};

const chrome =
  process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserExecutable = existsSync(chrome) ? chrome : null;

// Only the files this video needs go in the bundle's public folder, not the voice model or every old take.
const STAGE = join(PUBLIC, 'stage');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'voice', MODE), { recursive: true });
mkdirSync(join(STAGE, MODE), { recursive: true });
copyFileSync(join(PUBLIC, MODE, 'demo.mp4'), join(STAGE, props.videoSrc));
for (const clip of props.audio) copyFileSync(join(PUBLIC, clip.src), join(STAGE, clip.src));

const serveUrl = await bundle({
  entryPoint: join(import.meta.dirname, '..', 'src', 'index.ts'),
  publicDir: STAGE,
});
const inputProps = props;
const composition = await selectComposition({
  serveUrl,
  id: 'Demo',
  inputProps,
  browserExecutable,
});
mkdirSync(dirname(OUT), { recursive: true });
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  crf: 20,
  inputProps,
  browserExecutable,
  outputLocation: OUT,
  onProgress: ({ progress }) => {
    const percent = Math.floor(progress * 100);
    if (percent !== last && percent % 10 === 0) process.stderr.write(`${percent}%\n`);
    last = percent;
  },
});
process.stdout.write(`${OUT} (${(result.durationMs / 1000).toFixed(1)} s)\n`);
