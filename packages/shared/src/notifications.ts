import * as z from 'zod';

export const pushSubscriptionInput = z
  .object({
    endpoint: z.url().max(2000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  })
  .strip();
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

export const unsubscribeInput = z.object({ endpoint: z.url().max(2000) }).strict();

export const muteInput = z.object({ muted: z.boolean() }).strict();

export const reminderInput = z.object({ toMember: z.uuid() }).strict();

/** One reminder per sender → receiver pair per group per day. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface ReminderView {
  toMember: string;
  sentAt: string;
}

export interface ReminderResult {
  /** False when the person has no device with notifications on; nothing was recorded. */
  delivered: boolean;
  reminder: ReminderView | null;
}

/** What the service worker receives in a push message. */
export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other (e.g. repeated edits to one expense). */
  tag: string;
}
