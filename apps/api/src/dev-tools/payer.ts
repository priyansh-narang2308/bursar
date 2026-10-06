import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSecret, parseKeyring } from '@bursar/crypto';
import { createPayPalClient } from '@bursar/paypal';

/*
 * Adds one sandbox buyer to the demo's payer pool. A buyer has to approve saving their PayPal on PayPal's own
 * page, and that cannot be done by a program, so you do it once here:
 *
 *   1. This prints an address. Open it and sign in with a SANDBOX buyer account (from PayPal's developer
 *      dashboard, under Sandbox accounts). Never use a real account.
 *   2. Approve. PayPal sends the browser back to this script, which turns the approval into a payment token.
 *   3. The token is sealed with VAULT_ENC_KEY into `.bursar/payers.json` (git-ignored). Run it again for more buyers.
 */

const PORT = 8123;
const POOL = fileURLToPath(new URL('../../../../.bursar/payers.json', import.meta.url));
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. It belongs in .env.`);
  return value;
};

const paypal = createPayPalClient({
  clientId: need('PAYPAL_CLIENT_ID'),
  clientSecret: need('PAYPAL_CLIENT_SECRET'),
  baseUrl: 'https://api-m.sandbox.paypal.com',
});
const vaultKeys = parseKeyring(need('VAULT_ENC_KEY'));

const setup = await paypal.vault.createSetupToken({
  requestId: randomUUID(),
  returnUrl: `http://localhost:${PORT}/return`,
  cancelUrl: `http://localhost:${PORT}/cancel`,
});
if (!setup.approveUrl) throw new Error('PayPal did not return an approval address.');
process.stdout.write(
  `\nOpen this address, sign in with a SANDBOX buyer, and approve:\n\n  ${setup.approveUrl}\n\nWaiting on http://localhost:${PORT} ...\n`,
);

const done = new Promise<void>((resolve, reject) => {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    if (path !== '/return') {
      response.end(path === '/cancel' ? 'Cancelled. You can close this tab.' : 'Not here.');
      if (path === '/cancel') reject(new Error('The buyer cancelled.'));
      return;
    }
    paypal.vault
      .createPaymentToken({ requestId: randomUUID(), setupTokenId: setup.id })
      .then((token) => {
        const pool = existsSync(POOL) ? (JSON.parse(readFileSync(POOL, 'utf8')) as unknown[]) : [];
        mkdirSync(dirname(POOL), { recursive: true });
        writeFileSync(
          POOL,
          `${JSON.stringify([...pool, { label: `buyer-${pool.length + 1}`, customerId: token.customerId ?? null, sealed: encryptSecret(vaultKeys, token.id, 'payer-pool'), addedAt: new Date().toISOString() }], null, 2)}\n`,
        );
        response.end('Approved. The buyer is in the pool. You can close this tab.');
        resolve();
        server.close();
      })
      .catch((error: unknown) => {
        response.statusCode = 500;
        response.end('PayPal would not turn that approval into a token. See the terminal.');
        reject(error);
      });
  }).listen(PORT, '127.0.0.1');
});

await done;
process.stdout.write(
  '\nSaved to .bursar/payers.json. Start the sandbox demo with: BURSAR_PAYPAL=sandbox pnpm dev:demo\n',
);
process.exit(0);
