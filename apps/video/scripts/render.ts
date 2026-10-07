import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Shot } from '../src/camera';
import { type BeatTime, type Narration, plan, type Spans } from '../src/timeline';
import type { DemoProps, SoundEvent } from '../src/Video';

/*
 * Renders the finished demo film: the take, directed by a virtual camera from the shots the recorder noted, with the
 * voice, a music bed ducked under it, sound for each click and reveal, and captions, to MP4.
 *
 *   pnpm demo:video                       # MODE=live by default
 *   STILLS=12.5,48 pnpm demo:video        # just those moments (seconds), as PNGs in .demo/stills, to check a shot
 *   SITE=bursar-demo.onrender.com …       # the address the closing card shows, if the take ran elsewhere
 *
 * Needs the take (`pnpm demo:record`), the narration (`pnpm demo:narrate`), the sound (`apps/video/scripts/sound.py`)
 * and Chrome. It uses the Chrome that is installed (set CHROME to another path), so nothing extra is downloaded.
 */
const require = createRequire(import.meta.url);
const MODE = process.env['MODE'] ?? 'live';
const ROOT = join(import.meta.dirname, '..', '..', '..');
const PUBLIC = join(ROOT, '.demo');
const DOCS = join(ROOT, 'docs', 'submission');
const OUT = join(PUBLIC, MODE, 'final.mp4');

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const beats = read<BeatTime[]>(join(DOCS, `timeline-${MODE}.json`));
const narration = read<Narration[]>(join(DOCS, `narration-${MODE}.json`));
const durationsMs = read<Record<string, number>>(join(PUBLIC, 'voice', MODE, 'durations.json'));
const spans = read<Spans>(join(PUBLIC, 'voice', MODE, 'sentences.json'));
const { shots, events } = read<{ shots: Shot[]; events: SoundEvent[] }>(
  join(DOCS, `shots-${MODE}.json`),
);
const measured = read<{ base: string }>(join(DOCS, `measured-${MODE}.json`));

const result = plan({ beats, narration, durationsMs, spans });
if (result.overruns.length > 0) {
  throw new Error(
    `The voice runs into the next beat in: ${result.overruns.join(', ')}. Run pnpm demo:record again so the beats are held for the real audio.`,
  );
}

const props: DemoProps = {
  videoSrc: `${MODE}/demo.mp4`,
  soundDir: `sound/${MODE}`,
  // Where a viewer can try it: the take's own address, unless SITE names the public one (a take recorded locally).
  site: process.env['SITE'] ?? measured.base.replace(/^https?:\/\//, ''),
  durationMs: result.durationMs,
  beats,
  narration,
  spans,
  audio: result.audio.map((clip) => ({ ...clip, src: `voice/${MODE}/${clip.id}.wav` })),
  cues: result.cues,
  shots,
  events,
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
mkdirSync(join(STAGE, props.soundDir), { recursive: true });
for (const name of ['music', 'whoosh', 'click', 'tick', 'reveal', 'confirm', 'alert'])
  copyFileSync(
    join(PUBLIC, props.soundDir, `${name}.wav`),
    join(STAGE, props.soundDir, `${name}.wav`),
  );
// The product's own typefaces, from the web app's font packages.
mkdirSync(join(STAGE, 'fonts'), { recursive: true });
const fontFile = (pkg: string, file: string) =>
  join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file);
copyFileSync(
  fontFile('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'),
  join(STAGE, 'fonts', 'inter.woff2'),
);
copyFileSync(
  fontFile('@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'),
  join(STAGE, 'fonts', 'mono.woff2'),
);

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
const stills = process.env['STILLS'];
if (stills !== undefined) {
  mkdirSync(join(PUBLIC, 'stills'), { recursive: true });
  for (const second of stills.split(',').map(Number)) {
    const output = join(PUBLIC, 'stills', `${second.toFixed(1)}.png`);
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      browserExecutable,
      frame: Math.round(second * composition.fps),
      output,
    });
    process.stdout.write(`${output}\n`);
  }
  process.exit(0);
}
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
// Bring the mix to the loudness video sites expect (-16 LUFS, peaks under -1.5 dB), leaving the picture untouched.
const loud = `${OUT}.loud.mp4`;
const normalised = spawnSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-y',
    '-i',
    OUT,
    '-c:v',
    'copy',
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar',
    '48000',
    loud,
  ],
  { stdio: 'inherit' },
);
if (normalised.status === 0) renameSync(loud, OUT);
process.stdout.write(`${OUT} (${(result.durationMs / 1000).toFixed(1)} s)\n`);
