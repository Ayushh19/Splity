import { Activity, House, Plus, User, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

/** Main tabs with the bottom tab bar (DESIGN.md › Bottom tab bar, The (+) key). */
export function AppShell() {
  return (
    <>
      <Outlet />
      <nav className="tab-bar" aria-label="Main">
        <div className="tab-bar__inner">
          <NavLink to="/" end className="tab">
            <House size={22} aria-hidden="true" />
            Home
          </NavLink>
          <NavLink to="/friends" className="tab">
            <Users size={22} aria-hidden="true" />
            Friends
          </NavLink>
          <NavLink to="/add" className="tab__plus" aria-label="Add expense">
            <Plus size={28} strokeWidth={2.5} aria-hidden="true" />
          </NavLink>
          <NavLink to="/activity" className="tab">
            <Activity size={22} aria-hidden="true" />
            Activity
          </NavLink>
          <NavLink to="/account" className="tab">
            <User size={22} aria-hidden="true" />
            Account
          </NavLink>
        </div>
      </nav>
    </>
  );
}
