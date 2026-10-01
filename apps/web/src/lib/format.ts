import { formatAmount } from '@splity/shared';

export type BalanceTone = 'owed' | 'owe' | 'settled';

export function balanceTone(netMinor: number): BalanceTone {
  return netMinor > 0 ? 'owed' : netMinor < 0 ? 'owe' : 'settled';
}

/** "you are owed ₹500.00" / "you owe ₹500.00" / "settled up" — money state always in words. */
export function yourBalanceText(netMinor: number, currency: string): string {
  if (netMinor > 0) return `you are owed ${formatAmount(netMinor, currency)}`;
  if (netMinor < 0) return `you owe ${formatAmount(-netMinor, currency)}`;
  return 'settled up';
}

/** For a member row: "+₹500.00" / "−₹500.00" / "₹0.00". */
export function signedAmount(netMinor: number, currency: string): string {
  if (netMinor > 0) return `+${formatAmount(netMinor, currency)}`;
  if (netMinor < 0) return `−${formatAmount(-netMinor, currency)}`;
  return formatAmount(0, currency);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase();
}

const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

export const logTime = (iso: string) => timeFormat.format(new Date(iso));
export const logDay = (iso: string) => dayFormat.format(new Date(iso)).toUpperCase();

/** Common currencies first, then every other one Intl knows. */
export const CURRENCIES: string[] = (() => {
  const common = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'THB', 'SGD', 'JPY', 'AUD', 'CAD'];
  const all = Intl.supportedValuesOf('currency').filter((c) => !common.includes(c));
  return [...common, ...all];
})();

/** Only allow same-app relative paths as post-sign-in destinations. */
export function safeNext(next: string | null): string | null {
  return next && /^\/(?![/\\])/.test(next) ? next : null;
}
