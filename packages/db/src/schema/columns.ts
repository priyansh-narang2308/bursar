import { ID_PREFIXES, type Id, type IdKind } from '@bursar/schemas';
import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, bigint, text, timestamp } from 'drizzle-orm/pg-core';

/** A text id of one kind. The kind types the column; `idShape` makes the database check it too. */
export const idCol = <K extends IdKind>(_kind: K) => text().$type<Id<K>>();

/** The prefix and ULID shape of an id, checked by the database as `@bursar/schemas` checks it. */
export function idShape(column: AnyPgColumn, kind: IdKind): SQL {
  return sql`${column} ~ ${sql.raw(`'^${ID_PREFIXES[kind]}_[0-7][0-9A-HJKMNP-TV-Z]{25}$'`)}`;
}

/** A SQL list of literals: `'A', 'B'`. The values are constants from `@bursar/schemas`. */
export const list = (values: readonly string[]): SQL =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** `column in ('A', 'B')`. An enum is a CHECK, so adding a value is a migration, not a type change. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${list(values)})`;
}

/** A SHA-256 as 64 lower-case hex characters. */
export function isSha256(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[0-9a-f]{64}$'`;
}

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });
export const createdAt = () => timestamptz().notNull().defaultNow();

/** Whole minor units. A Postgres bigint holds exactly what `@bursar/money` allows, ±(2^63 - 1). */
export const minor = () => bigint({ mode: 'bigint' });
