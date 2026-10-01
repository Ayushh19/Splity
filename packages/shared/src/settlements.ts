import * as z from 'zod';
import { isoDate } from './expenses';
import type { Minor } from './money';

export const SETTLEMENT_METHODS = ['upi', 'cash', 'other'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const settlementInput = z
  .object({
    fromMember: z.uuid(),
    toMember: z.uuid(),
    amountMinor: z.number().int().positive('Enter an amount'),
    settledOn: isoDate,
    method: z.enum(SETTLEMENT_METHODS).default('other'),
  })
  .strict()
  .refine((s) => s.fromMember !== s.toMember, { message: 'Pick two different people', path: ['toMember'] });
export type SettlementInput = z.input<typeof settlementInput>;

export const settlementUpdate = z
  .object({
    amountMinor: z.number().int().positive('Enter an amount'),
    settledOn: isoDate,
    method: z.enum(SETTLEMENT_METHODS),
    version: z.number().int().min(1),
  })
  .strict();
export type SettlementUpdate = z.infer<typeof settlementUpdate>;

export const disputeInput = z
  .object({
    version: z.number().int().min(1),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
export type DisputeInput = z.input<typeof disputeInput>;

export interface SettlementSnapshot {
  fromMember: string;
  toMember: string;
  amountMinor: Minor;
  settledOn: string;
  method: SettlementMethod;
  disputedBy: string | null;
  disputeNote: string | null;
  deleted: boolean;
}

export interface SettlementView extends SettlementSnapshot {
  id: string;
  groupId: string;
  recordedBy: string;
  disputedAt: string | null;
  createdAt: string;
  version: number;
}

export interface SettlementDetail {
  settlement: SettlementView;
  history: {
    version: number;
    action: 'create' | 'update' | 'delete' | 'restore' | 'dispute' | 'merge_repoint';
    actorName: string | null;
    createdAt: string;
    snapshot: SettlementSnapshot;
  }[];
}

/**
 * Who may record, edit or delete a payment between `from` and `to`: either of
 * them, or anyone when one side is a placeholder (who can't act for themselves).
 */
export function canRecordSettlement(
  actorMemberId: string,
  from: { id: string; isPlaceholder: boolean },
  to: { id: string; isPlaceholder: boolean },
): boolean {
  return actorMemberId === from.id || actorMemberId === to.id || from.isPlaceholder || to.isPlaceholder;
}

/** Only a real party who didn't record it can dispute a payment. */
export function canDisputeSettlement(actorMemberId: string, s: { fromMember: string; toMember: string; recordedBy: string }): boolean {
  return (actorMemberId === s.fromMember || actorMemberId === s.toMember) && actorMemberId !== s.recordedBy;
}

/**
 * UPI deep link that opens GPay/PhonePe/etc. with the payee and amount filled in.
 * UPI only moves rupees, so this is INR-only.
 */
export function upiPayLink(p: { upiId: string; payeeName: string; amountMinor: Minor; note: string }): string {
  // encodeURIComponent, not URLSearchParams: some UPI apps show "+" literally instead of a space.
  const params: [string, string][] = [
    ['pa', p.upiId],
    ['pn', p.payeeName],
    ['am', (p.amountMinor / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', p.note.slice(0, 50)],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
