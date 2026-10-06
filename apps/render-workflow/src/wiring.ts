import { randomBytes } from 'node:crypto';
import {
  createCatalog,
  createFixtureApi,
  createLiveApi,
  RECORDED_PRODUCTS,
} from '@bursar/channel3';
import { createCore } from '@bursar/core';
import { decodeKey, parseKeyring } from '@bursar/crypto';
import { createDb } from '@bursar/db';
import { createPayPalClient } from '@bursar/paypal';
import type { Wiring } from './tasks';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set on this workflow. Set it in the Render dashboard.`);
  return value;
};

let cached: Wiring | undefined;

/**
 * What a task instance connects to: the same Postgres as the API, and the same catalog. Nothing here calls
 * PayPal (a task only proposes), but the money loop wants a client, so it is given the sandbox one.
 */
export function wiring(): Wiring {
  if (cached !== undefined) return cached;
  const { db } = createDb(need('BURSAR_DATABASE_URL'));
  const core = createCore({
    db,
    paypal: createPayPalClient({
      clientId: need('PAYPAL_CLIENT_ID'),
      clientSecret: need('PAYPAL_CLIENT_SECRET'),
      baseUrl: 'https://api-m.sandbox.paypal.com',
    }),
    vaultKeys: parseKeyring(need('VAULT_ENC_KEY')),
    approvalKey: process.env['APPROVAL_HMAC_KEY']
      ? decodeKey(process.env['APPROVAL_HMAC_KEY'])
      : randomBytes(32),
    provenanceKeys: [decodeKey(need('PROVENANCE_HMAC_KEY'))],
    webhookId: process.env['PAYPAL_WEBHOOK_ID'] ?? 'unset',
    keepVaultTokens: true,
  });
  const live = process.env['BURSAR_CATALOG'] === 'live' && process.env['CHANNEL3_API_KEY'];
  const api = live
    ? createLiveApi({ apiKey: process.env['CHANNEL3_API_KEY'] ?? '' })
    : createFixtureApi(RECORDED_PRODUCTS);
  cached = { db, core, catalog: createCatalog({ api }) };
  return cached;
}
