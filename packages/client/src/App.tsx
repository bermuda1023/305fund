import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import PublicSign from './pages/PublicSign';
import InvestorGate from './pages/InvestorGate';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Model from './pages/Model';
import Sensitivity from './pages/Sensitivity';
import Contracts from './pages/Contracts';
import Listings from './pages/Listings';
import MarketData from './pages/MarketData';
import LPPortal from './pages/LPPortal';
import Entities from './pages/Entities';
import Actuals from './pages/Actuals';
import Landing from './pages/Landing';
import InvestorRoom from './pages/InvestorRoom';
import AccountantExports from './pages/AccountantExports';
import RouteErrorBoundary from './components/RouteErrorBoundary';

function Safe({ children }: { children: React.ReactNode }) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>;
}

function ProtectedRoute({
  children,
  gpOnly = false,
  allowPasswordChangeOnly = false,
}: {
  children: React.ReactNode;
  gpOnly?: boolean;
  allowPasswordChangeOnly?: boolean;
}) {
  const { isAuthenticated, isGP, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (user?.mustChangePassword && !allowPasswordChangeOnly) return <Navigate to="/change-password" />;
  if (!user?.mustChangePassword && allowPasswordChangeOnly) return <Navigate to={isGP ? "/app/dashboard" : "/app/lp"} />;
  if (gpOnly && !isGP) return <Navigate to="/app/lp" />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isGP } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Safe><Landing /></Safe>} />
        <Route path="/investor" element={<Safe><InvestorRoom /></Safe>} />
        <Route path="/login" element={<Safe><Login /></Safe>} />
        <Route path="/forgot-password" element={<Safe><ForgotPassword /></Safe>} />
        <Route path="/reset-password" element={<Safe><ResetPassword /></Safe>} />
        <Route path="/sign/:token" element={<Safe><PublicSign /></Safe>} />
        <Route path="/investor-gate" element={<Safe><InvestorGate /></Safe>} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute allowPasswordChangeOnly>
              <Safe><ChangePassword /></Safe>
            </ProtectedRoute>
          }
        />

        <Route path="/app" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          {/* GP Routes */}
          <Route index element={<Navigate to={isGP ? "/app/dashboard" : "/app/lp"} />} />
          <Route path="dashboard" element={<ProtectedRoute gpOnly><Safe><Dashboard /></Safe></ProtectedRoute>} />
          <Route path="portfolio" element={<ProtectedRoute gpOnly><Safe><Portfolio /></Safe></ProtectedRoute>} />
          <Route path="model" element={<ProtectedRoute gpOnly><Safe><Model /></Safe></ProtectedRoute>} />
          <Route path="sensitivity" element={<ProtectedRoute gpOnly><Safe><Sensitivity /></Safe></ProtectedRoute>} />
          <Route path="contracts" element={<ProtectedRoute gpOnly><Safe><Contracts /></Safe></ProtectedRoute>} />
          <Route path="listings" element={<ProtectedRoute gpOnly><Safe><Listings /></Safe></ProtectedRoute>} />
          <Route path="market" element={<ProtectedRoute gpOnly><Safe><MarketData /></Safe></ProtectedRoute>} />
          <Route path="entities" element={<ProtectedRoute gpOnly><Safe><Entities /></Safe></ProtectedRoute>} />
          <Route path="actuals" element={<ProtectedRoute gpOnly><Safe><Actuals /></Safe></ProtectedRoute>} />
          <Route path="exports" element={<ProtectedRoute gpOnly><Safe><AccountantExports /></Safe></ProtectedRoute>} />
          <Route path="lp-admin" element={<ProtectedRoute gpOnly><Safe><LPPortal adminMode /></Safe></ProtectedRoute>} />

          {/* LP Route */}
          <Route path="lp" element={<ProtectedRoute><Safe><LPPortal /></Safe></ProtectedRoute>} />
        </Route>

        {/* Legacy route compatibility */}
        <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="/portfolio" element={<Navigate to="/app/portfolio" replace />} />
        <Route path="/model" element={<Navigate to="/app/model" replace />} />
        <Route path="/sensitivity" element={<Navigate to="/app/sensitivity" replace />} />
        <Route path="/contracts" element={<Navigate to="/app/contracts" replace />} />
        <Route path="/listings" element={<Navigate to="/app/listings" replace />} />
        <Route path="/market" element={<Navigate to="/app/market" replace />} />
        <Route path="/entities" element={<Navigate to="/app/entities" replace />} />
        <Route path="/actuals" element={<Navigate to="/app/actuals" replace />} />
        <Route path="/exports" element={<Navigate to="/app/exports" replace />} />
        <Route path="/lp-admin" element={<Navigate to="/app/lp-admin" replace />} />
        <Route path="/lp" element={<Navigate to="/app/lp" replace />} />
        <Route path="*" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>404</h2><p>Page not found.</p></div>} />
      </Routes>
    </BrowserRouter>
  );
}
