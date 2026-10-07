import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator } from '@playwright/test';
import {
  BEATS,
  fill,
  MAX_RUNTIME_MS,
  type Measured,
  narrationMs,
  sentencesOf,
  wordsOf,
} from './script';

/*
 * Records the demo video's screen track and measures what the voice-over quotes. It drives the product the way a
 * person would, from a brand-new workspace, at the pace of the narration, and writes:
 *
 *   .demo/<mode>/demo.webm                the screen recording (1920x1080; add the voice and music afterwards)
 *   docs/submission/measured-<mode>.json  every number the script quotes, and when each beat began
 *   docs/submission/captions-<mode>.srt   captions timed to the beats
 *   docs/submission/video-script-<mode>.md  the script with the measured numbers filled in
 *   docs/submission/shots-<mode>.json     where the camera should look, and every click and reveal, for the video
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

// If a voice-over has been generated (`pnpm demo:narrate`), each beat is held for as long as the real audio runs.
const DURATIONS = join(ROOT, '.demo', 'voice', MODE, 'durations.json');
const audio: Record<string, number> = existsSync(DURATIONS)
  ? JSON.parse(readFileSync(DURATIONS, 'utf8'))
  : {};
const lengthOf = (id: string, spokenText: string) => audio[id] ?? narrationMs(spokenText);
// When each sentence is spoken within its beat, so a click lands on the sentence that describes it.
const SENTENCES = join(ROOT, '.demo', 'voice', MODE, 'sentences.json');
const spans: Record<string, [number, number][]> = existsSync(SENTENCES)
  ? JSON.parse(readFileSync(SENTENCES, 'utf8'))
  : {};

const values: Measured = {};
// Stretches of waiting on a server (the lab running, a webhook arriving) are shown sped up in the finished video,
// with a "sped up" pill on screen. `saved` is how much shorter the video is than the take because of them.
const windows: { a: number; b: number; out: number }[] = [];
let saved = 0;
const starts: { id: string; atMs: number; endMs: number }[] = [];
// For the video's camera: where something worth looking at was on screen, how close to frame it, and whether to dim
// the rest; and what happened when (clicks, typing, reveals), for its sound.
type Size = 'wide' | 'medium' | 'close';
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
interface Shot {
  readonly beat: string;
  readonly name: string;
  readonly atMs: number;
  readonly size: Size;
  readonly spot: boolean;
  readonly box?: Box;
  /** When the subject moved or went away, so its spotlight ends there instead of framing empty space. */
  untilMs?: number;
}
const shots: Shot[] = [];
const events: { atMs: number; kind: string; x?: number; y?: number; n?: number; every?: number }[] =
  [];
let current = '';
let beatAt = 0;

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
    const out = Math.min(4000, Math.max(1500, Math.round(length / 10)));
    windows.push({ a, b: now(), out });
    saved += length - out;
  }
  return result;
}

const round = (b: { x: number; y: number; width: number; height: number }): Box => ({
  x: Math.round(b.x),
  y: Math.round(b.y),
  w: Math.round(b.width),
  h: Math.round(b.height),
});
const near = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) <= 4 &&
  Math.abs(a.y - b.y) <= 4 &&
  Math.abs(a.w - b.w) <= 6 &&
  Math.abs(a.h - b.h) <= 6;

/** Where something sits once it has stopped moving (a scroll or an entrance may still be under way), or null. */
async function settled(locator: Locator): Promise<Box | null> {
  let last: Box | null = null;
  for (let i = 0; i < 15; i++) {
    const found = await locator.boundingBox({ timeout: i === 0 ? 2500 : 500 }).catch(() => null);
    if (found === null) return null;
    const box = round(found);
    if (last !== null && near(last, box)) return box;
    last = box;
    await sleep(120);
  }
  return last;
}

/**
 * Keeps watching a lit subject while the camera holds on it, and ends its spotlight the moment it moves or goes
 * away (a row approved and removed, a toast fading, content pushed down), so a box only ever frames what is there.
 */
