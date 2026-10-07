import { type CSSProperties, useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, OffthreadVideo, staticFile } from 'remotion';
import { type Box, ease, H, type View, W } from './camera';
import type { Cue } from './timeline';

/*
 * The film's visual language, in a few pieces used everywhere: a quiet stage, the product in a floating frame that
 * the camera moves over, a spotlight that dims everything but the subject, and type that enters with intent.
 */

const INK = '#ececed';
const MUTED = '#8b8e95';
const FAINT = '#5f636b';
const SANS = 'Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Progress from `start`, over `length` ms, eased. */
export const rise = (ms: number, start: number, length = 600) => ease((ms - start) / length);

/** Loads the product's own typefaces before the first frame is drawn. */
export function Fonts() {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    const faces = [
      new FontFace('Inter', `url(${staticFile('fonts/inter.woff2')})`, { weight: '100 900' }),
      new FontFace('JetBrains Mono', `url(${staticFile('fonts/mono.woff2')})`, {
        weight: '100 800',
      }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => {
        for (const face of loaded) document.fonts.add(face);
      })
      .finally(() => continueRender(handle));
  }, [handle]);
  return null;
}

/** The stage: near-black, a faint grid that drifts against the camera for depth, and a little light from above. */
export function Backdrop({ view }: { view: View }) {
  const dx = -(view.cx - W / 2) * 0.06;
  const dy = -(view.cy - H / 2) * 0.06;
  return (
    <AbsoluteFill style={{ background: '#060708' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(1100px 620px at 22% -6%, rgba(94, 234, 212, 0.075), transparent 62%), radial-gradient(900px 560px at 88% 108%, rgba(148, 163, 184, 0.06), transparent 60%)',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          backgroundPosition: `${dx}px ${dy}px`,
          maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 85%)',
        }}
      />
    </AbsoluteFill>
  );
}

/** Dims everything in the product but one thing, and draws a fine edge around it. */
function Spotlight({ box, opacity, scale }: { box: Box; opacity: number; scale: number }) {
  const pad = 10;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        borderRadius: 12,
        boxShadow: [
          `0 0 0 4000px rgba(3, 4, 6, ${0.6 * opacity})`,
          `0 0 0 ${1.5 / scale}px rgba(255, 255, 255, ${0.34 * opacity})`,
          `0 0 ${46 / scale}px rgba(110, 231, 183, ${0.12 * opacity})`,
        ].join(', '),
      }}
    />
  );
}

export interface Pulse {
  readonly x: number;
  readonly y: number;
  readonly age: number;
}

/** A ring that opens where a click lands. */
function Ring({ x, y, age, scale }: Pulse & { scale: number }) {
  const p = age / 520;
  if (p < 0 || p > 1) return null;
  const r = 9 + 30 * ease(p);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `${2 / scale}px solid rgba(255, 255, 255, ${0.6 * (1 - p)})`,
      }}
    />
  );
}

/**
 * The product: the recording in a floating frame, moved by the camera. `enter` adds a pull from depth for the
 * transitions in and out of the designed scenes.
 */
