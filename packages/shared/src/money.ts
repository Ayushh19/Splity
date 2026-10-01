/**
 * Money primitives. All amounts are integers in the currency's minor unit
 * (paise for INR, satang for THB, yen for JPY). Floating point never touches
 * a stored amount: parsing and FX conversion use string/BigInt arithmetic.
 */

export type MemberId = string;
/** An integer amount in minor units. */
export type Minor = number;

export type MoneyErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_CURRENCY'
  | 'INVALID_RATE'
  | 'INVALID_SPLIT'
  | 'SUM_MISMATCH'
  | 'UNKNOWN_MEMBER';

export class MoneyError extends Error {
  constructor(
    readonly code: MoneyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertMinor(value: number, what = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('INVALID_AMOUNT', `${what} must be an integer number of minor units, got ${value}`);
  }
}

let knownCurrencies: ReadonlySet<string> | undefined;
const exponents = new Map<string, number>();

/** Number of minor-unit digits for an ISO 4217 currency (INR → 2, JPY → 0). */
export function currencyExponent(currency: string): number {
  const cached = exponents.get(currency);
  if (cached !== undefined) return cached;

  knownCurrencies ??= new Set(Intl.supportedValuesOf('currency'));
  if (!knownCurrencies.has(currency)) {
    throw new MoneyError('INVALID_CURRENCY', `Unknown currency code: ${currency}`);
  }
  const exponent = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  if (exponent === undefined) {
    throw new MoneyError('INVALID_CURRENCY', `Cannot determine minor units for ${currency}`);
  }
  exponents.set(currency, exponent);
  return exponent;
}

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse user input like "3,000.50" or "10,00,000" into minor units.
 * Rejects negative numbers, exponents and more decimals than the currency allows.
 */
export function parseAmount(input: string, currency: string): Minor {
  const exponent = currencyExponent(currency);
  const match = AMOUNT_PATTERN.exec(input.trim().replaceAll(',', ''));
  if (!match) throw new MoneyError('INVALID_AMOUNT', `Not a valid amount: "${input}"`);

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) {
    throw new MoneyError(
      'INVALID_AMOUNT',
      `${currency} allows at most ${exponent} decimal place${exponent === 1 ? '' : 's'}`,
    );
  }
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  assertMinor(minor);
  return minor;
}

/** Format minor units for display, e.g. 300050 INR → "₹3,000.50". */
export function formatAmount(minor: Minor, currency: string, locale = 'en-IN'): string {
  assertMinor(minor);
  const exponent = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

const RATE_PATTERN = /^(\d+)(?:\.(\d{1,10}))?$/;

/**
 * Convert a foreign-currency amount into the group currency using a manually
 * entered rate (group-currency units per one foreign unit), rounding half up
 * to the group currency's minor unit.
 *
 * Example: ฿2,000.00 (200000 THB minor) at "2.35" → ₹4,700.00 (470000 INR minor).
 */
export function convertWithRate(
  originalMinor: Minor,
  fromCurrency: string,
  rate: string,
  toCurrency: string,
): Minor {
  assertMinor(originalMinor, 'original amount');
  if (originalMinor < 0) throw new MoneyError('INVALID_AMOUNT', 'Original amount cannot be negative');

  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) throw new MoneyError('INVALID_RATE', `Not a valid exchange rate: "${rate}"`);
  const rateDigits = (match[1] ?? '0') + (match[2] ?? '');
  const rateScale = (match[2] ?? '').length;
  const rateUnits = BigInt(rateDigits);
  if (rateUnits === 0n) throw new MoneyError('INVALID_RATE', 'Exchange rate must be greater than zero');

  const fromExp = BigInt(currencyExponent(fromCurrency));
  const toExp = BigInt(currencyExponent(toCurrency));

  const numerator = BigInt(originalMinor) * rateUnits * 10n ** toExp;
  const denominator = 10n ** BigInt(rateScale) * 10n ** fromExp;
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);

  const result = Number(rounded);
  assertMinor(result, 'converted amount');
  return result;
}
