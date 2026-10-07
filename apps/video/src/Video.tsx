import { useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { H, keys, project, type Shot, speedAt, spotAt, viewAt, WIDE } from './camera';
import {
  Backdrop,
  Captions,
  Chapter,
  CloseScene,
  Fonts,
  Product,
  type Pulse,
  rise,
  TitleScene,
} from './motion';
import {
  type AudioClip,
  type BeatTime,
  type Cue,
  framesFor,
  musicLevel,
  type Narration,
  type Spans,
  wordMs,
} from './timeline';

export interface SoundEvent {
  readonly atMs: number;
  readonly kind: string;
  readonly x?: number;
  readonly y?: number;
  readonly n?: number;
  readonly every?: number;
}

// A type alias, not an interface: Remotion wants props that fit a string-keyed record.
export type DemoProps = {
  readonly videoSrc: string;
  readonly soundDir: string;
  readonly site: string;
  readonly durationMs: number;
  readonly beats: readonly BeatTime[];
  readonly narration: readonly Narration[];
  readonly spans: Spans;
  readonly audio: readonly (AudioClip & { readonly src: string })[];
  readonly cues: readonly Cue[];
  readonly shots: readonly Shot[];
  readonly events: readonly SoundEvent[];
};

/** The chapter names, in the order the story tells them. */
const CHAPTERS: Readonly<Record<string, string>> = {
  mandate: 'The mandate',
  plan: 'The agents plan',
  approve: 'A person approves',
  receipt: 'The receipt',
  attack: 'An attack',
  lab: 'The policy lab',
  studio: 'The cockpit',
  schedule: 'Reality changes',
  rogue: 'The kill switch',
};
/** The opening and closing beats are designed scenes; everything between is the product. */
const SCENES = ['title', 'close'];

const SFX: Readonly<Record<string, { file: string; volume: number }>> = {
  click: { file: 'click', volume: 0.3 },
  reveal: { file: 'reveal', volume: 0.42 },
  confirm: { file: 'confirm', volume: 0.26 },
  alert: { file: 'alert', volume: 0.3 },
};

export function Demo(props: DemoProps) {
  const { beats, narration, spans, shots, events, cues, audio } = props;
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const ms = (frame / fps) * 1000;

  const camera = useMemo(() => keys(shots, SCENES), [shots]);
  const beat = (id: string) => beats.find((b) => b.id === id);
  const text = (id: string) => narration.find((n) => n.id === id)?.text ?? '';
  const at = (id: string, sentence: number, word?: string) => {
    const b = beat(id);
    return b === undefined ? 0 : wordMs(b, text(id), spans, sentence, word);
  };

  const title = beat('title');
  const first = beat('mandate');
  const close = beat('close');
  const openAt = first?.atMs ?? 0;
  const closeAt = close?.atMs ?? props.durationMs;

  // The product comes forward out of depth after the title, and recedes before the close.
  const inP = rise(ms, openAt - 450, 1100);
  const outP = rise(ms, closeAt - 250, 1000);
  const enter = {
    opacity: Math.min(inP, 1 - outP),
    scale: (0.78 + 0.22 * inP) * (1 - 0.3 * outP),
    blur: 10 * (1 - inP) + 6 * outP,
  };

  const view = ms < openAt ? WIDE : viewAt(camera, ms);
  const blur = Math.min(2.2, Math.max(0, speedAt(camera, ms) - 8) / 40);
  const spot = spotAt(camera, ms);
  // A caption never covers what it is talking about: when the subject sits low, the caption moves to the top.
  const lit = spot === null ? null : project(spot.box, view);
  const captionsTop = lit !== null && lit.y + Math.min(lit.h, H) > H - 170 && lit.y > 260;
  const pulses: Pulse[] = events
    .filter((e) => e.kind === 'click' && e.x !== undefined && e.y !== undefined)
    .map((e) => ({ x: e.x ?? 0, y: e.y ?? 0, age: ms - e.atMs }))
    .filter((p) => p.age >= 0 && p.age <= 520);

  const chapter = beats.findIndex((b) => b.id in CHAPTERS && ms >= b.atMs && ms < b.endMs);
  const current = beats[chapter];
  const end = framesFor(props.durationMs, fps);
  const fadeOut = Math.min(1, Math.max(0, (durationInFrames - frame) / 30));

  return (
    <AbsoluteFill style={{ background: '#060708', opacity: Math.min(fadeOut, frame / 10) }}>
      <Fonts />
      <Backdrop view={view} />
      {enter.opacity > 0 && (
        <Product
          src={props.videoSrc}
          view={view}
          blur={blur}
          spot={spot}
          pulses={pulses}
          enter={enter}
        />
      )}
      {title && (
        <TitleScene
          ms={ms}
          line1At={at('title', 0)}
          line1End={at('title', 1)}
          dimAt={at('title', 1)}
          line2At={at('title', 2)}
          line2End={title.endMs}
          exitAt={openAt - 650}
        />
      )}
      {close && (
        <CloseScene
          ms={ms}
          enterAt={closeAt + 500}
          taglineAt={at('close', 1)}
          pillarsAt={[
            at('close', 1, 'governed'),
            at('close', 1, 'bound'),
            at('close', 1, 'verified'),
          ]}
          footerAt={at('close', 2)}
          site={props.site}
        />
      )}
      {current && (
        <Chapter
          index={beats.filter((b) => b.id in CHAPTERS).indexOf(current) + 1}
          title={CHAPTERS[current.id] ?? ''}
          age={ms - current.atMs}
        />
      )}
      <Captions cues={cues} ms={ms} top={captionsTop} />

      {audio.map((clip) => (
        <Sequence
          key={clip.id}
          from={framesFor(clip.startMs, fps)}
          durationInFrames={framesFor(clip.durationMs, fps) + 3}
        >
          <Audio src={staticFile(clip.src)} />
        </Sequence>
      ))}
      <Audio
        src={staticFile(`${props.soundDir}/music.wav`)}
        volume={(f) => musicLevel((f / fps) * 1000, audio)}
      />
      {beats
        .filter((b) => b.id in CHAPTERS || b.id === 'close')
        .map((b) => (
          <Sequence
            key={`whoosh-${b.id}`}
            from={framesFor(b.atMs - 300, fps)}
            durationInFrames={30}
          >
            <Audio src={staticFile(`${props.soundDir}/whoosh.wav`)} volume={0.2} />
          </Sequence>
        ))}
      {close && (
        <Sequence from={framesFor(closeAt + 500, fps)} durationInFrames={60}>
          <Audio src={staticFile(`${props.soundDir}/reveal.wav`)} volume={0.5} />
        </Sequence>
      )}
      {events.flatMap((e, i) => {
        if (e.kind === 'type')
          return Array.from({ length: e.n ?? 0 }, (_, k) => (
            <Sequence
              key={`type-${i}-${k}`}
              from={framesFor(e.atMs + k * (e.every ?? 55), fps)}
              durationInFrames={3}
            >
              <Audio src={staticFile(`${props.soundDir}/tick.wav`)} volume={0.14} />
            </Sequence>
          ));
        const sound = SFX[e.kind];
        if (sound === undefined || framesFor(e.atMs, fps) >= end) return [];
        return [
          <Sequence
            key={`sfx-${e.kind}-${e.atMs}`}
            from={framesFor(e.atMs, fps)}
            durationInFrames={50}
          >
            <Audio src={staticFile(`${props.soundDir}/${sound.file}.wav`)} volume={sound.volume} />
          </Sequence>,
        ];
      })}
    </AbsoluteFill>
  );
}
