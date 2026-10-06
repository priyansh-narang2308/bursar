import { amountSchema, idSchemas } from '@bursar/schemas';
import { z } from 'zod';
import type { Context } from './context';
import {
  allow,
  ask,
  commonCurrency,
  currencyMismatch,
  defineRule,
  deny,
  isSpend,
  money,
  notApplicable,
  show,
  validApprovers,
} from './kit';

const HOUR = 3_600_000;
const none = z.strictObject({});
const cartOf = (context: Context) => context.cart?.lines ?? [];
/** An AUTHORIZE (or re-authorize) is the one that commits a cart. */
const commitsCart = (context: Context) =>
  ['AUTHORIZE', 'REAUTHORIZE'].includes(context.action.type);

// ---------------------------------------------------------------------------------------
// Safety fundamentals
// ---------------------------------------------------------------------------------------

export const mandate = defineRule({
  id: 'R-MANDATE',
  version: 1,
  summary: 'The mandate is active, inside its window and not frozen.',
  params: none,
  check: (context) => {
    const { mandate: held, now } = context;
    if (!isSpend(context)) return notApplicable();
    if (held === null) return deny('There is no mandate to spend under.');
    if (held.status !== 'ACTIVE') {
      return deny(`The mandate is ${held.status.toLowerCase()}.`, { status: held.status });
    }
    if (Date.parse(now) < Date.parse(held.validFrom))
      return deny('The mandate has not started yet.');
    if (Date.parse(now) >= Date.parse(held.validTo)) return deny('The mandate has ended.');
    return allow('The mandate is active and within its window.');
  },
});

export const envelope = defineRule({
  id: 'R-ENVELOPE',
  version: 1,
  summary:
    'Captured plus held plus this authorization stays within the ceiling; a capture stays within what is held.',
  params: none,
  check: (context) => {
    const { action, envelope: env } = context;
    if (!['AUTHORIZE', 'REAUTHORIZE', 'CAPTURE'].includes(action.type)) return notApplicable();
    if (env === null || action.amount === null)
      return deny('There is no envelope or amount to check.');
    if (commonCurrency(action.amount, env.ceiling, env.held, env.captured) === undefined) {
      return currencyMismatch();
    }
    const [amount, held, captured, ceiling] = [
      action.amount,
      env.held,
      env.captured,
      env.ceiling,
    ].map(money) as [
      ReturnType<typeof money>,
      ReturnType<typeof money>,
      ReturnType<typeof money>,
      ReturnType<typeof money>,
    ];
    if (action.type === 'CAPTURE') {
      return amount.greaterThan(held)
        ? deny(`Capturing ${show(amount)} is more than the ${show(held)} held.`)
        : allow('The capture is within what is held.');
    }
    const after = captured.add(held).add(amount);
    const inputs = { used: show(captured.add(held)), requested: show(amount) };
    return after.greaterThan(ceiling)
      ? deny(
          `This would bring the envelope to ${show(after)}, over its ceiling of ${show(ceiling)}.`,
          inputs,
          show(ceiling),
        )
      : allow(
          `The envelope would be at ${show(after)} of ${show(ceiling)}.`,
          inputs,
          show(ceiling),
        );
  },
});

export const itemCap = defineRule({
  id: 'R-ITEM-CAP',
  version: 1,
  summary: 'No single cart line costs more than its cap.',
  params: z.strictObject({ max: amountSchema }),
  check: (context, { max }) => {
    const lines = cartOf(context);
    if (lines.some((line) => commonCurrency(line.lineTotal, max) === undefined))
      return currencyMismatch();
    const over = lines.filter((line) => money(line.lineTotal).greaterThan(money(max)));
    return over.length > 0
      ? deny(
          `${over.length} line(s) cost more than the cap of ${show(money(max))}.`,
          { offers: over.map((l) => l.offerId) },
          show(money(max)),
        )
      : allow(`Every line is within the cap of ${show(money(max))}.`, {}, show(money(max)));
  },
});

export const orderCap = defineRule({
  id: 'R-ORDER-CAP',
  version: 1,
  summary: 'The order total stays within its cap and equals the amount being authorized.',
  params: z.strictObject({ max: amountSchema }),
  check: (context, { max }) => {
    if (!commitsCart(context)) return notApplicable();
    const { cart, action } = context;
    if (cart === null || action.amount === null)
      return deny('An authorization needs a cart and an amount.');
    if (commonCurrency(cart.total, action.amount, max) === undefined) return currencyMismatch();
    if (!money(cart.total).equals(money(action.amount))) {
      return deny('The amount does not match the cart total.', {
        amount: show(money(action.amount)),
        total: show(money(cart.total)),
      });
    }
    return money(cart.total).greaterThan(money(max))
      ? deny(
          `The order of ${show(money(cart.total))} is over the cap of ${show(money(max))}.`,
          {},
          show(money(max)),
        )
      : allow(`The order is within the cap of ${show(money(max))}.`, {}, show(money(max)));
  },
});

