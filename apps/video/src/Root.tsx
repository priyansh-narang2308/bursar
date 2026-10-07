import { Composition } from 'remotion';
import { framesFor } from './timeline';
import { Demo, type DemoProps } from './Video';

export const FPS = 30;

const empty: DemoProps = {
  videoSrc: '',
  soundDir: '',
  site: '',
  durationMs: 1000,
  beats: [],
  narration: [],
  spans: {},
  audio: [],
  cues: [],
  shots: [],
  events: [],
};

/** One composition: the directed product film, with its voice, music, effects and captions, 1920 by 1080. */
export function Root() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={framesFor(empty.durationMs, FPS)}
      defaultProps={empty}
      calculateMetadata={({ props }) => ({ durationInFrames: framesFor(props.durationMs, FPS) })}
    />
  );
}
