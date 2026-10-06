import { type LlmRequest, type LlmResponse, type Provider, useTool } from '@bursar/llm';
import { heuristicModel } from './eval';

/** What a goal's words can mean in the demo catalog: the label, the search words and the words that name it. */
const THINGS = [
  { label: 'desks', query: 'standing desk', words: ['desk', 'desks'] },
  { label: 'chairs', query: 'office chair', words: ['chair', 'chairs'] },
  { label: 'monitors', query: 'monitor', words: ['monitor', 'monitors', 'screen', 'screens'] },
  { label: 'lamps', query: 'lamp', words: ['lamp', 'lamps'] },
  { label: 'keyboards', query: 'keyboard', words: ['keyboard', 'keyboards'] },
  { label: 'paper', query: 'paper', words: ['paper'] },
  { label: 'pens', query: 'pens', words: ['pen', 'pens'] },
  { label: 'whiteboards', query: 'whiteboard', words: ['whiteboard', 'whiteboards'] },
  { label: 'webcams', query: 'webcam', words: ['webcam', 'webcams'] },
  { label: 'headsets', query: 'headset', words: ['headset', 'headsets'] },
] as const;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  eight: 8,
  ten: 10,
};

/** Needs a goal's words suggest, with the quantity written just before the word ("4 desks", "two chairs"). */
export function needsFromGoal(goal: string): { label: string; query: string; quantity: number }[] {
  const text = goal.toLowerCase();
  const found = THINGS.flatMap((thing) => {
    for (const word of thing.words) {
      const hit = new RegExp(
        `(?:^|[^a-z0-9])(?:(\\d+|a|an|one|two|three|four|five|six|eight|ten)\\s+(?:\\w+\\s+)?)?${word}\\b`,
      ).exec(text);
      if (hit === null) continue;
      const said = hit[1];
      const quantity =
        said === undefined ? 1 : /^\d+$/.test(said) ? Number(said) : (NUMBER_WORDS[said] ?? 1);
      return [
        { label: thing.label, query: thing.query, quantity: Math.min(99, Math.max(1, quantity)) },
      ];
    }
    return [];
  });
  return found.length > 0
    ? found
    : [{ label: 'items', query: text.split(/\s+/).slice(0, 3).join(' '), quantity: 1 }];
}

const goalOf = (request: LlmRequest): string => {
  const last = request.messages.at(-1)?.content.find((b) => b.type === 'text');
  const text = last?.type === 'text' ? last.text : '';
  return /"goal":"<untrusted[^>]*>(.*?)<\/untrusted>"/s.exec(text)?.[1] ?? text;
};

/**
 * A model for demos with no key: it reads the goal's own words to plan, and otherwise behaves like the eval's
 * scripted model (search, then pick the cheapest in stock). Everything else about the run is real.
 */
export function demoModel(): Provider {
  const rest = heuristicModel([]);
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      if (request.forceTool === 'plan')
        return useTool('plan', { needs: needsFromGoal(goalOf(request)) });
      return rest.complete(request);
    },
  };
}
