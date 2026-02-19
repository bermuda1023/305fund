import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
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
        <Route path="/" element={<Landing />} />
        <Route path="/investor" element={<InvestorRoom />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute allowPasswordChangeOnly>
              <ChangePassword />
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
          <Route path="dashboard" element={<ProtectedRoute gpOnly><Dashboard /></ProtectedRoute>} />
          <Route path="portfolio" element={<ProtectedRoute gpOnly><Portfolio /></ProtectedRoute>} />
          <Route path="model" element={<ProtectedRoute gpOnly><Model /></ProtectedRoute>} />
          <Route path="sensitivity" element={<ProtectedRoute gpOnly><Sensitivity /></ProtectedRoute>} />
          <Route path="contracts" element={<ProtectedRoute gpOnly><Contracts /></ProtectedRoute>} />
          <Route path="listings" element={<ProtectedRoute gpOnly><Listings /></ProtectedRoute>} />
          <Route path="market" element={<ProtectedRoute gpOnly><MarketData /></ProtectedRoute>} />
          <Route path="entities" element={<ProtectedRoute gpOnly><Entities /></ProtectedRoute>} />
          <Route path="actuals" element={<ProtectedRoute gpOnly><Actuals /></ProtectedRoute>} />
          <Route path="lp-admin" element={<ProtectedRoute gpOnly><LPPortal adminMode /></ProtectedRoute>} />

          {/* LP Route */}
          <Route path="lp" element={<ProtectedRoute><LPPortal /></ProtectedRoute>} />
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
        <Route path="/lp-admin" element={<Navigate to="/app/lp-admin" replace />} />
        <Route path="/lp" element={<Navigate to="/app/lp" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
