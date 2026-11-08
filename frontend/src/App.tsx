import { Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { NotFound } from './components/NotFound';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/auth/AccountPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { LiveAuctionPage } from './pages/auction-live/LiveAuctionPage';
import { AuctionDetailPage } from './pages/catalog/AuctionDetailPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { MyBidsPage } from './pages/my-bids/MyBidsPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { AuctionFormPage } from './pages/seller/AuctionFormPage';
import { SellerDashboardPage } from './pages/seller/SellerDashboardPage';
import { WalletPage } from './pages/wallet/WalletPage';

// Route table. Public pages first; pages behind <RequireAuth> need a session, and
// <RequireAuth roles={[...]}> also a role (seller pages A-26, wallet A-27 go there).
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<CatalogPage />} />
        <Route path="auctions/:id" element={<AuctionDetailPage />} />
        {/* Public: anyone can watch (decision Q3); the bid form needs a login and the bidder role. */}
        <Route path="auctions/:id/live" element={<LiveAuctionPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route path="account" element={<AccountPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        <Route element={<RequireAuth roles={['BIDDER', 'SELLER']} />}>
          <Route path="wallet" element={<WalletPage />} />
          <Route path="my-bids" element={<MyBidsPage />} />
        </Route>

        <Route element={<RequireAuth roles={['SELLER']} />}>
          <Route path="seller" element={<SellerDashboardPage />} />
          <Route path="seller/auctions/new" element={<AuctionFormPage />} />
          <Route path="seller/auctions/:id/edit" element={<AuctionFormPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
