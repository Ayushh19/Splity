import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { balanceTone, initials } from '../lib/format';
import { TypedLine } from './TypedLine';

export function TopBar({ title, back, end }: { title?: ReactNode; back?: string; end?: ReactNode }) {
  return (
    <header className="top-bar">
      {back && (
        <Link to={back} className="icon-button" aria-label="Back">
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
      )}
      <h1 className="h1 top-bar__title">{title}</h1>
      {end}
    </header>
  );
}

export function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null | undefined }) {
  return (
    <span className="avatar" aria-hidden="true">
      {photoUrl ? <img src={photoUrl} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export function Money({ netMinor, children }: { netMinor: number; children: ReactNode }) {
  return <span className={`amount money--${balanceTone(netMinor)}`}>{children}</span>;
}

export function Badge({ children, tone, led }: { children: ReactNode; tone?: 'beige' | 'amber'; led?: 'green' | 'amber' }) {
  return (
    <span className={`badge${tone ? ` badge--${tone}` : ''}`}>
      {led && <span className={`led led--${led}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Toggle(props: { label: ReactNode; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className="toggle"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="toggle__label">{props.label}</span>
      <span className={`led ${props.checked ? 'led--green' : ''}`} aria-hidden="true" />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className={`toggle__state ${props.checked ? 'glow-green' : 'text-muted'}`} aria-hidden="true">
        {props.checked ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

export function EmptyState(props: { icon: LucideIcon; line: string; text: string; action?: ReactNode }) {
  const Icon = props.icon;
  return (
    <div className="empty">
      <div className="empty__frame" aria-hidden="true">
        <Icon size={40} />
      </div>
      <TypedLine text={props.line} className="label glow-green" />
      <p className="empty__text">{props.text}</p>
      {props.action}
    </div>
  );
}

/** Bottom sheet with backdrop; closes on backdrop tap and Escape. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <div className="sheet__handle" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}

// ── Toasts ─────────────────────────────────────────────────────

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((text: string, tone: Toast['tone'] = 'ok') => setToast({ id: Date.now(), text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">
        {toast && (
          <p key={toast.id} className={`toast${toast.tone === 'error' ? ' toast--error' : ''}`} role="status">
            {toast.text}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Share via the OS share sheet when available, otherwise copy to the clipboard. */
export function useShareLink() {
  const toast = useToast();
  return async (url: string, title: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Join "${title}" on Splity`, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch {
      toast("Couldn't copy the link. Long-press it to copy.", 'error');
    }
  };
}
