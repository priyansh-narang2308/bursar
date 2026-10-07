import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BEATS, fill, spoken } from './script';

/*
 * Writes the voice-over as data: for each beat, the text as captioned and the text as spoken (amounts in words).
 * It reads the numbers from the last take (`measured-<mode>.json`), so run `pnpm demo:record` once first. After
 * the voice is generated, the next take checks that its numbers still match what was said.
 *
 *   MODE=live node --import tsx recorder/narration.ts
 */
const MODE = process.env['MODE'] ?? 'live';
const DOCS = join(import.meta.dirname, '..', '..', '..', 'docs', 'submission');
const { values } = JSON.parse(readFileSync(join(DOCS, `measured-${MODE}.json`), 'utf8')) as {
  values: Record<string, string>;
};
values['contain'] = 'thirty seconds';

const narration = BEATS.map((beat) => {
  const text = fill(beat.voiceover, values);
  return { id: beat.id, text, speech: spoken(text) };
});
writeFileSync(join(DOCS, `narration-${MODE}.json`), `${JSON.stringify(narration, null, 2)}\n`);
process.stdout.write(
  `${narration.length} beats, ${narration.reduce((n, b) => n + b.text.split(/\s+/).length, 0)} words\n`,
);
