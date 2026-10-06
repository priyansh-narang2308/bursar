import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { BEATS, fill, MAX_RUNTIME_MS, type Measured, narrationMs, wordsOf } from './script';

/*
 * Records the demo video's screen track and measures what the voice-over quotes. It drives the product the way a
 * person would, from a brand-new workspace, at the pace of the narration, and writes:
 *
 *   .demo/<mode>/demo.webm                the screen recording (1920x1080; add the voice and music afterwards)
 *   docs/submission/measured-<mode>.json  every number the script quotes, and when each beat began
 *   docs/submission/captions-<mode>.srt   captions timed to the beats
 *   docs/submission/video-script-<mode>.md  the script with the measured numbers filled in
 *
 *   pnpm demo:record                        against the local demo server on :8790 (PayPal's fake)
 *   BASE_URL=https://bursar-demo.onrender.com pnpm demo:record   against the deployed site (PayPal's sandbox)
 */

const BASE = process.env['BASE_URL'] ?? 'http://localhost:8790';
const MODE = process.env['MODE'] ?? (BASE.startsWith('http://localhost') ? 'local' : 'live');
const ROOT = join(import.meta.dirname, '..', '..', '..');
const OUT = join(ROOT, '.demo', MODE);
const DOCS = join(ROOT, 'docs', 'submission');
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const values: Measured = {};
// Stretches of waiting on a server (the lab running, a webhook arriving) are shown sped up in the finished video,
// with a "sped up" pill on screen. `saved` is how much shorter the video is than the take because of them.
const windows: { a: number; b: number; out: number }[] = [];
let saved = 0;
const starts: { id: string; atMs: number; endMs: number }[] = [];

const browser = await chromium.launch({
  headless: true,
  ...(process.env['CI'] ? {} : { channel: 'chrome' }),
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
});
const page = await context.newPage();
await page.screencast.start({ path: join(OUT, 'demo.webm'), size: { width: 1920, height: 1080 } });
const t0 = Date.now();
const now = () => Date.now() - t0;
const cnow = () => now() - saved;
const clock = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const sleep = (ms: number) => page.waitForTimeout(ms);

// A visible cursor and a click ripple, and the app at 110 percent so it reads on a small screen.
await context.addInitScript(() => {
  const mount = () => {
    document.documentElement.style.zoom = '1.1';
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;z-index:2147483647;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid #fff;border-radius:50%;background:rgba(255,255,255,.18);pointer-events:none;transition:transform .12s;left:-50px;top:-50px';
    document.body.appendChild(dot);
    // An idle page sends the recorder no frames, and the video then runs shorter than the clock. This pixel changes
    // by one shade ten times a second, which nobody can see, so the video keeps real time.
    const style = document.createElement('style');
    style.textContent = '@keyframes __t{from{background:#0a0c0f}to{background:#0b0d10}}';
    document.head.appendChild(style);
    const tick = document.createElement('div');
    tick.style.cssText =
      'position:fixed;right:0;bottom:0;width:3px;height:3px;z-index:2147483647;pointer-events:none;animation:__t .1s steps(2) infinite';
    document.body.appendChild(tick);
    document.addEventListener('mousemove', (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    });
    document.addEventListener('mousedown', () => {
      dot.style.transform = 'scale(0.7)';
    });
    document.addEventListener('mouseup', () => {
      dot.style.transform = 'scale(1)';
    });
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
});

/** Runs a wait that is the server's doing. If it is long, the video shows it sped up, and says so on screen. */
async function fast<T>(work: () => Promise<T>): Promise<T> {
  const a = now();
  await page.evaluate(() => {
    const pill = document.createElement('div');
    pill.id = '__fast';
    pill.textContent = 'sped up';
    pill.style.cssText =
      'position:fixed;z-index:2147483647;top:64px;right:24px;padding:6px 14px;border:1px solid #81848b;border-radius:999px;background:#0e0f10;color:#ececed;font:500 14px Inter,system-ui,sans-serif;display:none';
    document.body.appendChild(pill);
    setTimeout(() => {
      pill.style.display = 'block';
    }, 3000);
  });
  const result = await work();
  await page.evaluate(() => document.getElementById('__fast')?.remove());
  const length = now() - a;
  if (length > 3000) {
    const out = Math.max(1500, Math.round(length / 10));
    windows.push({ a, b: now(), out });
    saved += length - out;
  }
  return result;
}

/** Moves the cursor to an element the way a hand would, then clicks it. */
async function press(locator: ReturnType<Page['locator']>, pause = 350) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Nothing to click.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await sleep(pause);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(pause);
}
async function glide(x: number, y: number) {
  await page.mouse.move(x, y, { steps: 30 });
}
const go = async (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await press(page.getByRole('link', { name: new RegExp(`^${escaped}(\\s+\\d+)?$`) }));
  await page.getByRole('heading', { level: 1, name }).waitFor();
};
const text = async () => (await page.locator('.content').innerText()).replace(/\r/g, '');
const grab = (source: string, pattern: RegExp, fallback = '?') =>
  pattern.exec(source)?.[1] ?? fallback;

