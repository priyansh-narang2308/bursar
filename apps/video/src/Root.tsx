import { Composition } from 'remotion';
import { framesFor } from './timeline';
import { Demo, type DemoProps } from './Video';

export const FPS = 30;

const empty: DemoProps = { videoSrc: '', durationMs: 1000, audio: [], cues: [] };

/** One composition: the screen recording, the voice for each beat, and captions, 1920 by 1080. */
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
