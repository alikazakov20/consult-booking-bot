import { useEffect, useState } from 'react';
import { api } from '../api';
import { getTelegramWebApp } from '../telegram';

interface BookingItem {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  serviceTypeName: string | null;
}

export default function My() {
  const [bookings, setBookings] = useState<BookingItem[] | null>(null);
  const tg = getTelegramWebApp();

  async function load() {
    const res = await api.myBookings();
    setBookings(res.bookings);
  }

  useEffect(() => {
    load();
  }, []);

  async function cancel(id: number) {
    tg?.showConfirm('Отменить эту запись?', async (ok) => {
      if (!ok) return;
      await api.cancelMyBooking(id);
      load();
    });
  }

  if (bookings === null) return <div className="page-center">Загрузка…</div>;

  return (
    <div className="screen">
      <h1>Мои записи</h1>
      {bookings.length === 0 ? (
        <div className="empty">Активных записей нет</div>
      ) : (
        bookings.map((b) => (
          <div className="card" key={b.id}>
            <div className="row"><span>Дата</span><b>{formatDate(b.date)}</b></div>
            <div className="row"><span>Время</span><b>{formatMin(b.startMin)}–{formatMin(b.endMin)}</b></div>
            {b.serviceTypeName && <div className="row"><span>Услуга</span><b>{b.serviceTypeName}</b></div>}
            <button className="button-secondary" onClick={() => cancel(b.id)}>Отменить запись</button>
          </div>
        ))
      )}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function formatMin(min: number) {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