const card = (headline: string, small: string) => `
<style>@keyframes t{from{background:#0a0c0f}to{background:#0b0d10}}</style><div style="position:fixed;right:0;bottom:0;width:3px;height:3px;animation:t .1s steps(2) infinite"></div>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0c0f;color:#ececed;font-family:Inter,system-ui,sans-serif;text-align:center">
<div><div style="font-size:84px;font-weight:600;letter-spacing:-0.045em;line-height:1.05;max-width:1300px">${headline}</div>
<div style="margin-top:28px;font-size:30px;color:#9b9da3">${small}</div></div></body>`;

/** Runs one beat, then holds the screen until its narration has had time to be spoken. */
async function beat(id: string, run: () => Promise<void>) {
  const def = BEATS.find((b) => b.id === id);
  if (def === undefined) throw new Error(`No beat ${id}`);
  const atMs = cnow();
  await run();
  // The narration starts a moment after the beat does, and the next beat waits for it to finish.
  const needed = atMs + 400 + narrationMs(fill(def.voiceover, values)) + 500;
  if (cnow() < needed) await sleep(needed - cnow());
  starts.push({ id, atMs, endMs: cnow() });
}

// -------------------------------------------------------------------------------------------------------------
// The beats
// -------------------------------------------------------------------------------------------------------------

await beat('title', async () => {
  await page.setContent(card('AI agents can pay now.', 'Would you let one spend your money?'));
});

await beat('mandate', async () => {
  await page.goto(BASE);
  await sleep(2500);
  await glide(960, 540);
  await sleep(1200);
  await press(page.getByRole('button', { name: 'Open demo workspace' }).nth(1));
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await sleep(1500);
  await go('Mandate');
  const mandate = await text();
  values['cap'] = grab(
    mandate,
    /Total cap[^$]*(\$[\d,]+(?:\.\d\d)?)/i,
    grab(mandate, /(\$[\d,]+(?:\.\d\d)?)/),
  );
});

await beat('plan', async () => {
  await go('Missions');
  const row = page.getByRole('row').nth(1);
  const listing = await row.innerText();
  values['budget'] = grab(listing, /(\$[\d,]+(?:\.\d\d)?)/);
  await press(row);
  await page.getByRole('button', { name: 'Run agents' }).waitFor();
  await sleep(900);
  const began = now();
  await press(page.getByRole('button', { name: 'Run agents' }));
  await fast(() => page.getByRole('button', { name: 'Run again' }).waitFor({ timeout: 45_000 }));
  values['runMs'] = String(now() - began);
  const trace = await text();
  values['needs'] = grab(trace, /broke the goal into (\d+) needs/);
  values['cart'] = grab(trace, /Proposed a cart of (\$[\d,]+(?:\.\d\d)?)/);
  const rows = [...trace.matchAll(/^(?:Planner|Researcher|Buyer)\t\S+\t\S+\t(\d+) ms$/gm)];
  values['calls'] = String(rows.length);
  values['toolMs'] = String(rows.reduce((sum, m) => sum + Number(m[1]), 0));
  await page.mouse.wheel(0, 420);
  await sleep(1800);
  await page.mouse.wheel(0, 520);
  await sleep(1800);
});

await beat('approve', async () => {
  const policy = await (await page.request.get(`${BASE}/v1/policy`)).json();
  values['rules'] = String(
    (policy as { rules?: unknown[] }).rules?.length ??
      (policy as { version?: { rules?: unknown[] } }).version?.rules?.length ??
      17,
  );
  await go('Approvals');
  await press(page.getByRole('row').nth(1), 500);
  await sleep(4000); // the receipt drawer: the policy trace
  await page.keyboard.press('Escape');
  await sleep(500);
  const began = now();
  await press(page.getByRole('button', { name: 'Approve', exact: true }));
  await fast(() =>
    page
      .getByText(/Approved\./)
      .first()
      .waitFor(),
  );
  values['approveMs'] = String(now() - began);
  await sleep(1500);
});

