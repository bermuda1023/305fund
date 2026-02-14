import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginRole, setLoginRole] = useState<'gp' | 'lp'>('gp');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password, loginRole);
      navigate(user.role === 'gp' ? '/dashboard' : '/lp');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>305 opportunites fund</h1>
        <p>
          The 305 opportunites fund is an opportunistic, control-equity platform targeting governance
          dislocations in fragmented condominium cap tables. We originate off-benchmark entry points, consolidate
          high-influence ownership blocs, and execute a catalyst-led control-to-liquidity transformation that reprices
          assets from retail condo basis to institutional land-value equivalency. Alpha is driven by complexity arbitrage,
          active value creation, and control-premium monetization, supported by institutional diligence protocols,
          downside-protected underwriting, and tax-efficient exit architecture.
        </p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email or Username</label>
            <input
              className="form-input"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com or admin"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Login As</label>
            <select
              className="form-input"
              value={loginRole}
              onChange={(e) => setLoginRole(e.target.value as 'gp' | 'lp')}
            >
              <option value="gp">GP / Admin</option>
              <option value="lp">LP / Investor</option>
            </select>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
