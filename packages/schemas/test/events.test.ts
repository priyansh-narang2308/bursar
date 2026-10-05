import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTION_STATES,
  ACTION_TRANSITIONS,
  canTransition,
  type EventId,
  parseLastEventId,
  SSE_EVENT_TYPES,
  type SseEvent,
  sseEventSchema,
  sseFrame,
} from '../src';
import { envelope, id, sseExamples } from './fixtures';
import { problemsOf } from './support';

const example = (type: string, data: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...sseExamples[type],
  data: { ...(sseExamples[type]?.['data'] as Record<string, unknown>), ...data },
});

describe('the live event stream', () => {
  it('has one example for each kind of event, and the union matches the list of kinds', () => {
    expect(Object.keys(sseExamples).sort()).toEqual([...SSE_EVENT_TYPES].sort());
    expect(sseEventSchema.options.map((option) => option.shape.type.value).sort()).toEqual(
      [...SSE_EVENT_TYPES].sort(),
    );
  });

  it.each(SSE_EVENT_TYPES)('accepts a %s event', (type) => {
    expect(problemsOf(sseEventSchema, sseExamples[type])).toEqual([]);
  });

  it.each(SSE_EVENT_TYPES)(
    'refuses an unknown key on a %s event, on the envelope or in its data',
    (type) => {
      expect(problemsOf(sseEventSchema, { ...sseExamples[type], surprise: 1 })).toEqual([
        ': Unrecognized key: "surprise"',
      ]);
      expect(problemsOf(sseEventSchema, example(type, { surprise: 1 }))).toEqual([
        'data: Unrecognized key: "surprise"',
      ]);
    },
  );

  it.each(['id', 'orgId', 'occurredAt', 'type', 'data'])('requires %s', (key) => {
    const { [key]: _removed, ...rest } = sseExamples['mission.updated'] as Record<string, unknown>;

    expect(problemsOf(sseEventSchema, rest).length).toBeGreaterThan(0);
  });

  it('refuses an event that is not one of the kinds, or has the wrong kind of id', () => {
    expect(
      problemsOf(sseEventSchema, { ...sseExamples['mission.updated'], type: 'mission.exploded' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      problemsOf(sseEventSchema, { ...sseExamples['mission.updated'], id: id('action') }),
    ).toEqual([expect.stringContaining('id: Expected an event id')]);
    expect(
      problemsOf(sseEventSchema, { ...sseExamples['mission.updated'], orgId: id('mission') }),
    ).toEqual([expect.stringContaining('orgId: Expected an organization id')]);
  });
});

describe('what an event may claim', () => {
  it('only reports a move an action can actually make', () => {
    expect(
      problemsOf(
        sseEventSchema,
        example('action.state_changed', { from: 'PROPOSED', to: 'CONFIRMED' }),
      ),
    ).toEqual(['data.to: An action cannot make that move']);
    expect(
      problemsOf(
        sseEventSchema,
        example('action.state_changed', { from: 'CONFIRMED', to: 'CONFIRMED' }),
      ),
    ).toEqual(['data.to: An action cannot make that move']);
  });

  it('accepts every move in the state machine, and refuses every other', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTION_STATES),
        fc.constantFrom(...ACTION_STATES),
        (from, to) => {
          const problems = problemsOf(
            sseEventSchema,
            example('action.state_changed', { from, to }),
          );

          expect(problems.length === 0).toBe(canTransition(from, to));
          expect(ACTION_TRANSITIONS[from].includes(to)).toBe(canTransition(from, to));
        },
      ),
    );
  });

  it('only reports a mandate status change that changes the status', () => {
    expect(
      problemsOf(
        sseEventSchema,
        example('mandate.status_changed', { from: 'ACTIVE', to: 'ACTIVE' }),
      ),
    ).toEqual(['data.to: A status change changes the status']);
  });

  it('reports an approval as approved, rejected or expired, never as pending', () => {
    for (const status of ['APPROVED', 'REJECTED', 'EXPIRED']) {
      expect(problemsOf(sseEventSchema, example('approval.decided', { status }))).toEqual([]);
    }
    expect(problemsOf(sseEventSchema, example('approval.decided', { status: 'PENDING' }))).toEqual([
      expect.stringContaining('data.status:'),
    ]);
  });

  it('carries a whole envelope, which must itself be valid', () => {
    expect(
      problemsOf(
        sseEventSchema,
        example('envelope.updated', {
          envelope: envelope({ ceiling: { currency: 'USD', minor: '1' } }),
        }),
      ),
    ).toEqual(['data.envelope.held: Captured plus held cannot exceed the ceiling']);
  });

  it('bounds the latency a verified PayPal event reports', () => {
    expect(
      problemsOf(sseEventSchema, example('paypal.event.verified', { latencyMs: null })),
    ).toEqual([]);
    expect(problemsOf(sseEventSchema, example('paypal.event.verified', { latencyMs: -1 }))).toEqual(
      [expect.stringContaining('data.latencyMs:')],
    );
  });
});

describe('sseFrame', () => {
  const event = (type: string): SseEvent => sseEventSchema.parse(sseExamples[type]);

  it('writes id, event and one data line, ended by a blank line', () => {
    const parsed = event('mission.updated');
    const frame = sseFrame(parsed);

    expect(frame).toBe(
      `id: ${parsed.id}\nevent: mission.updated\ndata: ${JSON.stringify(parsed)}\n\n`,
    );
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('puts the whole event on a single data line, and gives back the same event', () => {
    for (const type of SSE_EVENT_TYPES) {
      const frame = sseFrame(event(type));
      const lines = frame.split('\n');
      const dataLines = lines.filter((line) => line.startsWith('data: '));

      expect(lines).toHaveLength(5); // id, event, data, and the blank line that ends the frame
      expect(dataLines).toHaveLength(1);
      expect(sseEventSchema.parse(JSON.parse(dataLines[0]?.slice('data: '.length) ?? ''))).toEqual(
        event(type),
      );
    }
  });

  it('keeps a line break inside a value from ending the frame early', () => {
    const tricky = sseEventSchema.parse(
      example('paypal.event.verified', { eventType: 'PAYMENT.CAPTURE.COMPLETED' }),
    );
    const injected = { ...tricky, data: { ...tricky.data, eventType: 'A.B\n\nid: forged' } };
    const frame = sseFrame(injected as unknown as SseEvent);

    expect(frame.split('\n\n')).toHaveLength(2); // the one blank line at the end, and nothing earlier
    expect(frame.match(/\nid: /g)).toBeNull();
  });
});

describe('parseLastEventId', () => {
  it('gives back a valid event id', () => {
    const header: string = id('event');

    expect(parseLastEventId(header)).toBe(header as EventId);
  });

  it.each([
    undefined,
    null,
    '',
    ' ',
    'junk',
    id('action'),
    `${id('event')} `,
    id('event').toLowerCase(),
  ])('gives nothing for %j, so a client simply starts from now', (header) => {
    expect(parseLastEventId(header)).toBeUndefined();
  });
});
