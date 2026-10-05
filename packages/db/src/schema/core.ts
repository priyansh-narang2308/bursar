import { CURRENCY_CODES } from '@bursar/money';
import {
  AVAILABILITIES,
  CART_STATUSES,
  MANDATE_STATUSES,
  MISSION_STATUSES,
  OFFER_SOURCES,
  ROLES,
} from '@bursar/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idCol, idShape, isSha256, minor, oneOf, timestamptz } from './columns';

// ---------------------------------------------------------------------------------------
// Tenants and people
// ---------------------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: idCol('organization').primaryKey(),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('organizations_id_shape', idShape(t.id, 'organization'))],
);

/** The tenant column every other table carries. Row-level security keys on it. */
export const orgId = () =>
  idCol('organization')
    .notNull()
    .references(() => organizations.id);

/** A person. Global, because one person can belong to several organisations. */
export const users = pgTable(
  'users',
  {
    id: idCol('user').primaryKey(),
    email: text().notNull().unique('users_email_unique'),
    displayName: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('users_id_shape', idShape(t.id, 'user')),
    check('users_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    orgId: orgId(),
    userId: idCol('user')
      .notNull()
      .references(() => users.id),
    role: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    check('memberships_role', oneOf(t.role, ROLES)),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: idCol('agent').primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    status: text().notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [
    check('agents_id_shape', idShape(t.id, 'agent')),
    check('agents_status', oneOf(t.status, ['ACTIVE', 'DISABLED'])),
  ],
);

/** Only the SHA-256 of a key is stored, so a leaked database does not leak working keys. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    agentId: idCol('agent')
      .notNull()
      .references(() => agents.id),
    keyHash: text().notNull().unique('api_keys_key_hash_unique'),
    scopes: text().array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    revokedAt: timestamptz(),
  },
  (t) => [check('api_keys_hash', isSha256(t.keyHash))],
);

// ---------------------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------------------

export const payers = pgTable(
  'payers',
  {
    id: idCol('payer').primaryKey(),
    orgId: orgId(),
    paypalPayerId: text().notNull(),
    displayName: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('payers_id_shape', idShape(t.id, 'payer')),
    unique('payers_paypal_unique').on(t.orgId, t.paypalPayerId),
  ],
);

export const policySets = pgTable(
  'policy_sets',
  {
    id: idCol('policySet').primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('policy_sets_id_shape', idShape(t.id, 'policySet'))],
);

/** Immutable once written: a decision names the exact version and hash it was made under. */
export const policyVersions = pgTable(
  'policy_versions',
  {
    id: idCol('policyVersion').primaryKey(),
    orgId: orgId(),
    policySetId: idCol('policySet')
      .notNull()
      .references(() => policySets.id),
    version: integer().notNull(),
    hash: text().notNull(),
    content: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('policy_versions_id_shape', idShape(t.id, 'policyVersion')),
    check('policy_versions_hash', isSha256(t.hash)),
    check('policy_versions_version', sql`${t.version} >= 1`),
    unique('policy_versions_number').on(t.policySetId, t.version),
  ],
);

/** A payer's permission to spend. The Vault token is stored sealed (`@bursar/crypto`), never plain. */
export const mandates = pgTable(
  'mandates',
  {
    id: idCol('mandate').primaryKey(),
    orgId: orgId(),
    payerId: idCol('payer')
      .notNull()
      .references(() => payers.id),
    policySetId: idCol('policySet')
      .notNull()
      .references(() => policySets.id),
    status: text().notNull().default('PENDING'),
    currency: text().notNull(),
    capMinor: minor().notNull(),
    perMissionCapMinor: minor().notNull(),
    validFrom: timestamptz().notNull(),
    validTo: timestamptz().notNull(),
    signedAt: timestamptz(),
    revokedAt: timestamptz(),
    vaultTokenSealed: text(),
    /** The PayPal Vault setup token while the payer has not approved yet. */
    setupTokenId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check('mandates_id_shape', idShape(t.id, 'mandate')),
    check('mandates_status', oneOf(t.status, MANDATE_STATUSES)),
    check('mandates_currency', oneOf(t.currency, CURRENCY_CODES)),
    check('mandates_caps', sql`${t.perMissionCapMinor} between 0 and ${t.capMinor}`),
    check('mandates_window', sql`${t.validTo} > ${t.validFrom}`),
    check('mandates_revoked', sql`(${t.status} = 'REVOKED') = (${t.revokedAt} is not null)`),
    check(
      'mandates_signed',
      sql`${t.status} not in ('ACTIVE', 'FROZEN') or ${t.signedAt} is not null`,
    ),
    check(
      'mandates_sealed',
      sql`${t.vaultTokenSealed} is null or ${t.vaultTokenSealed} like 'bursar:secret:v1:%'`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------
// Missions and shopping
// ---------------------------------------------------------------------------------------

/** `envelopeId` has no foreign key: the envelope points back at its mission, so a cycle is avoided. */
export const missions = pgTable(
  'missions',
  {
    id: idCol('mission').primaryKey(),
    orgId: orgId(),
    mandateId: idCol('mandate').references(() => mandates.id),
    envelopeId: idCol('envelope'),
    goal: text().notNull(),
    deadline: timestamptz(),
    currency: text().notNull(),
    budgetMinor: minor().notNull(),
    status: text().notNull().default('DRAFT'),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    check('missions_id_shape', idShape(t.id, 'mission')),
    check('missions_status', oneOf(t.status, MISSION_STATUSES)),
    check('missions_currency', oneOf(t.currency, CURRENCY_CODES)),
    check('missions_budget', sql`${t.budgetMinor} >= 0`),
  ],
);

/** The supplier registry: a payout's payee can only come from here, never from an LLM or a client. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: idCol('supplier').primaryKey(),
    orgId: orgId(),
    name: text().notNull(),
    payoutEmail: text().notNull(),
    status: text().notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [
    check('suppliers_id_shape', idShape(t.id, 'supplier')),
    check('suppliers_status', oneOf(t.status, ['ACTIVE', 'BLOCKED'])),
  ],
);

/** A frozen price quote. Carts and decisions use these, never a live price. */
export const offers = pgTable(
  'offers',
  {
    id: idCol('offer').primaryKey(),
    orgId: orgId(),
    supplierId: idCol('supplier')
      .notNull()
      .references(() => suppliers.id),
    title: text().notNull(),
    brand: text(),
    category: text().notNull(),
    imageUrl: text(),
    url: text().notNull(),
    currency: text().notNull(),
    priceMinor: minor().notNull(),
    availability: text().notNull(),
    source: text().notNull(),
    quoteId: text(),
    observedAt: timestamptz().notNull(),
  },
  (t) => [
    check('offers_id_shape', idShape(t.id, 'offer')),
    check('offers_currency', oneOf(t.currency, CURRENCY_CODES)),
    check('offers_price', sql`${t.priceMinor} >= 0`),
    check('offers_availability', oneOf(t.availability, AVAILABILITIES)),
    check('offers_source', oneOf(t.source, OFFER_SOURCES)),
  ],
);

export const carts = pgTable(
  'carts',
  {
    id: idCol('cart').primaryKey(),
    orgId: orgId(),
    missionId: idCol('mission')
      .notNull()
      .references(() => missions.id),
    version: integer().notNull(),
    currency: text().notNull(),
    totalMinor: minor().notNull(),
    cartHash: text().notNull(),
    status: text().notNull().default('DRAFT'),
    createdAt: createdAt(),
  },
  (t) => [
    check('carts_id_shape', idShape(t.id, 'cart')),
    check('carts_status', oneOf(t.status, CART_STATUSES)),
    check('carts_currency', oneOf(t.currency, CURRENCY_CODES)),
    check('carts_hash', isSha256(t.cartHash)),
    check('carts_version', sql`${t.version} >= 1 and ${t.totalMinor} >= 0`),
    unique('carts_version_unique').on(t.missionId, t.version),
  ],
);

/** The line total is the unit price times the quantity, and the database insists on it. */
export const cartLines = pgTable(
  'cart_lines',
  {
    id: idCol('cartLine').primaryKey(),
    orgId: orgId(),
    cartId: idCol('cart')
      .notNull()
      .references(() => carts.id),
    offerId: idCol('offer')
      .notNull()
      .references(() => offers.id),
    quantity: integer().notNull(),
    unitPriceMinor: minor().notNull(),
    lineTotalMinor: minor().notNull(),
    rationale: text(),
  },
  (t) => [
    check('cart_lines_id_shape', idShape(t.id, 'cartLine')),
    check('cart_lines_quantity', sql`${t.quantity} between 1 and 99`),
    check('cart_lines_total', sql`${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
  ],
);
