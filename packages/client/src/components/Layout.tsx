import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';

const gpLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/portfolio', label: 'Portfolio', icon: '◫' },
  { to: '/model', label: 'Model', icon: '◈' },
  { to: '/sensitivity', label: 'Sensitivity', icon: '◍' },
  { to: '/contracts', label: 'Voting Consensus', icon: '◪' },
  { to: '/listings', label: 'Units for Sale', icon: '◧' },
  { to: '/market', label: 'Market Data', icon: '◬' },
  { to: '/entities', label: 'Entities', icon: '◇' },
  { to: '/actuals', label: 'Actuals', icon: '◈' },
  { to: '/lp-admin', label: 'LP Admin', icon: '◎' },
];

const lpLinks = [
  { to: '/lp', label: 'My Portal', icon: '◉' },
];

export default function Layout() {
  const { user, logout, isGP } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  // Auto-collapse on small screens unless user already chose.
  useEffect(() => {
    try {
      const hasPref = localStorage.getItem('sidebar_collapsed') !== null;
      if (hasPref) return;
      if (window.innerWidth < 900) setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const links = useMemo(() => (isGP ? gpLinks : lpLinks), [isGP]);

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div className="sidebar-brand">
              <h1>305 opportunites fund</h1>
              <span>control equity platform</span>
            </div>
            <button
              className="sidebar-toggle"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>
        </div>

        <nav className="sidebar-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => isActive ? 'active' : ''}
              title={collapsed ? link.label : undefined}
            >
              <span>{link.icon}</span>
              <span className="sidebar-label">{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.5rem' }}>
            {user?.name} ({user?.role?.toUpperCase()})
          </div>
          <button onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