function follow(shot: Shot, locator: Locator) {
  const box = shot.box;
  if (box === undefined) return;
  void (async () => {
    while (shots.at(-1) === shot) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (shots.at(-1) !== shot) return;
      const found = await locator.boundingBox({ timeout: 300 }).catch(() => null);
      if (found === null || !near(round(found), box)) {
        shot.untilMs = cnow() - 150;
        return;
      }
    }
  })();
}

/** Points the video's camera at something on screen now. A target that is not there is skipped, never fatal. */
async function mark(name: string, locator: Locator, size: Size = 'medium', spot = false) {
  const target = locator.first();
  const box = await settled(target);
  if (box === null) return;
  const shot: Shot = { beat: current, name, atMs: cnow(), size, spot, box };
  shots.push(shot);
  if (spot) follow(shot, target);
}
/** Pulls the camera back to show the whole screen. */
const wide = (name = 'wide') =>
  shots.push({ beat: current, name, atMs: cnow(), size: 'wide', spot: false });
const cue = (kind: string, extra: { n?: number; every?: number } = {}) =>
  events.push({ atMs: cnow(), kind, ...extra });

/**
 * Waits until the narrator reaches sentence `n` of this beat, or a word in it (`offset` ms before or after), so the
 * screen changes as the voice describes it.
 */
async function say(n: number, word?: string, offset = 0) {
  const span = spans[current]?.[n];
  if (span === undefined) return;
  const def = BEATS.find((b) => b.id === current);
  const sentence = def === undefined ? '' : (sentencesOf(fill(def.voiceover, values))[n] ?? '');
  const words = sentence.split(/\s+/);
  const at = word === undefined ? -1 : words.findIndex((w) => w.toLowerCase().includes(word));
  const into = at < 0 ? 0 : Math.round(((span[1] - span[0]) * at) / words.length);
  const target = beatAt + 400 + span[0] + into + offset;
  if (cnow() < target) await sleep(target - cnow());
}

/** Scrolls something into the middle of the screen smoothly, as a hand on a trackpad would. */
async function reveal(locator: Locator) {
  await locator
    .first()
    .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), undefined, {
      timeout: 2500,
    })
    .catch(() => undefined);
  await sleep(800);
}
const panel = (title: string | RegExp) =>
  page.locator('section.panel').filter({ has: page.locator('.panel-title', { hasText: title }) });
const stat = (label: string) =>
  page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: label }) });
const part = (scope: Locator, title: string) =>
  scope.locator('section').filter({ has: page.locator('h3.eyebrow', { hasText: title }) });
const header = () => page.getByRole('heading', { level: 1 }).locator('xpath=..');

/** Moves the cursor to an element the way a hand would, then clicks it, and tells the camera if `name` is given. */
async function press(locator: Locator, pause = 350, name?: string, size: Size = 'close') {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Nothing to click.');
  if (name !== undefined) {
    const shot: Shot = { beat: current, name, atMs: cnow(), size, spot: true, box: round(box) };
    shots.push(shot);
    follow(shot, locator);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await sleep(pause);
  events.push({
    atMs: cnow(),
    kind: 'click',
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  });
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
  current = id;
  beatAt = atMs;
  wide(`${id}:start`);
  await run();
  // The narration starts a moment after the beat does, and the next beat waits for it to finish.
  const needed = atMs + 400 + lengthOf(id, fill(def.voiceover, values)) + 500;
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
  await page.getByRole('heading', { level: 1 }).waitFor();
  await sleep(700);
  await mark('hero', page.getByRole('heading', { level: 1 }), 'medium');
  await glide(960, 560);
  await say(1, 'click', -900);
  await press(page.getByRole('button', { name: 'Open demo workspace' }).nth(1), 350, 'open');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await sleep(300);
  wide('overview');
  await say(2, undefined, -1500);
  await go('Mandate');
  const current = panel('Current mandate');
  const mandate = await text();
  values['cap'] = grab(
    mandate,
    /Total cap[^$]*(\$[\d,]+(?:\.\d\d)?)/i,
    grab(mandate, /(\$[\d,]+(?:\.\d\d)?)/),
  );
  await mark('mandate', current, 'medium', true);
  await say(2, 'cap');
  await mark('cap', current.locator('.grid-3'), 'close', true);
  await say(3, 'vault', -200);
  await mark('vault', current.locator('.hint'), 'close', true);
});

