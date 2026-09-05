import { Route, Routes } from 'react-router-dom';
import Booking from './pages/Booking';
import My from './pages/My';
import Admin from './pages/Admin';

export default function App() {
  return (
    <Routes>
      <Route path="/booking" element={<Booking />} />
      <Route path="/my" element={<My />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={<div className="page-center">Откройте эту страницу из бота.</div>} />
    </Routes>
  );
}