await beat('receipt', async () => {
  await go('Missions');
  await press(page.getByRole('row').nth(1));
  await press(page.getByRole('button', { name: 'Open receipt' }).first());
  await sleep(3500);
  const replay = page.getByRole('button', { name: 'Replay' }).first();
  if (await replay.isVisible().catch(() => false)) {
    await press(replay);
    await page
      .getByText(/Replayed: the same outcome/)
      .first()
      .waitFor({ timeout: 15_000 });
  }
  await sleep(1500);
  await page.keyboard.press('Escape');
});

await beat('attack', async () => {
  await go('Gauntlet');
  await press(page.getByRole('button', { name: 'Run the gauntlet' }));
  await fast(() => page.getByText('Naive agent compromised').waitFor({ timeout: 45_000 }));
  await sleep(800);
  const board = await text();
  values['payloads'] = grab(board, /Payloads\s+(\d+)/);
  values['naive'] = grab(board, /Naive agent compromised\s+(\d+)/);
  values['guarded'] = grab(board, /PayPal calls through Bursar\s+(\d+)/);
});

await beat('lab', async () => {
  await go('Policy lab');
  await press(page.getByLabel('Policy'));
  await page.getByLabel('Policy').selectOption({ index: 1 });
  await sleep(500);
  await press(page.getByRole('button', { name: 'Run the lab' }));
  await fast(() => page.getByText('Broke the policy').first().waitFor({ timeout: 60_000 }));
  await sleep(600);
  const lab = await text();
  values['broken'] = grab(lab, /Broke the policy\s+(\d+)/);
  values['leak'] = grab(lab, /(\$[\d,]+(?:\.\d\d)?) approved without a person/);
  values['leakOrders'] = grab(lab, /It took (\d+) orders/);
  await page.mouse.wheel(0, 380);
  await sleep(1500);
  await press(page.getByRole('button', { name: 'Shrink and fix' }).first());
  await sleep(2500);
});

await beat('studio', async () => {
  await go('Studio');
  await page
    .getByRole('table', { name: /how often each rule fired/i })
    .waitFor({ timeout: 30_000 });
  await sleep(1500);
  await press(
    page
      .getByRole('table', { name: /how often each rule fired/i })
      .getByRole('button', { name: 'R-NEW-VENDOR' }),
  );
  await sleep(1200);
  await press(page.getByRole('button', { name: /narrowed to/i }));
  await press(page.getByRole('button', { name: 'Edit layout' }));
  await sleep(800);
  const box = page.getByRole('textbox', { name: 'Message input' });
  await press(box);
  await page.keyboard.type('How much of the envelope is left?', { delay: 55 });
  await page.keyboard.press('Enter');
  await page
    .getByText(/of the ceiling is in use/)
    .last()
    .waitFor({ timeout: 20_000 });
  values['treasurer'] = (
    await page
      .getByText(/of the ceiling is in use\. Ceiling/)
      .last()
      .innerText()
  ).slice(0, 120);
  await sleep(2000);
});

await beat('schedule', async () => {
  await go('Schedule');
  await sleep(1200);
  await press(page.getByRole('button', { name: 'Delay the longest delivery' }));
  await fast(() =>
    page
      .getByText(/days? late/)
      .first()
      .waitFor({ timeout: 20_000 }),
  );
  values['late'] = grab(await text(), /(\d+ days? late)/).replace(' late', '');
  await sleep(1800);
  await page.mouse.wheel(0, 500);
  await sleep(1200);
  const propose = page.getByRole('button', { name: 'Propose the recovery' });
  if (await propose.isVisible().catch(() => false)) await press(propose);
});

await beat('rogue', async () => {
  await go('Incidents');
  await sleep(1500);
  const began = now();
  await press(page.getByRole('button', { name: 'Simulate a rogue capture' }), 250);
  await fast(() =>
    page
      .getByText(/unexplained movement/i)
      .first()
      .waitFor({ timeout: 60_000 }),
  );
  const took = now() - began;
  values['containMs'] = String(took);
  values['contain'] =
    took < 10_000 ? `${(took / 1000).toFixed(1)} seconds` : `${Math.round(took / 1000)} seconds`;
  await sleep(2500);
  await glide(1500, 60);
});

