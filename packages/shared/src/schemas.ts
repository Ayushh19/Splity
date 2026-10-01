import * as z from 'zod';
import { currencyExponent } from './money';

/** ISO 4217 code that Intl knows about (so we know its minor units). */
export const currencyCode = z.string().refine(
  (code) => {
    try {
      currencyExponent(code);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown currency' },
);

export const displayName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(50, 'Keep it under 50 characters');

/** UPI virtual payment address, e.g. "priya@okaxis". */
export const upiId = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a UPI ID like name@bank');

export const profileUpdate = z
  .object({
    displayName,
    upiId: upiId.nullable(),
    defaultCurrency: currencyCode,
  })
  .partial()
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdate>;

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  upiId: string | null;
  defaultCurrency: string;
}
