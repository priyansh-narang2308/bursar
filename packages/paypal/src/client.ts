import { fromPayPalAmount, type Money, type PayPalAmount, toPayPalAmount } from '@bursar/money';
import { z } from 'zod';
import { type PayPalConfig, Transport } from './transport';

const amountSchema = z.object({ currency_code: z.string(), value: z.string() });
const money = (raw: z.infer<typeof amountSchema>): Money => fromPayPalAmount(raw as PayPalAmount);

const setupToken = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).default([]),
});
const paymentToken = z.object({
  id: z.string(),
  customer: z.object({ id: z.string() }).optional(),
});
const authorizationRef = z.object({ id: z.string(), status: z.string(), amount: amountSchema });
const order = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        payments: z.object({ authorizations: z.array(authorizationRef).default([]) }).optional(),
      }),
    )
    .default([]),
});
const authorization = z.object({
  id: z.string(),
  status: z.string(),
  amount: amountSchema,
  create_time: z.string().optional(),
  expiration_time: z.string().optional(),
});
const money_op = z.object({ id: z.string(), status: z.string(), amount: amountSchema.optional() });
const payoutBatch = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string().optional(),
        transaction_status: z.string().optional(),
        payout_item: z.object({ sender_item_id: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});
const verification = z.object({ verification_status: z.enum(['SUCCESS', 'FAILURE']) });
const webhook = z.object({ id: z.string() });

