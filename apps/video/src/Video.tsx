import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { type AudioClip, type Cue, fadeRange, framesFor } from './timeline';

// A type alias, not an interface: Remotion wants props that fit a string-keyed record.
export type DemoProps = {
  readonly videoSrc: string;
  readonly durationMs: number;
  readonly audio: readonly (AudioClip & { readonly src: string })[];
  readonly cues: readonly Cue[];
};

function Caption({ text, frames }: { text: string; frames: number }) {
  const frame = useCurrentFrame();
  const range = fadeRange(frames);
  const opacity =
    range === null
      ? 1
      : interpolate(frame, range, [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return (
    <AbsoluteFill
      style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 54, opacity }}
    >
      <div
        style={{
          maxWidth: 1500,
          padding: '12px 26px',
          borderRadius: 12,
          background: 'rgba(8, 9, 10, 0.82)',
          color: '#ececed',
          font: '500 38px/1.35 Inter, system-ui, sans-serif',
          textAlign: 'center',
          letterSpacing: '-0.01em',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

export function Demo({ videoSrc, durationMs, audio, cues }: DemoProps) {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 12, durationInFrames - 24, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: '#0a0c0f', opacity: fade }}>
      <OffthreadVideo src={staticFile(videoSrc)} style={{ width: '100%', height: '100%' }} muted />
      {audio.map((clip) => (
        <Sequence
          key={clip.id}
          from={framesFor(clip.startMs, fps)}
          durationInFrames={framesFor(clip.durationMs, fps) + 3}
        >
          <Audio src={staticFile(clip.src)} />
        </Sequence>
      ))}
      {cues.map((cue) => {
        const frames = Math.max(framesFor(cue.endMs - cue.startMs, fps), 1);
        return (
          <Sequence
            key={`${cue.startMs}-${cue.text}`}
            from={framesFor(cue.startMs, fps)}
            durationInFrames={frames}
          >
            <Caption text={cue.text} frames={frames} />
          </Sequence>
        );
      })}
      <span style={{ display: 'none' }}>{durationMs}</span>
    </AbsoluteFill>
  );
}
