import { describe, expect, it } from 'vitest';
import { convertWithRate, currencyExponent, formatAmount, MoneyError, parseAmount } from '../src';

describe('currencyExponent', () => {
  it('knows minor units per currency', () => {
    expect(currencyExponent('INR')).toBe(2);
    expect(currencyExponent('THB')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
  });

  it('rejects unknown codes', () => {
    expect(() => currencyExponent('XYZ')).toThrow(MoneyError);
    expect(() => currencyExponent('inr')).toThrow(MoneyError);
  });
});

describe('parseAmount', () => {
  it('parses plain, grouped and Indian-grouped input', () => {
    expect(parseAmount('3000', 'INR')).toBe(300000);
    expect(parseAmount('3,000.5', 'INR')).toBe(300050);
    expect(parseAmount('10,00,000.00', 'INR')).toBe(100000000);
    expect(parseAmount(' 0.01 ', 'INR')).toBe(1);
    expect(parseAmount('500', 'JPY')).toBe(500);
  });

  it('rejects bad input', () => {
    for (const bad of ['', '-5', '1e3', '12.345', 'abc', '1.2.3', '.5']) {
      expect(() => parseAmount(bad, 'INR'), bad).toThrow(MoneyError);
    }
    expect(() => parseAmount('5.5', 'JPY')).toThrow(/at most 0 decimal places/);
  });
});

describe('formatAmount', () => {
  it('formats with the currency symbol and fixed decimals', () => {
    expect(formatAmount(300050, 'INR')).toBe('₹3,000.50');
    expect(formatAmount(100000000, 'INR')).toBe('₹10,00,000.00');
    expect(formatAmount(500, 'JPY', 'en-US')).toBe('¥500');
  });
});

describe('convertWithRate', () => {
  it('converts the spec example: ฿2,000 at 2.35 → ₹4,700', () => {
    expect(convertWithRate(200000, 'THB', '2.35', 'INR')).toBe(470000);
  });

  it('rounds half up to the target minor unit', () => {
    // ฿0.01 at 2.35 = ₹0.0235 → 2 paise; ฿0.03 at 2.35 = ₹0.0705 → 7 paise
    expect(convertWithRate(1, 'THB', '2.35', 'INR')).toBe(2);
    expect(convertWithRate(3, 'THB', '2.35', 'INR')).toBe(7);
    // exactly half: ฿0.10 at 0.05 = ₹0.005 → 1 paisa
    expect(convertWithRate(10, 'THB', '0.05', 'INR')).toBe(1);
  });

  it('handles currencies with different exponents', () => {
    // ¥1,000 at 0.56 = ₹560.00
    expect(convertWithRate(1000, 'JPY', '0.56', 'INR')).toBe(56000);
    // ₹100.00 at 1.79 = ¥179
    expect(convertWithRate(10000, 'INR', '1.79', 'JPY')).toBe(179);
  });

  it('rejects bad rates', () => {
    for (const bad of ['0', '0.000', '-1', 'abc', '1e2', '1.12345678901']) {
      expect(() => convertWithRate(100, 'THB', bad, 'INR'), bad).toThrow(MoneyError);
    }
  });
});
