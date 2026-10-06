import { join } from 'node:path';
import { chromium } from '@playwright/test';

/*
 * The video's thumbnail, 1280x720: the product's promise and two facts the demo measures. Run from apps/e2e:
 *   node --import tsx recorder/thumbnail.ts
 */
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'submission', 'thumbnail.png');

const html = `<body style="margin:0;width:1280px;height:720px;background:#0a0c0f;color:#ececed;font-family:Inter,system-ui,sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;top:-180px;left:-160px;width:760px;height:600px;border-radius:50%;background:#2dd4bf;opacity:.22;filter:blur(90px)"></div>
<div style="position:absolute;top:60px;right:-160px;width:700px;height:560px;border-radius:50%;background:#22d3ee;opacity:.18;filter:blur(90px)"></div>
<div style="position:absolute;bottom:-220px;left:240px;width:760px;height:560px;border-radius:50%;background:#34d399;opacity:.16;filter:blur(90px)"></div>
<div style="position:relative;padding:76px 84px">
  <div style="display:flex;align-items:center;gap:16px;font-size:34px;font-weight:600;letter-spacing:-0.02em">
    <svg width="40" height="40" viewBox="0 0 32 32"><rect x="4.5" y="4.5" width="23" height="23" rx="5" fill="none" stroke="#ececed" stroke-width="2.2"/><path d="M9.5 22.5 22.5 9.5" stroke="#ececed" stroke-width="2.6" stroke-linecap="round"/></svg>
    Bursar
  </div>
  <div style="margin-top:70px;font-size:112px;font-weight:600;letter-spacing:-0.055em;line-height:1.02">Let agents spend.<br/>Keep the control.</div>
  <div style="margin-top:56px;display:flex;gap:18px;font-size:30px">
    <span style="padding:12px 24px;border:1px solid #2d2f33;border-radius:999px;background:#0e0f10">27 attacks, 0 PayPal calls</span>
    <span style="padding:12px 24px;border:1px solid #2d2f33;border-radius:999px;background:#0e0f10">Rogue capture frozen in seconds</span>
  </div>
  <div style="position:absolute;right:84px;bottom:64px;font-size:26px;color:#9b9da3">PayPal AI Hackathon</div>
</div></body>`;

const browser = await chromium.launch(process.env['CI'] ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(html);
await page.screenshot({ path: OUT });
await browser.close();
process.stdout.write(`${OUT}\n`);