export const vendor = defineRule({
  id: 'R-VENDOR',
  version: 1,
  summary:
    'Every supplier is active, on the allow-list if there is one, and not on the block-list.',
  params: z.strictObject({
    allow: z.array(idSchemas.supplier).default([]),
    block: z.array(idSchemas.supplier).default([]),
  }),
  check: (context, params) => {
    const wanted = new Set([
      ...cartOf(context).map((line) => line.supplierId),
      ...(context.action.supplierId === null ? [] : [context.action.supplierId]),
    ]);
    const known = new Map(context.suppliers.map((s) => [s.id, s]));
    const problems = [...wanted].flatMap((id) => {
      const supplier = known.get(id);
      if (supplier === undefined) return [`${id} is not in the supplier registry`];
      if (supplier.status !== 'ACTIVE') return [`${id} is blocked`];
      if (params.block.includes(id)) return [`${id} is on the block-list`];
      if (params.allow.length > 0 && !params.allow.includes(id))
        return [`${id} is not on the allow-list`];
      return [];
    });
    return problems.length > 0
      ? deny(`${problems.join('; ')}.`, { problems })
      : allow('Every supplier is approved.');
  },
});

export const tenant = defineRule({
  id: 'R-TENANT',
  version: 1,
  summary: 'Everything the action touches belongs to the actor’s organisation.',
  params: none,
  check: (context) => {
    const owners: Record<string, string | undefined> = {
      action: context.action.orgId,
      mandate: context.mandate?.orgId,
      envelope: context.envelope?.orgId,
      cart: context.cart?.orgId,
      ...Object.fromEntries(context.suppliers.map((s) => [`supplier ${s.id}`, s.orgId])),
    };
    const foreign = Object.entries(owners)
      .filter(([, org]) => org !== undefined && org !== context.orgId)
      .map(([name]) => name);
    return foreign.length > 0
      ? deny(`Belongs to another organisation: ${foreign.join(', ')}.`, { foreign })
      : allow('Everything belongs to this organisation.');
  },
});

export const provenance = defineRule({
  id: 'R-PROVENANCE',
  version: 1,
  summary:
    'An agent’s action traces to a run, and every approval is genuine, matches the cart and policy, and has not expired.',
  params: none,
  check: (context) => {
    const { action, approvals, now } = context;
    if (action.proposedBy === 'AGENT' && action.agentRunId === null) {
      return deny('An agent’s action must trace back to an agent run.');
    }
    const bad = approvals
      .filter((a) => a.status === 'APPROVED')
      .flatMap((a) => [
        ...(a.signatureValid ? [] : [`${a.id}: the signature is not valid`]),
        ...(a.cartHashMatches ? [] : [`${a.id}: the cart has changed since it was approved`]),
        ...(a.policyHashMatches ? [] : [`${a.id}: the policy has changed since it was approved`]),
        ...(Date.parse(a.expiresAt) > Date.parse(now) ? [] : [`${a.id}: it has expired`]),
      ]);
    return bad.length > 0
      ? deny(`${bad.join('; ')}.`, { problems: bad })
      : allow('The action is traceable and any approval is genuine.');
  },
});

// ---------------------------------------------------------------------------------------
// Behavioural and anti-abuse
// ---------------------------------------------------------------------------------------

export const newVendor = defineRule({
  id: 'R-NEW-VENDOR',
  version: 1,
  summary: 'A supplier paid for the first time needs a person to look.',
  params: none,
  check: (context) => {
    if (!isSpend(context)) return notApplicable();
    const fresh = context.suppliers.filter((s) => s.priorPayouts === 0).map((s) => s.id);
    return fresh.length > 0
      ? ask(context, `First time paying ${fresh.join(', ')}.`, 1, { suppliers: fresh })
      : allow('Every supplier has been paid before.');
  },
});

export const quantity = defineRule({
  id: 'R-QTY',
  version: 1,
  summary: 'A line with an unusually large quantity needs a person to look.',
  params: z.strictObject({ maxPerLine: z.int().min(1).default(10) }),
  check: (context, { maxPerLine }) => {
    const big = cartOf(context).filter((line) => line.quantity > maxPerLine);
    return big.length > 0
      ? ask(
          context,
          `${big.length} line(s) ask for more than ${maxPerLine} of one item.`,
          1,
          { offers: big.map((l) => l.offerId) },
          maxPerLine,
        )
      : allow(`No line is over ${maxPerLine} of one item.`, {}, maxPerLine);
  },
});

