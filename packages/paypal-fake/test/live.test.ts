import { createPayPalClient } from '@bursar/paypal';
import { describe, expect, it } from 'vitest';

const env = process.env;
const live =
  env['PAYPAL_LIVE_TESTS'] === '1' && env['PAYPAL_CLIENT_ID'] && env['PAYPAL_CLIENT_SECRET'];

/**
 * The live sandbox smoke test: real credentials, no money moved. It is skipped, and says so, unless
 * `PAYPAL_LIVE_TESTS=1` and the sandbox keys are in the environment. It has not been run yet.
 */
describe.skipIf(!live)('PayPal sandbox smoke (needs PAYPAL_LIVE_TESTS=1 and sandbox keys)', () => {
  it('authenticates and starts a vault setup, which needs the payer to approve before anything is charged', async () => {
    const client = createPayPalClient({
      clientId: env['PAYPAL_CLIENT_ID'] ?? '',
      clientSecret: env['PAYPAL_CLIENT_SECRET'] ?? '',
      baseUrl: 'https://api-m.sandbox.paypal.com',
    });
    const setup = await client.vault.createSetupToken({
      requestId: crypto.randomUUID(),
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });
    expect(setup.id).toBeTruthy();
    expect(setup.approveUrl).toContain('paypal.com');
  });
});
