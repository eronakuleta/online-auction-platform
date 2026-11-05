import { Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { NotFound } from './components/NotFound';
import { CatalogPage } from './pages/catalog/CatalogPage';

// Route table. Role-based guards are added with the auth context in task A-25.
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<CatalogPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