export const priceDrift = defineRule({
  id: 'R-PRICE-DRIFT',
  version: 1,
  summary:
    'The price re-quoted now is not more than a set number of basis points above the cart’s.',
  params: z.strictObject({ maxBasisPoints: z.int().min(0).default(500) }),
  check: (context, { maxBasisPoints }) => {
    const lines = cartOf(context);
    if (lines.some((l) => commonCurrency(l.unitPrice, l.quotedUnitPrice) === undefined))
      return currencyMismatch();
    const drifted = lines.filter((line) => {
      const [unit, quoted] = [money(line.unitPrice).minor, money(line.quotedUnitPrice).minor];
      return (
        quoted > unit &&
        (unit === 0n || ((quoted - unit) * 10_000n) / unit > BigInt(maxBasisPoints))
      );
    });
    return drifted.length > 0
      ? deny(
          `${drifted.length} line(s) now cost more than ${maxBasisPoints} basis points above the price in the cart.`,
          { offers: drifted.map((l) => l.offerId) },
          maxBasisPoints,
        )
      : allow('Prices have not moved beyond the allowance.', {}, maxBasisPoints);
  },
});

const within = (context: Context, at: string, hours: number) => {
  const age = Date.parse(context.now) - Date.parse(at);
  return age >= 0 && age <= hours * HOUR;
};

export const duplicate = defineRule({
  id: 'R-DUPLICATE',
  version: 1,
  summary: 'The same item from the same supplier is not bought twice within a window.',
  params: z.strictObject({ windowHours: z.int().min(1).default(24) }),
  check: (context, { windowHours }) => {
    const wanted = cartOf(context).map((l) => `${l.supplierId}/${l.offerId}`);
    const repeats = context.recent
      .filter((order) => within(context, order.at, windowHours))
      .flatMap((order) => order.offerIds.map((id) => `${order.supplierId}/${id}`))
      .filter((key) => wanted.includes(key));
    return repeats.length > 0
      ? ask(
          context,
          `${repeats.length} item(s) were already bought in the last ${windowHours} hours.`,
          1,
          { repeats },
          windowHours,
        )
      : allow('Nothing here was bought recently.', {}, windowHours);
  },
});

export const velocity = defineRule({
  id: 'R-VELOCITY',
  version: 2,
  summary:
    'Orders and spend in a rolling window, counted by supplier and by payee, stay within limits. Splitting an order across suppliers that share a payee does not escape it, and an optional organisation-wide limit stops it being split across suppliers that do not.',
  params: z.strictObject({
    windowHours: z.int().min(1).default(24),
    maxOrders: z.int().min(1).default(5),
    max: amountSchema,
    /** If set, all buying together, whatever the supplier, stays within this in the window. */
    orgMax: amountSchema.optional(),
  }),
  check: (context, params) => {
    if (!commitsCart(context)) return notApplicable();
    const lines = cartOf(context);
    const suppliers = new Map(context.suppliers.map((s) => [s.id, s]));
    const recent = context.recent.filter((order) => within(context, order.at, params.windowHours));
    if (
      [...recent.map((o) => o.amount), ...lines.map((l) => l.lineTotal), params.max].some(
        (a) => a.currency !== params.max.currency,
      )
    ) {
      return currencyMismatch();
    }
    const keys = new Set(
      lines.flatMap((l) => [
        `supplier:${l.supplierId}`,
        `payee:${suppliers.get(l.supplierId)?.payee ?? ''}`,
      ]),
    );
    const keyed = (key: string, supplierId: string, payee: string) =>
      key === `supplier:${supplierId}` || key === `payee:${payee}`;
    const exceeded = [...keys].flatMap((key) => {
      const orders = recent.filter((o) => keyed(key, o.supplierId, o.payee));
      const spent = orders.reduce((sum, o) => sum + money(o.amount).minor, 0n);
      const adding = lines
        .filter((l) => keyed(key, l.supplierId, suppliers.get(l.supplierId)?.payee ?? ''))
        .reduce((sum, l) => sum + money(l.lineTotal).minor, 0n);
      return orders.length + 1 > params.maxOrders || spent + adding > money(params.max).minor
        ? [key]
        : [];
    });
    const spentAll = recent.reduce((sum, o) => sum + money(o.amount).minor, 0n);
    const addingAll = lines.reduce((sum, l) => sum + money(l.lineTotal).minor, 0n);
    if (params.orgMax !== undefined && spentAll + addingAll > money(params.orgMax).minor)
      exceeded.push('organisation');
    return exceeded.length > 0
      ? ask(
          context,
          `Too much buying in ${params.windowHours} hours for ${exceeded.join(', ')}.`,
          1,
          { exceeded },
          show(money(params.max)),
        )
      : allow('Buying is within the rolling limits.', {}, show(money(params.max)));
  },
});

