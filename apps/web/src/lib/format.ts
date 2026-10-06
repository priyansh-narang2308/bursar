import { type CurrencyCode, Money } from '@bursar/money';

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

/** An amount for display, like "$1,250.00". It reads minor units exactly; there is no float anywhere. */
export function formatMoney(
  minor: string | bigint | null | undefined,
  currency: string | null | undefined,
): string {
  if (minor === null || minor === undefined || currency === null || currency === undefined)
    return '—';
  const decimal = Money.of(BigInt(minor), currency as CurrencyCode).toDecimal();
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction] = decimal.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = SYMBOLS[currency];
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return `${negative ? '−' : ''}${symbol ?? ''}${body}${symbol === undefined ? ` ${currency}` : ''}`;
}

/** An amount typed as dollars and cents, as minor units in a string. Nothing else is accepted. */
export function minorFromInput(text: string, currency = 'USD'): string | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Money.parse(
    trimmed.includes('.') ? trimmed.padEnd(trimmed.indexOf('.') + 3, '0') : `${trimmed}.00`,
    currency as CurrencyCode,
  ).minor.toString();
}

const SHORT = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const formatTime = (iso: string | null | undefined) =>
  iso ? SHORT.format(new Date(iso)) : '—';
export const formatDay = (iso: string | null | undefined) =>
  iso ? DAY.format(new Date(iso)) : '—';

/** "just now", "3m ago", "2h ago", "in 2d". */
export function relative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 5) return 'just now';
  const [n, unit] =
    abs < 60
      ? [abs, 's']
      : abs < 3600
        ? [Math.round(abs / 60), 'm']
        : abs < 86_400
          ? [Math.round(abs / 3600), 'h']
          : [Math.round(abs / 86_400), 'd'];
  return seconds < 0 ? `${n}${unit} ago` : `in ${n}${unit}`;
}

/** A readable name for a screaming-case state: "AWAITING_APPROVAL" becomes "Awaiting approval". */
export const humanize = (value: string) => {
  const text = value.toLowerCase().replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The start and end of an id, so a column stays narrow: "mis_01M4…7XQ". */
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