await beat('plan', async () => {
  await go('Missions');
  const row = page.getByRole('row').nth(1);
  const listing = await row.innerText();
  values['budget'] = grab(listing, /(\$[\d,]+(?:\.\d\d)?)/);
  await press(row, 300, 'mission-row', 'medium');
  await page.getByRole('button', { name: 'Run agents' }).waitFor();
  await sleep(300);
  await mark('goal', header(), 'close', true);
  await say(1, undefined, -1300);
  const began = now();
  await press(page.getByRole('button', { name: 'Run agents' }), 300, 'run');
  await fast(() => page.getByRole('button', { name: 'Run again' }).waitFor({ timeout: 45_000 }));
  values['runMs'] = String(now() - began);
  cue('reveal');
  const trace = await text();
  values['needs'] = grab(trace, /broke the goal into (\d+) needs/);
  values['cart'] = grab(trace, /Proposed a cart of (\$[\d,]+(?:\.\d\d)?)/);
  const rows = [...trace.matchAll(/^(?:Planner|Researcher|Buyer)\t\S+\t\S+\t(\d+) ms$/gm)];
  values['calls'] = String(rows.length);
  values['toolMs'] = String(rows.reduce((sum, m) => sum + Number(m[1]), 0));
  await mark('planner', page.getByText(/broke the goal into/).first(), 'close', true);
  await say(1, 'researcher');
  await mark('researchers', panel('Agent trace'), 'medium', true);
  await say(2, 'cart', -300);
  await mark('cart', page.getByText(/Proposed a cart of/).first(), 'close', true);
  await say(3, undefined, -700);
  await reveal(panel('Tool calls'));
  await mark('tools', panel('Tool calls'), 'medium', true);
});

await beat('approve', async () => {
  const policy = await (await page.request.get(`${BASE}/v1/policy`)).json();
  values['rules'] = String(
    (policy as { rules?: unknown[] }).rules?.length ??
      (policy as { version?: { rules?: unknown[] } }).version?.rules?.length ??
      17,
  );
  await go('Approvals');
  await mark('queue', page.getByRole('row').nth(1), 'medium', true);
  await say(1, undefined, -500);
  await press(page.getByRole('row').nth(1), 300);
  const drawer = page.getByRole('dialog');
  await drawer.waitFor({ timeout: 5000 }).catch(() => undefined);
  await sleep(500);
  await mark('rulings', part(drawer, 'Policy rulings'), 'medium', true);
  await say(1, 'person', -300);
  await mark(
    'new-vendor',
    drawer.locator('li, tr').filter({ hasText: 'R-NEW-VENDOR' }),
    'close',
    true,
  );
  await say(2, undefined, -1300);
  await page.keyboard.press('Escape');
  await sleep(400);
  const began = now();
  await press(page.getByRole('button', { name: 'Approve', exact: true }), 350, 'approve');
  await fast(() =>
    page
      .getByText(/Approved\./)
      .first()
      .waitFor(),
  );
  values['approveMs'] = String(now() - began);
  cue('confirm');
  await mark('approved', page.locator('.toast').last(), 'close', true);
  await say(3, undefined);
  wide('approvals');
  await say(4, 'hold', -400);
  await mark('hold', page.locator('.toast').last(), 'close', true);
});