export type { PayPalConfig };
export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** A typed PayPal client for what Bursar uses: Vault, Orders, Payments, Payouts and webhooks. */
export function createPayPalClient(config: PayPalConfig) {
  const transport = new Transport(config);
  const call = transport.call.bind(transport);
  const post = transport.post.bind(transport);
  const none = z.object({}).loose();

  return {
    vault: {
      /** Starts saving a payer's PayPal as a payment method; the payer approves at `approveUrl`. */
      async createSetupToken(input: { requestId: string; returnUrl: string; cancelUrl: string }) {
        const raw = await post(
          '/v3/vault/setup-tokens',
          input.requestId,
          {
            payment_source: {
              paypal: {
                usage_type: 'MERCHANT',
                experience_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl },
              },
            },
          },
          setupToken,
        );
        return {
          id: raw.id,
          status: raw.status,
          approveUrl: raw.links.find((l) => l.rel === 'approve')?.href,
        };
      },
      async createPaymentToken(input: { requestId: string; setupTokenId: string }) {
        const raw = await post(
          '/v3/vault/payment-tokens',
          input.requestId,
          { payment_source: { token: { id: input.setupTokenId, type: 'SETUP_TOKEN' } } },
          paymentToken,
        );
        return { id: raw.id, customerId: raw.customer?.id };
      },
      /** Revoking a mandate deletes its payment token: PayPal itself then refuses to charge it. */
      async deletePaymentToken(id: string): Promise<void> {
        await call('DELETE', `/v3/vault/payment-tokens/${encodeURIComponent(id)}`, {
          schema: none,
        });
      },
    },
    orders: {
      /** Places the hold: an AUTHORIZE order paid from a vaulted token, tagged with the provenance `customId`. */
      async createAuthorizeOrder(input: {
        requestId: string;
        vaultId: string;
        amount: Money;
        customId: string;
        referenceId: string;
        invoiceId?: string;
      }) {
        const raw = await post(
          '/v2/checkout/orders',
          input.requestId,
          {
            intent: 'AUTHORIZE',
            purchase_units: [
              {
                reference_id: input.referenceId,
                custom_id: input.customId,
                ...(input.invoiceId === undefined ? {} : { invoice_id: input.invoiceId }),
                amount: toPayPalAmount(input.amount),
              },
            ],
            payment_source: { paypal: { vault_id: input.vaultId } },
          },
          order,
        );
        return {
          id: raw.id,
          status: raw.status,
          authorizationId: raw.purchase_units[0]?.payments?.authorizations[0]?.id,
        };
      },
      async authorize(input: { requestId: string; orderId: string }) {
        const raw = await post(
          `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/authorize`,
          input.requestId,
          undefined,
          order,
        );
        return {
          id: raw.id,
          status: raw.status,
          authorizationId: raw.purchase_units[0]?.payments?.authorizations[0]?.id,
        };
      },
    },
    payments: {
      async getAuthorization(id: string) {
        const raw = await call('GET', `/v2/payments/authorizations/${encodeURIComponent(id)}`, {
          schema: authorization,
        });
        return {
          id: raw.id,
          status: raw.status,
          amount: money(raw.amount),
          expiresAt: raw.expiration_time,
        };
      },
      async capture(input: {
        requestId: string;
        authorizationId: string;
        amount: Money;
        finalCapture: boolean;
        invoiceId?: string;
      }) {
        const raw = await post(
          `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
          input.requestId,
          {
            amount: toPayPalAmount(input.amount),
            final_capture: input.finalCapture,
            ...(input.invoiceId === undefined ? {} : { invoice_id: input.invoiceId }),
          },
          money_op,
        );
        return { id: raw.id, status: raw.status };
      },
      async void(input: { requestId: string; authorizationId: string }) {
        await post(
          `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/void`,
          input.requestId,
          undefined,
          none,
        );
      },
      async reauthorize(input: { requestId: string; authorizationId: string; amount: Money }) {
        const raw = await post(
          `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/reauthorize`,
          input.requestId,
          { amount: toPayPalAmount(input.amount) },
          money_op,
        );
        return { id: raw.id, status: raw.status };
      },
      async refund(input: { requestId: string; captureId: string; amount: Money }) {
        const raw = await post(
          `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
          input.requestId,
          { amount: toPayPalAmount(input.amount) },
          money_op,
        );
        return { id: raw.id, status: raw.status };
      },
    },
    payouts: {
      /** Pays suppliers. Reusing `batchId` and each `itemId` is how a retry stays one payout. */
      async create(input: {
        requestId: string;
        batchId: string;
        items: readonly { itemId: string; receiver: string; amount: Money }[];
      }) {
        const raw = await post(
          '/v1/payments/payouts',
          input.requestId,
          {
            sender_batch_header: {
              sender_batch_id: input.batchId,
              email_subject: 'You have a payment',
            },
            items: input.items.map((item) => ({
              recipient_type: 'EMAIL',
              receiver: item.receiver,
              amount: { currency: item.amount.currency, value: item.amount.toDecimal() },
              sender_item_id: item.itemId,
            })),
          },
          z.object({
            batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
          }),
        );
        return { batchId: raw.batch_header.payout_batch_id, status: raw.batch_header.batch_status };
      },
      async get(batchId: string) {
        const raw = await call('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
          schema: payoutBatch,
        });
        return {
          batchId: raw.batch_header.payout_batch_id,
          status: raw.batch_header.batch_status,
          items: raw.items.map((i) => ({
            itemId: i.payout_item?.sender_item_id,
            status: i.transaction_status,
          })),
        };
      },
    },
    webhooks: {
      async register(input: { requestId: string; url: string; eventTypes: readonly string[] }) {
        const raw = await post(
          '/v1/notifications/webhooks',
          input.requestId,
          { url: input.url, event_types: input.eventTypes.map((name) => ({ name })) },
          webhook,
        );
        return { id: raw.id };
      },
      /** Asks PayPal whether a webhook is genuine. Anything but SUCCESS is false. */
      async verify(input: {
        webhookId: string;
        headers: Readonly<Record<string, string>>;
        event: unknown;
      }): Promise<boolean> {
        const raw = await post(
          '/v1/notifications/verify-webhook-signature',
          crypto.randomUUID(),
          {
            auth_algo: input.headers['paypal-auth-algo'],
            cert_url: input.headers['paypal-cert-url'],
            transmission_id: input.headers['paypal-transmission-id'],
            transmission_sig: input.headers['paypal-transmission-sig'],
            transmission_time: input.headers['paypal-transmission-time'],
            webhook_id: input.webhookId,
            webhook_event: input.event,
          },
          verification,
        );
        return raw.verification_status === 'SUCCESS';
      },
    },
  };
}
