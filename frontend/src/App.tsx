import { Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { NotFound } from './components/NotFound';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/auth/AccountPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { AuctionDetailPage } from './pages/catalog/AuctionDetailPage';
import { CatalogPage } from './pages/catalog/CatalogPage';

// Route table. Public pages first; pages behind <RequireAuth> need a session, and
// <RequireAuth roles={[...]}> also a role (seller pages A-26, wallet A-27 go there).
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<CatalogPage />} />
        <Route path="auctions/:id" element={<AuctionDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route path="account" element={<AccountPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
