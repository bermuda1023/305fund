import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data?.message || 'If that email is registered, a reset link has been sent.');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Unable to request password reset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>Forgot Password</h1>
        <p>Enter your email and we will send you a password reset link.</p>
        {message && <div style={{ color: 'var(--green)', marginBottom: '0.75rem' }}>{message}</div>}
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
        <div style={{ marginTop: '0.75rem' }}>
          <Link to="/login" style={{ color: 'var(--teal)', fontSize: '0.9rem' }}>Back to login</Link>
        </div>
      </div>
    </div>
  );
}