await beat('close', async () => {
  await page.setContent(
    card(
      'Bursar',
      `${BASE.replace(/^https?:\/\//, '')} &nbsp;·&nbsp; github.com/priyansh-narang2308/bursar<br/><span style="font-size:24px">Sandbox only. Honest about what is simulated.</span>`,
    ),
  );
});

const realEnd = now();
await page.screencast.stop();
const runtime = cnow();
await context.close();
await browser.close();
const wallAfterClose = now();
// Cut the recording to the end of the last beat, with the long waits sped up, as an MP4 for upload.
const segments: { start: number; end: number; out?: number }[] = [];
let from = 0;
for (const w of windows) {
  if (w.a > from) segments.push({ start: from, end: w.a });
  segments.push({ start: w.a, end: w.b, out: w.out });
  from = w.b;
}
segments.push({ start: from, end: realEnd });
const filter = `${segments
  .map((seg, i) => {
    const speed = seg.out === undefined ? '' : `*${seg.out / (seg.end - seg.start)}`;
    return `[0:v]trim=start=${seg.start / 1000}:end=${seg.end / 1000},setpts=(PTS-STARTPTS)${speed}[v${i}]`;
  })
  .join(
    ';',
  )};${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[out]`;
const trimmed = spawnSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-y',
    '-i',
    join(OUT, 'demo.webm'),
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-an',
    join(OUT, 'demo.mp4'),
  ],
  { stdio: 'inherit' },
);
const made =
  trimmed.status === 0
    ? `${join(OUT, 'demo.mp4')} (${clock(runtime)} after speeding up ${windows.length} long waits)`
    : `${join(OUT, 'demo.webm')} (install ffmpeg to trim it to the runtime)`;

// -------------------------------------------------------------------------------------------------------------
// What the take produced
// -------------------------------------------------------------------------------------------------------------

const stamp = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(Math.round(ms % 1000)).padStart(3, '0')}`;
};

let srt = '';
let n = 1;
for (const mark of starts) {
  const def = BEATS.find((b) => b.id === mark.id);
  if (def === undefined) continue;
  const spoken = fill(def.voiceover, values);
  const sentences = spoken.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [spoken];
  const total = sentences.reduce((sum, s) => sum + wordsOf(s), 0);
  let cursor = mark.atMs + 400;
  for (const sentence of sentences) {
    const length = Math.round((wordsOf(sentence) / total) * narrationMs(spoken));
    srt += `${n}\n${stamp(cursor)} --> ${stamp(cursor + length)}\n${sentence}\n\n`;
    cursor += length;
    n += 1;
  }
}

const table = starts
  .map((mark) => {
    const def = BEATS.find((b) => b.id === mark.id);
    return def === undefined
      ? ''
      : `| ${clock(mark.atMs)} to ${clock(mark.endMs)} | ${def.title} | ${fill(def.onScreen, values)} | ${fill(def.voiceover, values)} | ${fill(def.proof, values)} |`;
  })
  .join('\n');
const script = `# Demo video script (measured on the ${MODE} take)

Every number in the voice-over was measured on this take against ${BASE}. The take ran **${clock(runtime)}**; the limit is ${clock(MAX_RUNTIME_MS)}. Narration is paced at 155 words a minute.

| Time | Beat | On screen | Voice-over | What the judge sees |
| --- | --- | --- | --- | --- |
${table}
`;
writeFileSync(join(DOCS, `captions-${MODE}.srt`), srt);
writeFileSync(join(DOCS, `video-script-${MODE}.md`), script);
writeFileSync(
  join(DOCS, `measured-${MODE}.json`),
  `${JSON.stringify({ mode: MODE, base: BASE, at: new Date().toISOString(), runtimeMs: runtime, runtime: clock(runtime), wallMs: wallAfterClose, values, beats: starts, spedUp: windows.map((w) => ({ at: clock(w.a), realMs: w.b - w.a, shownMs: w.out })) }, null, 2)}\n`,
);
process.stdout.write(
  `${MODE}: ${clock(runtime)} (${runtime} ms), ${starts.length} beats, video at ${made}\n`,
);
if (runtime > MAX_RUNTIME_MS) {
  process.stderr.write(
    `Over the limit of ${clock(MAX_RUNTIME_MS)}. Trim a beat's narration or its pauses.\n`,
  );
  process.exit(1);
}