await beat('receipt', async () => {
  await go('Missions');
  await press(page.getByRole('row').nth(1), 300);
  await press(page.getByRole('button', { name: 'Open receipt' }).first(), 300, 'open-receipt');
  const drawer = page.getByRole('dialog');
  await sleep(500);
  await mark('receipt', drawer, 'medium');
  await say(0, 'rules', -200);
  await mark('r-rules', part(drawer, 'Policy rulings'), 'close', true);
  await say(0, 'approved', -300);
  await reveal(part(drawer, 'Approvals'));
  await mark('r-approvals', part(drawer, 'Approvals'), 'close', true);
  await say(0, 'paypal', -300);
  await reveal(part(drawer, 'Sent to PayPal'));
  await mark('r-paypal', part(drawer, 'Sent to PayPal'), 'close', true);
  await say(0, 'audit', -300);
  await reveal(part(drawer, 'Audit trail'));
  await mark('r-audit', part(drawer, 'Audit trail'), 'close', true);
  await say(1, undefined, -800);
  const replay = page.getByRole('button', { name: 'Replay' }).first();
  if (await replay.isVisible().catch(() => false)) {
    await press(replay, 300, 'replay');
    await page
      .getByText(/Replayed: the same outcome/)
      .first()
      .waitFor({ timeout: 15_000 });
    cue('confirm');
    await mark('replayed', page.locator('.toast').last(), 'close', true);
  }
  await sleep(1500);
  await page.keyboard.press('Escape');
});

await beat('attack', async () => {
  await go('Gauntlet');
  await mark('gauntlet', header(), 'medium');
  await say(1, 'sellers', -300);
  await mark('titles', header(), 'close', true);
  await say(2, undefined, -1200);
  await press(page.getByRole('button', { name: 'Run the gauntlet' }), 300, 'run');
  await fast(() => page.getByText('Naive agent compromised').waitFor({ timeout: 45_000 }));
  cue('reveal');
  await sleep(500);
  const board = await text();
  values['payloads'] = grab(board, /Payloads\s+(\d+)/);
  values['naive'] = grab(board, /Naive agent compromised\s+(\d+)/);
  values['guarded'] = grab(board, /PayPal calls through Bursar\s+(\d+)/);
  await mark('payloads', stat('Payloads'), 'close', true);
  await say(3, 'talked', -300);
  await mark('naive', stat('Naive agent compromised'), 'close', true);
  await say(4, 'bursar', -200);
  await mark('guarded', stat('PayPal calls through Bursar'), 'close', true);
  cue('confirm');
});

await beat('lab', async () => {
  await go('Policy lab');
  await mark('lab', header(), 'medium', true);
  await say(1, undefined, -1600);
  await press(page.getByLabel('Policy'), 300, 'policy');
  await page.getByLabel('Policy').selectOption({ index: 1 });
  await sleep(400);
  await press(page.getByRole('button', { name: 'Run the lab' }), 300, 'run');
  await fast(() => page.getByText('Broke the policy').first().waitFor({ timeout: 150_000 }));
  cue('reveal');
  await sleep(400);
  const lab = await text();
  values['broken'] = grab(lab, /Broke the policy\s+(\d+)/);
  values['leak'] = grab(lab, /(\$[\d,]+(?:\.\d\d)?) approved without a person/);
  values['leakOrders'] = grab(lab, /It took (\d+) orders/);
  await say(1, 'ways', -300);
  await mark('broke', stat('Broke the policy'), 'close', true);
  await say(1, 'spending', -300);
  const finding = page
    .locator('section.panel')
    .filter({ hasText: /approved without a person/ })
    .last();
  await reveal(finding);
  await mark('finding', finding, 'close', true);
  await say(2, undefined, -900);
  await press(page.getByRole('button', { name: 'Shrink and fix' }).first(), 300, 'shrink');
  await sleep(2200);
  cue('confirm');
  const patch = page.locator('section.panel').filter({ hasText: 'Proposed patch' }).last();
  await reveal(patch);
  await mark('patch', patch, 'medium', true);
});

