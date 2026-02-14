import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const gpLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/portfolio', label: 'Portfolio', icon: '◫' },
  { to: '/model', label: 'Model', icon: '◈' },
  { to: '/sensitivity', label: 'Sensitivity', icon: '◍' },
  { to: '/contracts', label: 'Contracts', icon: '◪' },
  { to: '/listings', label: 'Listings', icon: '◧' },
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const links = isGP ? gpLinks : lpLinks;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>Brickell Fund</h1>
          <span>Special Opportunity Fund</span>
        </div>

        <nav className="sidebar-nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => isActive ? 'active' : ''}>
              <span>{link.icon}</span>
              {link.label}
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