export const delivery = defineRule({
  id: 'R-DELIVERY',
  version: 1,
  summary: 'Every item is expected before the mission’s deadline.',
  params: none,
  check: (context) => {
    const { cart } = context;
    if (cart === null || cart.deadline === null) return notApplicable();
    const deadline = Date.parse(cart.deadline);
    const late = cart.lines.filter(
      (l) => l.estimatedArrival === null || Date.parse(l.estimatedArrival) > deadline,
    );
    return late.length > 0
      ? ask(
          context,
          `${late.length} item(s) may arrive after the deadline, or have no estimate.`,
          1,
          { offers: late.map((l) => l.offerId) },
        )
      : allow('Everything should arrive in time.');
  },
});

export const dual = defineRule({
  id: 'R-DUAL',
  version: 1,
  summary:
    'Above a threshold, two different people must approve, and nobody approves their own action.',
  params: z.strictObject({ above: amountSchema, approvers: z.int().min(1).max(2).default(2) }),
  check: (context, { above, approvers }) => {
    const { action, approvals } = context;
    if (
      action.proposerId !== null &&
      approvals.some((a) => a.status === 'APPROVED' && a.approverId === action.proposerId)
    ) {
      return deny('Nobody may approve their own action.');
    }
    if (!isSpend(context) || action.amount === null) return notApplicable();
    if (commonCurrency(action.amount, above) === undefined) return currencyMismatch();
    return money(action.amount).greaterThan(money(above))
      ? ask(
          context,
          `Above ${show(money(above))}, ${approvers} different people must approve.`,
          approvers,
          { approved: validApprovers(context).size },
          show(money(above)),
        )
      : allow(`Not above ${show(money(above))}.`, {}, show(money(above)));
  },
});

export const refundAuth = defineRule({
  id: 'R-REFUND-AUTH',
  version: 1,
  summary: 'An agent may refund only small amounts alone; larger refunds need a person.',
  params: z.strictObject({ agentMax: amountSchema }),
  check: (context, { agentMax }) => {
    const { action } = context;
    if (action.type !== 'REFUND' || action.proposedBy !== 'AGENT' || action.amount === null)
      return notApplicable();
    if (commonCurrency(action.amount, agentMax) === undefined) return currencyMismatch();
    return money(action.amount).greaterThan(money(agentMax))
      ? ask(
          context,
          `An agent may refund up to ${show(money(agentMax))} alone.`,
          1,
          {},
          show(money(agentMax)),
        )
      : allow('The refund is within what an agent may do alone.', {}, show(money(agentMax)));
  },
});

export const payoutGate = defineRule({
  id: 'R-PAYOUT-GATE',
  version: 1,
  summary:
    'A payout needs the goods inspected, the cooling-off window over and the capture settled.',
  params: none,
  check: (context) => {
    const { action, payout, now } = context;
    if (action.type !== 'PAYOUT') return notApplicable();
    if (payout === null) return deny('There is no delivery record for this payout.');
    const missing = [
      ...(payout.inspected ? [] : ['the goods have not been inspected']),
      ...(Date.parse(now) >= Date.parse(payout.coolingOffEndsAt)
        ? []
        : ['the cooling-off window is still open']),
      ...(payout.captureSettled ? [] : ['the capture has not settled']),
    ];
    return missing.length > 0
      ? deny(`Not yet: ${missing.join('; ')}.`, { missing })
      : allow('Inspected, cooled off and settled.');
  },
});

export const category = defineRule({
  id: 'R-CATEGORY',
  version: 1,
  summary: 'Spend in a category stays within that category’s cap.',
  params: z.strictObject({
    caps: z.array(z.strictObject({ category: z.string(), max: amountSchema })).default([]),
  }),
  check: (context, { caps }) => {
    const lines = cartOf(context);
    if (
      lines.some((l) =>
        caps.some(
          (c) => c.category === l.category && commonCurrency(l.lineTotal, c.max) === undefined,
        ),
      )
    ) {
      return currencyMismatch();
    }
    const over = caps.flatMap(({ category: name, max }) => {
      const spent = lines
        .filter((l) => l.category === name)
        .reduce((sum, l) => sum + money(l.lineTotal).minor, 0n);
      return spent > money(max).minor ? [name] : [];
    });
    return over.length > 0
      ? deny(`Over the cap for: ${over.join(', ')}.`, { categories: over })
      : allow('Every category is within its cap.');
  },
});
