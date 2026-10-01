import { useEffect, useState } from 'react';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A terminal line typed out once, ending in a blinking block cursor (DESIGN.md › Command-line text). */
export function TypedLine({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) clearInterval(timer);
        return Math.min(n + 1, text.length);
      });
    }, 35);
    return () => clearInterval(timer);
  }, [text]);

  return (
    <p className={className} aria-label={text}>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        <span className="cursor" />
      </span>
    </p>
  );
}
