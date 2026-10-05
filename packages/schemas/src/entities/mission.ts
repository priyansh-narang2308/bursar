import { z } from 'zod';
import { amountSchema, textSchema, timestampSchema } from '../common';
import { missionStatusSchema } from '../enums';
import { idSchemas } from '../ids';
import { notBefore } from '../invariants';
import { rule } from '../rule';

/** The longest goal a person may state for a mission. */
export const MAX_GOAL_LENGTH = 2000;

/** A goal to achieve with a budget and a deadline, such as equipping a 10-seat office by Friday. */
export const missionSchema = z
  .strictObject({
    id: idSchemas.mission,
    orgId: idSchemas.organization,
    /** Set once the mission is funded. */
    mandateId: idSchemas.mandate.nullable(),
    envelopeId: idSchemas.envelope.nullable(),
    goal: textSchema(MAX_GOAL_LENGTH),
    deadline: timestampSchema.nullable(),
    budget: amountSchema,
    status: missionStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine(
    ({ createdAt, updatedAt }) => notBefore(updatedAt, createdAt),
    rule('A mission cannot be updated before it was created', 'updatedAt'),
  )
  .meta({
    id: 'Mission',
    description: 'A goal to achieve with a budget and a deadline.',
  });
export type Mission = z.infer<typeof missionSchema>;