export function Product({
  src,
  view,
  blur,
  spot,
  pulses,
  enter,
}: {
  src: string;
  view: View;
  blur: number;
  spot: { box: Box; opacity: number } | null;
  pulses: readonly Pulse[];
  enter: { opacity: number; scale: number; blur: number };
}) {
  const s = view.scale * enter.scale;
  // The enter scale works about the screen centre, so the frame grows out of depth rather than from a corner.
  const tx = W / 2 - view.cx * s;
  const ty = H / 2 + (view.ay - H / 2) * enter.scale - view.cy * s;
  const filter = blur + enter.blur > 0.3 ? `blur(${(blur + enter.blur).toFixed(2)}px)` : undefined;
  const frame: CSSProperties = { position: 'absolute', inset: 0, borderRadius: 16 };
  return (
    <AbsoluteFill style={{ opacity: enter.opacity }}>
      <div
        style={{
          position: 'absolute',
          width: W,
          height: H,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
        }}
      >
        <div
          style={{
            ...frame,
            boxShadow:
              '0 60px 160px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
          }}
        />
        <div style={{ ...frame, overflow: 'hidden', filter }}>
          <OffthreadVideo src={staticFile(src)} muted style={{ width: W, height: H }} />
          {spot && <Spotlight box={spot.box} opacity={spot.opacity} scale={s} />}
          {pulses.map((p) => (
            <Ring key={`${p.x}-${p.y}-${p.age}`} {...p} scale={s} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

const KEY = /\d|PayPal|Bursar|Vault|Treasurer|Verifier/;

/**
 * The caption for what is being said: it rises in, then each word brightens as it is spoken, and names and figures
 * carry a little more weight. It never covers the subject: the camera frames above it.
 */
export function Captions({
  cues,
  ms,
  top = false,
}: {
  cues: readonly Cue[];
  ms: number;
  top?: boolean;
}) {
  const cue = cues.filter((c) => ms >= c.startMs - 140 && ms < c.endMs + 260).at(-1);
  if (cue === undefined) return null;
  const into = clamp01((ms - (cue.startMs - 140)) / 300);
  const out = clamp01((cue.endMs + 260 - ms) / 240);
  const words = cue.text.split(' ');
  const said = (ms - cue.startMs) / Math.max(1, cue.endMs - cue.startMs);
  return (
    <AbsoluteFill
      style={{
        justifyContent: top ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        padding: top ? '40px 0 0' : '0 0 44px',
      }}
    >
      <div
        style={{
          opacity: Math.min(ease(into), out),
          transform: `translateY(${(1 - ease(into)) * (top ? -12 : 12)}px)`,
          maxWidth: 1360,
          padding: '13px 28px 14px',
          borderRadius: 16,
          background: 'rgba(9, 10, 12, 0.74)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          font: `500 32px/1.4 ${SANS}`,
          letterSpacing: '-0.012em',
          textAlign: 'center',
          color: INK,
        }}
      >
        {words.map((word, i) => {
          const lit = said >= i / words.length - 0.03;
          const key = KEY.test(word);
          return (
            <span
              key={i}
              style={{
                color: lit ? (key ? '#ffffff' : '#e4e5e8') : 'rgba(228, 229, 232, 0.4)',
                fontWeight: key ? 640 : 500,
              }}
            >
              {word}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** A small chapter mark at the top left as each part begins: a number, a rule, a name, revealed left to right. */
export function Chapter({ index, title, age }: { index: number; title: string; age: number }) {
  if (age < 0 || age > 4200) return null;
  const reveal = rise(age, 250, 700);
  const fade = clamp01((4200 - age) / 450);
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        top: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '7px 14px 7px 12px',
        borderRadius: 10,
        background: 'rgba(8, 9, 11, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        backdropFilter: 'blur(10px)',
        opacity: fade,
        clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0 round 10px)`,
      }}
    >
      <span style={{ font: `500 14px ${MONO}`, color: FAINT }}>
        {String(index).padStart(2, '0')}
      </span>
      <span style={{ width: 18 * reveal, height: 1, background: 'rgba(255,255,255,0.25)' }} />
      <span style={{ font: `600 16px ${SANS}`, color: '#d6d7da', letterSpacing: '0.01em' }}>
        {title}
      </span>
    </div>
  );
}

/** Words that rise into view from behind a mask, one after another, from `at` (ms, per word). */
function Words({
  text,
  at,
  ms,
  style,
  emphasis,
}: {
  text: string;
  at: (i: number) => number;
  ms: number;
  style: CSSProperties;
  emphasis?: (word: string, i: number) => boolean;
}) {
  return (
    <div style={style}>
      {text.split(' ').map((word, i) => {
        const p = rise(ms, at(i), 650);
        const strong = emphasis?.(word, i) ?? true;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              overflow: 'hidden',
              verticalAlign: 'top',
              paddingBottom: '0.08em',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - p) * 105}%)`,
                opacity: 0.2 + 0.8 * p,
                color: strong ? style.color : MUTED,
              }}
            >
              {word}
              {' '}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Bursar's mark, the square and the stroke, drawn on as `p` goes from 0 to 1. */
function Mark({ size, p }: { size: number; p: number }) {
  const square = 4 * 23;
  const stroke = Math.SQRT2 * 13;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="4.5"
        y="4.5"
        width="23"
        height="23"
        rx="5"
        fill="none"
        stroke={INK}
        strokeWidth="2.2"
        strokeDasharray={square}
        strokeDashoffset={square * (1 - ease(p / 0.7))}
      />
      <path
        d="M9.5 22.5 22.5 9.5"
        stroke={INK}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray={stroke}
        strokeDashoffset={stroke * (1 - ease((p - 0.55) / 0.45))}
      />
    </svg>
  );
}

/** The opening: the question, set in large type, each line arriving as it is spoken. */
export function TitleScene({
  ms,
  line1At,
  line1End,
  dimAt,
  line2At,
  line2End,
  exitAt,
}: {
  ms: number;
  line1At: number;
  line1End: number;
  dimAt: number;
  line2At: number;
  line2End: number;
  exitAt: number;
}) {
  const exit = rise(ms, exitAt, 700);
  if (exit >= 1) return null;
  const line1 = 'AI agents can pay now.';
  const line2 = 'Would you let one spend your money?';
  const per = (start: number, end: number, n: number) => (i: number) =>
    start + ((end - start) * i) / n;
  const dim = rise(ms, dimAt, 900);
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: 1 - exit,
        transform: `scale(${1 + 0.1 * exit})`,
        filter: exit > 0 ? `blur(${8 * exit}px)` : undefined,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            marginBottom: 56,
            opacity: rise(ms, 200, 900),
            font: `600 22px ${SANS}`,
            color: MUTED,
            letterSpacing: '-0.01em',
          }}
        >
          <Mark size={26} p={(ms - 200) / 1100} />
          Bursar
        </div>
        <Words
          text={line1}
          ms={ms}
          at={per(line1At, Math.min(line1End, line1At + 1400), 5)}
          style={{
            font: `600 96px/1.06 ${SANS}`,
            letterSpacing: '-0.045em',
            color: INK,
            opacity: 1 - 0.45 * dim,
            transform: `translateY(${-10 * dim}px)`,
          }}
        />
        <Words
          text={line2}
          ms={ms}
          at={per(line2At, Math.min(line2End, line2At + 1800), 7)}
          emphasis={(_, i) => i >= 5}
          style={{
            marginTop: 26,
            font: `500 52px/1.15 ${SANS}`,
            letterSpacing: '-0.03em',
            color: INK,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

/** The close: the mark draws on, the name and the claim arrive with the voice, then where to find it. */
export function CloseScene({
  ms,
  enterAt,
  taglineAt,
  pillarsAt,
  footerAt,
  site,
}: {
  ms: number;
  enterAt: number;
  taglineAt: number;
  pillarsAt: readonly [number, number, number];
  footerAt: number;
  site: string;
}) {
  if (ms < enterAt - 200) return null;
  const name = rise(ms, enterAt + 250, 800);
  const pillars: readonly [string, string][] = [
    ['Governed', 'by code'],
    ['Bound', 'by PayPal'],
    ['Verified', 'by webhooks'],
  ];
  const fadeIn = (at: number, length = 700): CSSProperties => {
    const p = rise(ms, at, length);
    return { opacity: p, transform: `translateY(${(1 - p) * 16}px)` };
  };
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Mark size={92} p={(ms - enterAt) / 1300} />
          <span style={{ overflow: 'hidden', display: 'inline-block' }}>
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - name) * 100}%)`,
                font: `650 112px/1.1 ${SANS}`,
                letterSpacing: '-0.05em',
                color: INK,
              }}
            >
              Bursar
            </span>
          </span>
        </div>
        <div
          style={{
            ...fadeIn(taglineAt),
            marginTop: 22,
            font: `500 36px ${SANS}`,
            color: '#b4b6bc',
            letterSpacing: '-0.02em',
          }}
        >
          Spend authority for AI agents
        </div>
        <div style={{ display: 'flex', gap: 28, marginTop: 64 }}>
          {pillars.map(([strong, rest], i) => {
            const p = rise(ms, pillarsAt[i] ?? taglineAt, 650);
            return (
              <div key={strong} style={{ width: 300, opacity: p }}>
                <div
                  style={{
                    height: 1,
                    width: `${100 * p}%`,
                    background: 'rgba(255, 255, 255, 0.22)',
                    marginBottom: 18,
                  }}
                />
                <div style={{ font: `500 14px ${MONO}`, color: FAINT, marginBottom: 8 }}>
                  0{i + 1}
                </div>
                <div
                  style={{
                    font: `500 28px ${SANS}`,
                    letterSpacing: '-0.02em',
                    color: MUTED,
                    transform: `translateY(${(1 - p) * 10}px)`,
                  }}
                >
                  <span style={{ color: INK, fontWeight: 600 }}>{strong}</span> {rest}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ ...fadeIn(footerAt), marginTop: 84, textAlign: 'center' }}>
          <div style={{ font: `500 20px ${MONO}`, color: MUTED }}>
            {site} &nbsp;·&nbsp; github.com/priyansh-narang2308/bursar
          </div>
          <div style={{ marginTop: 14, font: `500 19px ${SANS}`, color: FAINT }}>
            Sandbox only. Honest about what is simulated.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
