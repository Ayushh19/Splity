import type { LucideIcon } from 'lucide-react';
import { EmptyState, TopBar } from '../components/ui';

/** Tabs that exist in the navigation but whose features are built later (Friends, Activity, Add). */
export function ComingSoon({ title, icon, line, text }: { title: string; icon: LucideIcon; line: string; text: string }) {
  return (
    <main className="screen screen--with-tabs">
      <TopBar title={title} />
      <EmptyState icon={icon} line={line} text={text} />
    </main>
  );
}
