import { describe, expect, it } from 'vitest';
import * as money from '../src';

describe('@bursar/money public API', () => {
  it('exposes exactly the documented runtime exports', () => {
    expect(Object.keys(money).sort()).toEqual([
      'CURRENCY_CODES',
      'MAX_MINOR',
      'MIN_MINOR',
      'Money',
      'MoneyError',
      'ROUNDING_MODES',
      'basisPoints',
      'currencyExponent',
      'fromPayPalAmount',
      'isCurrencyCode',
      'isRoundingMode',
      'moneyFromJSON',
      'parseCurrencyCode',
      'percent',
      'rate',
      'toPayPalAmount',
    ]);
  });
});