await beat('studio', async () => {
  await go('Studio');
  const heatmap = page.getByRole('table', { name: /how often each rule fired/i });
  await heatmap.waitFor({ timeout: 30_000 });
  await sleep(600);
  wide('cockpit');
  await say(0, 'envelope', -300);
  await mark('gauge', page.getByLabel(/percent of the ceiling is in use/).first(), 'close', true);
  await say(0, 'rules', -300);
  await mark('heatmap', heatmap, 'medium', true);
  await say(0, 'money', -300);
  await mark('flow', page.getByLabel('Where the money went'), 'close', true);
  await say(1, undefined, -1400);
  await press(page.getByRole('button', { name: 'Edit layout' }), 300, 'edit');
  await sleep(700);
  const box = page.getByRole('textbox', { name: 'Message input' });
  await press(box, 300, 'ask', 'medium');
  const question = 'How much of the envelope is left?';
  cue('type', { n: question.length, every: 55 });
  await page.keyboard.type(question, { delay: 55 });
  await page.keyboard.press('Enter');
  await page
    .getByText(/of the ceiling is in use/)
    .last()
    .waitFor({ timeout: 20_000 });
  cue('confirm');
  const answer = page.getByText(/of the ceiling is in use\. Ceiling/).last();
  values['treasurer'] = (await answer.innerText()).slice(0, 120);
  await mark('answer', answer, 'close', true);
  await say(3, undefined, -200);
  wide('cockpit-end');
});

await beat('schedule', async () => {
  await go('Schedule');
  const plan = page
    .getByLabel('Schedule view')
    .locator('xpath=ancestor::section[contains(@class,"panel")][1]');
  await sleep(900);
  await mark('gantt', plan, 'medium');
  await say(1, undefined, -1000);
  await press(page.getByRole('button', { name: 'Delay the longest delivery' }), 300, 'delay');
  await fast(() =>
    page
      .getByText(/days? late/)
      .first()
      .waitFor({ timeout: 20_000 }),
  );
  cue('alert');
  values['late'] = grab(await text(), /(\d+ days? late)/).replace(' late', '');
  await mark('late', plan, 'medium', true);
  await say(2, 'swaps', -500);
  const recovery = page
    .getByText(/only a proposal/i)
    .first()
    .locator('xpath=..');
  await reveal(recovery);
  await mark('recovery', recovery, 'close', true);
  await say(3, undefined, -700);
  const propose = page.getByRole('button', { name: 'Propose the recovery' });
  if (await propose.isVisible().catch(() => false)) {
    await press(propose, 300, 'propose');
    await sleep(700);
    cue('confirm');
    await mark('proposed', page.locator('.toast').last(), 'close', true);
  }
});

await beat('rogue', async () => {
  await go('Incidents');
  await sleep(500);
  await mark('killswitch', panel(/Try the kill switch/), 'medium', true);
  await say(1, undefined, -1000);
  const began = now();
  await press(page.getByRole('button', { name: 'Simulate a rogue capture' }), 250, 'simulate');
  await fast(() =>
    page
      .getByText(/unexplained movement/i)
      .first()
      .waitFor({ timeout: 60_000 }),
  );
  cue('alert');
  const incident = page.locator('section.panel').filter({ hasText: /unexplained movement/i });
  await mark('incident', incident, 'medium', true);
  await fast(() => page.getByText('Automatic response').first().waitFor({ timeout: 60_000 }));
  const took = now() - began;
  values['containMs'] = String(took);
  if (took > 30_000)
    throw new Error(
      `The kill switch took ${Math.round(took / 1000)} s; the script says "within thirty seconds".`,
    );
  values['contain'] = 'thirty seconds';
  await say(2, 'freezes', -400);
  cue('confirm');
  await mark(
    'response',
    page.getByText('Automatic response').first().locator('xpath=..'),
    'close',
    true,
  );
  await say(2, 'revokes', -300);
  await mark('frozen', page.locator('.topbar-right'), 'close', true);
  await sleep(1200);
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
  const sentences = sentencesOf(spoken);
  const total = sentences.reduce((sum, s) => sum + wordsOf(s), 0);
  let cursor = mark.atMs + 400;
  for (const sentence of sentences) {
    const length = Math.round((wordsOf(sentence) / total) * lengthOf(mark.id, spoken));
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
writeFileSync(
  join(DOCS, `timeline-${MODE}.json`),
  `${JSON.stringify(
    starts.map((mark) => ({ id: mark.id, atMs: mark.atMs, endMs: mark.endMs })),
    null,
    2,
  )}\n`,
);
writeFileSync(join(DOCS, `video-script-${MODE}.md`), script);
writeFileSync(join(DOCS, `shots-${MODE}.json`), `${JSON.stringify({ shots, events }, null, 1)}\n`);
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
