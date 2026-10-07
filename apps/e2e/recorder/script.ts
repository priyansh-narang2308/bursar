/*
 * The voice-over, beat by beat. `{{name}}` is filled with a number the recorder measured on the take, so the video
 * never claims a speed or a count it has not seen. Each beat's length on screen is at least as long as its
 * narration, at a speaking pace of 155 words a minute.
 */

export const WORDS_PER_MINUTE = 155;
export const MAX_RUNTIME_MS = 178_000; // 2:58, under the three minutes the submission allows

export interface Beat {
  readonly id: string;
  readonly title: string;
  readonly onScreen: string;
  readonly voiceover: string;
  readonly proof: string;
}

export const BEATS: readonly Beat[] = [
  {
    id: 'title',
    title: 'The question',
    onScreen: 'A title card: "AI agents can pay now. Would you let one spend your money?"',
    voiceover:
      'AI agents can finally buy things. The hard question is not whether they can pay. It is whether you would let one spend your money.',
    proof: 'None needed: it sets up the problem.',
  },
  {
    id: 'mandate',
    title: 'One click, a mandate',
    onScreen: 'The landing page, then "Open demo workspace", then the Mandate page.',
    voiceover:
      "Meet Bursar. A workspace opens in one click on PayPal's sandbox. The owner sets a mandate: a cap of {{cap}}, a limit per mission, and a window. It is tied to a PayPal Vault token, so revoking it is real.",
    proof: 'The cap and per-mission limit on screen; the mandate is a PayPal Vault token.',
  },
  {
    id: 'plan',
    title: 'The agents plan',
    onScreen:
      'A mission with a {{budget}} budget; "Run agents"; the trace scrolls through planner, researchers and buyer.',
    voiceover:
      'A mission states a goal and a budget of {{budget}}. The Planner splits it into {{needs}} needs, and a researcher per need searches real products through tools that cannot name a price. Bursar re-quotes every offer and proposes one cart, priced by the server at {{cart}}. The model never types an amount.',
    proof:
      'The tool-call table ({{calls}} calls, {{toolMs}} ms in all) and a cart total computed on the server.',
  },
  {
    id: 'approve',
    title: 'The policy rules, a person approves',
    onScreen:
      'Approvals: open the cart, read the policy trace, then Approve. A toast confirms the PayPal hold.',
    voiceover:
      'Nothing moves yet. {{rules}} pure rules rule on the cart, and one wants a person, because the supplier is new. The owner approves this exact cart. The approval is signed over its hash, so change one line and it is void. Then PayPal places the hold.',
    proof: 'The rule trace, then "Approved. PayPal: confirmed." in {{approveMs}} ms.',
  },
  {
    id: 'receipt',
    title: 'A receipt you can replay',
    onScreen: 'The mission\'s receipt: stages, PayPal ids, audit chain; then "Replay".',
    voiceover:
      'Every action ends in a receipt: the rules that ran, who approved, what was sent to PayPal, and a tamper-evident audit chain. Replay the ruling, and it reproduces, byte for byte.',
    proof: '"Replayed: the same outcome, trace and hashes."',
  },
  {
    id: 'attack',
    title: 'The attack',
    onScreen: 'The Gauntlet: {{payloads}} injection payloads, naive agent against Bursar.',
    voiceover:
      'Now an attack. Product titles are written by sellers, so they can carry instructions. {{payloads}} injection payloads, read by the same gullible agent twice. With raw payment tools it is talked into paying or ordering {{naive}} times. Through Bursar, it makes {{guarded}} PayPal calls.',
    proof: 'The scoreboard: {{naive}} compromised, {{guarded}} PayPal calls through Bursar.',
  },
  {
    id: 'lab',
    title: 'Attacking our own policy',
    onScreen:
      'The Policy Lab with the daily limit removed: {{broken}} scenarios break it; "Shrink and fix".',
    voiceover:
      'Before any agent runs, Bursar attacks its own policy. Remove the daily limit, and the lab finds {{broken}} ways through, spending about {{leak}} with no person involved. It shrinks one to the fewest orders that still works, and proposes the fix.',
    proof: 'The family table, a leak of {{leak}} in {{leakOrders}} orders, and the proposed patch.',
  },
  {
    id: 'studio',
    title: 'The whole workspace at once',
    onScreen: 'The AG Studio cockpit: gauge, heatmap, money flow; click a rule; ask the Treasurer.',
    voiceover:
      'The cockpit shows the whole workspace at once: the envelope, which rules fire, and where the money went. Ask the Treasurer in plain words and it answers from figures the server summed. It can read, and it can chart. It cannot move money.',
    proof: 'Studio widgets and the Treasurer\'s answer: "{{treasurer}}"',
  },
  {
    id: 'schedule',
    title: 'Reality changes',
    onScreen:
      'The Schedule: "Delay the longest delivery"; the plan reflows; a recovery is proposed.',
    voiceover:
      'Reality changes. A carrier says a delivery is {{late}} late. The scheduler finds the fewest swaps that still meet the deadline, and proposes them. A recovery is only ever a proposal.',
    proof: 'The reflowed plan and "It is only a proposal: policy and a person still decide."',
  },
  {
    id: 'rogue',
    title: 'The kill switch',
    onScreen: 'Incidents: "Simulate a rogue capture"; an incident opens; the mandate is frozen.',
    voiceover:
      'And if something bypasses Bursar entirely? A capture appears at PayPal with no decision behind it. The signed webhook arrives, nothing explains it, and within {{contain}} the Verifier freezes the mandate, refunds the charge, and revokes the token.',
    proof: 'An unexplained-movement incident opened {{contain}} after the click.',
  },
  {
    id: 'close',
    title: 'The close',
    onScreen: 'A closing card with the live address and the repository.',
    voiceover:
      'Bursar. Spend authority for AI agents: governed by code, bound by PayPal, verified by webhooks. Sandbox only, and honest about what is simulated.',
    proof: 'The live URL and the repository.',
  },
];

/** Sentences, split where the voice breathes. The narrator and the captions both use this, so they line up. */
export const sentencesOf = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
export const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
export const narrationMs = (text: string) =>
  Math.round((wordsOf(text) / WORDS_PER_MINUTE) * 60_000);

export type Measured = Record<string, string>;
export const fill = (template: string, values: Measured) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `[${key}]`);

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** A whole number below a million, in words. */
export function wordsFor(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 === 0 ? '' : `-${ONES[n % 10]}`}`;
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 === 0 ? '' : ` ${wordsFor(n % 100)}`}`;
  return `${wordsFor(Math.floor(n / 1000))} thousand${n % 1000 === 0 ? '' : ` ${wordsFor(n % 1000)}`}`;
}

/** The text as a person would say it: amounts in words, so a voice does not stumble on "$3,424.47". */
export function spoken(text: string): string {
  return text.replace(/\$([\d,]+)(?:\.(\d\d))?/g, (_, whole: string, cents: string | undefined) => {
    const dollars = Number(whole.replaceAll(',', ''));
    const c = cents === undefined ? 0 : Number(cents);
    const d = `${wordsFor(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`;
    return c === 0 ? d : `${d} and ${wordsFor(c)} ${c === 1 ? 'cent' : 'cents'}`;
  });
}
