import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
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

function ProtectedRoute({ children, gpOnly = false }: { children: React.ReactNode; gpOnly?: boolean }) {
  const { isAuthenticated, isGP } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (gpOnly && !isGP) return <Navigate to="/lp" />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isGP } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          {/* GP Routes */}
          <Route index element={<Navigate to={isGP ? "/dashboard" : "/lp"} />} />
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
      </Routes>
    </BrowserRouter>
  );
}
