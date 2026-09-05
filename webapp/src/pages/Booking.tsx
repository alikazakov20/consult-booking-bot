import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { getTelegramWebApp } from '../telegram';

const WEEKDAY_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

type Step = 'loading' | 'invalid' | 'calendar' | 'slots' | 'confirm' | 'done';

export default function Booking() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [step, setStep] = useState<Step>('loading');
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [days, setDays] = useState<{ date: string; hasSlots: boolean }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ startMin: number; label: string }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ startMin: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStep('invalid');
      return;
    }
    (async () => {
      try {
        const init = await api.bookingInit(token);
        setServiceName(init.serviceType?.name ?? null);
        const daysRes = await api.bookingDays(token);
        setDays(daysRes.days);
        setStep('calendar');
      } catch {
        setStep('invalid');
      }
    })();
  }, [token]);

  const tg = getTelegramWebApp();

  useEffect(() => {
    if (!tg) return;
    const handler = () => confirmBooking();
    if (step === 'confirm') {
      tg.MainButton.setText('Подтвердить запись');
      tg.MainButton.show();
      tg.MainButton.onClick(handler);
    } else if (step === 'done') {
      tg.MainButton.setText('Закрыть');
      tg.MainButton.show();
      tg.MainButton.onClick(() => tg.close());
    } else {
      tg.MainButton.hide();
    }
    return () => {
      tg.MainButton.offClick(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedDate, selectedSlot]);

  async function selectDate(date: string) {
    setSelectedDate(date);
    setSlots([]);
    setSelectedSlot(null);
    const res = await api.bookingSlots(token, date);
    setSlots(res.slots);
    setStep('slots');
  }

  function selectSlot(slot: { startMin: number; label: string }) {
    setSelectedSlot(slot);
    setStep('confirm');
  }

  async function confirmBooking() {
    const date = selectedDate;
    const slot = selectedSlot;
    if (!date || !slot) return;
    try {
      tg?.MainButton.showProgress(true);
      await api.bookingConfirm(token, date, slot.startMin);
      tg?.HapticFeedback?.notificationOccurred('success');
      setStep('done');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error';
      if (code === 'slot_unavailable') {
        setError('Это время уже заняли. Выберите другое.');
        setStep('slots');
        selectDate(date);
      } else {
        setError('Не удалось создать запись. Попробуйте ещё раз.');
      }
    } finally {
      tg?.MainButton.hideProgress();
    }
  }

  if (step === 'loading') return <div className="page-center">Загрузка…</div>;
  if (step === 'invalid') {
    return <div className="page-center">Ссылка недействительна или уже использована. Обратитесь к администратору.</div>;
  }

  return (
    <div className="screen">
      <h1>Запись на консультацию</h1>
      {serviceName && <p className="hint">{serviceName}</p>}
      {error && <div className="card" style={{ color: '#d33' }}>{error}</div>}

      {(step === 'calendar' || step === 'slots' || step === 'confirm' || step === 'done') && (
        <>
          <h2>Выберите дату</h2>
          <div className="grid-days">
            {days.map((d) => {
              const label = new Date(d.date).getDate();
              const weekday = WEEKDAY_LABELS[new Date(d.date).getDay()];
              return (
                <button
                  key={d.date}
                  className={`day-btn${selectedDate === d.date ? ' selected' : ''}`}
                  disabled={!d.hasSlots}
                  onClick={() => selectDate(d.date)}
                >
                  <div>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{weekday}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {(step === 'slots' || step === 'confirm' || step === 'done') && selectedDate && (
        <>
          <h2>Выберите время</h2>
          {slots.length === 0 ? (
            <div className="empty">Нет свободного времени на эту дату</div>
          ) : (
            <div className="grid-slots">
              {slots.map((s) => (
                <button
                  key={s.startMin}
                  className={`slot-btn${selectedSlot?.startMin === s.startMin ? ' selected' : ''}`}
                  onClick={() => selectSlot(s)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'confirm' && selectedSlot && (
        <div className="card">
          <div className="row"><span>Дата</span><b>{formatDate(selectedDate!)}</b></div>
          <div className="row"><span>Время</span><b>{selectedSlot.label}</b></div>
          {serviceName && <div className="row"><span>Услуга</span><b>{serviceName}</b></div>}
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>Нажмите кнопку внизу, чтобы подтвердить.</p>
        </div>
      )}

      {step === 'done' && (
        <div className="card">
          ✅ Запись подтверждена! Ждём вас {formatDate(selectedDate!)} в {selectedSlot?.label}.
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
