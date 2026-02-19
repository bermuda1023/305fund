import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Landing() {
  const { isAuthenticated, isGP, user, logout } = useAuth();
  const navigate = useNavigate();

  const appPath = useMemo(() => (isGP ? '/app/dashboard' : '/app/lp'), [isGP]);

  return (
    <div className="landing-shell">
      <div className="landing-inner">
        <div className="landing-hero">
          <div className="landing-eyebrow">MIAMI'S PREMIER WATERFRONT DESTINATION</div>
          <h1 className="landing-title">Choose Your Path</h1>
        </div>

        <div className="landing-grid">
          <div className="landing-card">
            <div className="landing-icon landing-icon-gp" aria-hidden>
              {/* Simple "portal" icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="landing-card-title">GP / LP Portal</div>
            <div className="landing-card-body">
              Access the operating platform: portfolio, model, accounting actuals, and LP reporting.
            </div>

            <div className="landing-cta-row">
              <Link className="btn btn-primary" to="/login?role=gp">GP Login</Link>
              <Link className="btn btn-secondary" to="/login?role=lp">LP Login</Link>
              {isAuthenticated && (
                <button className="btn btn-gold" onClick={() => navigate(appPath)}>
                  Continue
                </button>
              )}
            </div>

            {isAuthenticated && (
              <div className="landing-signedin">
                Signed in as {user?.email} ({user?.role?.toUpperCase()})
                <button
                  className="landing-signout"
                  type="button"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>

          <div className="landing-card">
            <div className="landing-icon landing-icon-investor" aria-hidden>
              {/* Simple "chart" icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 16l5-5 3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 7v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="landing-card-title">Potential Investors</div>
            <div className="landing-card-body">
              Password-protected data room for the teaser, deck, NDA, and diligence materials.
            </div>

            <div className="landing-cta-row">
              <Link className="btn btn-gold" to="/investor">
                Access Data Room
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

