import { formatAmount } from '@splity/shared';
import type { ActivityEvent } from '../lib/api';
import { logDay, logTime } from '../lib/format';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One event as a terminal log line's text (DESIGN.md › Activity feed — log lines). */
function describe(e: ActivityEvent): string {
  const p = e.payload;
  switch (e.type) {
    case 'group.created':
      return `created the group`;
    case 'group.renamed':
      return `renamed the group to "${str(p.to)}"`;
    case 'group.simplify_changed':
      return `turned simplify debts ${p.simplifyDebts ? 'on' : 'off'}`;
    case 'invite.reset':
      return 'reset the invite link';
    case 'member.added':
      return `added ${str(p.name)}`;
    case 'member.joined':
      return 'joined';
    case 'member.rejoined':
      return 'rejoined';
    case 'member.claimed':
      return `joined as "${str(p.placeholder)}"`;
    case 'member.claim_undone':
      return `undid ${str(p.claimedBy)}'s claim of "${str(p.placeholder)}"`;
    case 'member.promoted':
      return `made ${str(p.name)} an admin`;
    case 'member.removed':
      return `removed ${str(p.name)}`;
    case 'member.deleted':
      return `deleted ${str(p.name)}`;
    case 'member.left':
      return 'left the group';
    case 'admin.auto_promoted':
      return `${str(p.name)} is now an admin`;
    case 'expense.created':
    case 'expense.updated':
    case 'expense.deleted':
    case 'expense.restored': {
      const verb = { 'expense.created': 'added', 'expense.updated': 'edited', 'expense.deleted': 'deleted', 'expense.restored': 'restored' }[e.type];
      const amount = typeof p.amountMinor === 'number' && str(p.currency) ? ` · ${formatAmount(p.amountMinor, str(p.currency))}` : '';
      return `${verb} "${str(p.description)}"${amount}`;
    }
    case 'settlement.recorded':
    case 'settlement.updated':
    case 'settlement.deleted':
    case 'settlement.restored':
    case 'settlement.disputed':
    case 'settlement.dispute_withdrawn': {
      const amount = typeof p.amountMinor === 'number' && str(p.currency) ? formatAmount(p.amountMinor, str(p.currency)) : '';
      const pay = `${str(p.from)} → ${str(p.to)} ${amount}`;
      const verb = {
        'settlement.recorded': 'recorded a payment',
        'settlement.updated': 'edited a payment',
        'settlement.deleted': 'deleted a payment',
        'settlement.restored': 'restored a payment',
        'settlement.disputed': 'disputed a payment',
        'settlement.dispute_withdrawn': 'withdrew a dispute on',
      }[e.type];
      return `${verb}: ${pay}${e.type === 'settlement.disputed' && str(p.note) ? ` — "${str(p.note)}"` : ''}`;
    }
    default:
      return e.type;
  }
}

export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  let lastDay = '';
  return (
    <ol className="log">
      {events.map((e) => {
        const day = logDay(e.createdAt);
        const divider = day !== lastDay;
        lastDay = day;
        return (
          <li key={e.id}>
            {divider && <p className="log__day">── {day} ──</p>}
            <p className="log__line">
              <time className="log__time" dateTime={e.createdAt}>
                {logTime(e.createdAt)}
              </time>
              <span>
                <span className="log__actor">{e.actorName ?? 'System'}</span>
                {describe(e)}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
