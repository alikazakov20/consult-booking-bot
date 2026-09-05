import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { minutesToTime, timeToMinutes, WEEKDAY_NAMES } from '../time';

type Tab = 'schedule' | 'exceptions' | 'bookings' | 'services' | 'links';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('schedule');
  const [access, setAccess] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    api
      .adminSchedule()
      .then(() => setAccess('ok'))
      .catch((e) => setAccess(e instanceof ApiError && (e.status === 401 || e.status === 403) ? 'denied' : 'ok'));
  }, []);

  if (access === 'checking') return <div className="page-center">Загрузка…</div>;
  if (access === 'denied') return <div className="page-center">Доступ к админке только у владельца бота.</div>;

  return (
    <div className="screen">
      <h1>Админка</h1>
      <div className="tabs">
        {(
          [
            ['schedule', 'Расписание'],
            ['exceptions', 'Исключения'],
            ['bookings', 'Записи'],
            ['services', 'Услуги'],
            ['links', 'Ссылки'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'exceptions' && <ExceptionsTab />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'links' && <LinksTab />}
    </div>
  );
}

function ScheduleTab() {
  const [settings, setSettings] = useState({ slotMinutes: 60, bufferMinutes: 0, timezone: 'Europe/Moscow', bookingHorizonDays: 30 });
  const [hours, setHours] = useState<{ weekday: number; startMin: number; endMin: number; isActive: boolean }[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminSchedule().then((res) => {
      setSettings(res.settings);
      setHours(res.workingHours.length ? res.workingHours : defaultHours());
      setLoading(false);
    });
  }, []);

  function updateDay(weekday: number, patch: Partial<{ startMin: number; endMin: number; isActive: boolean }>) {
    setHours((prev) => prev.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)));
  }

  async function save() {
    await api.adminSaveSchedule({ settings, workingHours: hours });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="page-center">Загрузка…</div>;

  return (
    <div>
      <div className="card">
        <h2>Параметры записи</h2>
        <div className="field">
          <label>Длительность консультации (мин)</label>
          <input
            type="number"
            value={settings.slotMinutes}
            onChange={(e) => setSettings({ ...settings, slotMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Перерыв между записями (мин)</label>
          <input
            type="number"
            value={settings.bufferMinutes}
            onChange={(e) => setSettings({ ...settings, bufferMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Часовой пояс (например Europe/Moscow)</label>
          <input value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
        </div>
        <div className="field">
          <label>На сколько дней вперёд можно записаться</label>
          <input
            type="number"
            value={settings.bookingHorizonDays}
            onChange={(e) => setSettings({ ...settings, bookingHorizonDays: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="card">
        <h2>Рабочие дни и часы</h2>
        {hours
          .slice()
          .sort((a, b) => a.weekday - b.weekday)
          .map((h) => (
            <div className="weekday-row" key={h.weekday}>
              <span>{WEEKDAY_NAMES[h.weekday].slice(0, 3)}</span>
              <input
                type="time"
                disabled={!h.isActive}
                value={minutesToTime(h.startMin)}
                onChange={(e) => updateDay(h.weekday, { startMin: timeToMinutes(e.target.value) })}
              />
              <input
                type="time"
                disabled={!h.isActive}
                value={minutesToTime(h.endMin)}
                onChange={(e) => updateDay(h.weekday, { endMin: timeToMinutes(e.target.value) })}
              />
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={h.isActive}
                onChange={(e) => updateDay(h.weekday, { isActive: e.target.checked })}
              />
            </div>
          ))}
      </div>

      <button className="button-primary" onClick={save}>
        {saved ? 'Сохранено ✓' : 'Сохранить'}
      </button>
    </div>
  );
}

function defaultHours() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    startMin: 9 * 60,
    endMin: 18 * 60,
    isActive: weekday >= 1 && weekday <= 5,
  }));
}

function ExceptionsTab() {
  const [list, setList] = useState<{ id: number; date: string; isClosed: boolean; startMin: number | null; endMin: number | null; note: string | null }[]>([]);
  const [date, setDate] = useState('');
  const [isClosed, setIsClosed] = useState(true);
  const [startMin, setStartMin] = useState('09:00');
  const [endMin, setEndMin] = useState('18:00');
  const [note, setNote] = useState('');

  async function load() {
    const res = await api.adminExceptions();
    setList(res.exceptions);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!date) return;
    await api.adminAddException({
      date,
      isClosed,
      startMin: isClosed ? null : timeToMinutes(startMin),
      endMin: isClosed ? null : timeToMinutes(endMin),
      note: note || null,
    });
    setDate('');
    setNote('');
    load();
  }

  async function remove(id: number) {
    await api.adminDeleteException(id);
    load();
  }

  return (
    <div>
      <div className="card">
        <h2>Добавить исключение</h2>
        <div className="field">
          <label>Дата</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <input type="checkbox" style={{ width: 'auto' }} checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} /> Выходной (закрыт полностью)
          </label>
        </div>
        {!isClosed && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Начало</label>
              <input type="time" value={startMin} onChange={(e) => setStartMin(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Конец</label>
              <input type="time" value={endMin} onChange={(e) => setEndMin(e.target.value)} />
            </div>
          </div>
        )}
        <div className="field">
          <label>Заметка (необязательно)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: отпуск" />
        </div>
        <button className="button-primary" onClick={add}>Добавить</button>
      </div>

      {list.length === 0 ? (
        <div className="empty">Исключений нет</div>
      ) : (
        list.map((e) => (
          <div className="card" key={e.id}>
            <div className="row">
              <span>{new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
              <button className="icon-btn" onClick={() => remove(e.id)}>✕</button>
            </div>
            <div className="row">
              <span>{e.isClosed ? 'Выходной' : `${minutesToTime(e.startMin ?? 0)}–${minutesToTime(e.endMin ?? 0)}`}</span>
            </div>
            {e.note && <div className="hint">{e.note}</div>}
          </div>
        ))
      )}
    </div>
  );
}

function BookingsTab() {
  const [status, setStatus] = useState<'confirmed' | 'cancelled'>('confirmed');
  const [list, setList] = useState<{ id: number; date: string; startMin: number; endMin: number; status: string; serviceTypeName: string | null; client: { firstName: string | null; lastName: string | null; username: string | null } }[]>([]);

  async function load() {
    const res = await api.adminBookings(status);
    setList(res.bookings);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function cancel(id: number) {
    await api.adminCancelBooking(id);
    load();
  }

  return (
    <div>
      <div className="tabs">
        <button className={`tab${status === 'confirmed' ? ' active' : ''}`} onClick={() => setStatus('confirmed')}>Активные</button>
        <button className={`tab${status === 'cancelled' ? ' active' : ''}`} onClick={() => setStatus('cancelled')}>Отменённые</button>
      </div>
      {list.length === 0 ? (
        <div className="empty">Записей нет</div>
      ) : (
        list.map((b) => (
          <div className="card" key={b.id}>
            <div className="row"><span>Клиент</span><b>{[b.client.firstName, b.client.lastName].filter(Boolean).join(' ') || '—'} {b.client.username ? `(@${b.client.username})` : ''}</b></div>
            <div className="row"><span>Дата</span><b>{new Date(b.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b></div>
            <div className="row"><span>Время</span><b>{minutesToTime(b.startMin)}–{minutesToTime(b.endMin)}</b></div>
            {b.serviceTypeName && <div className="row"><span>Услуга</span><b>{b.serviceTypeName}</b></div>}
            {status === 'confirmed' && <button className="button-secondary" onClick={() => cancel(b.id)}>Отменить</button>}
          </div>
        ))
      )}
    </div>
  );
}

function ServicesTab() {
  const [list, setList] = useState<{ id: number; name: string; durationMin: number; isActive: boolean }[]>([]);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);

  async function load() {
    const res = await api.adminServiceTypes();
    setList(res.serviceTypes);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!name) return;
    await api.adminCreateServiceType({ name, durationMin: duration });
    setName('');
    load();
  }

  async function toggle(id: number, isActive: boolean) {
    await api.adminUpdateServiceType(id, { isActive: !isActive });
    load();
  }

  return (
    <div>
      <div className="card">
        <h2>Новая услуга</h2>
        <div className="field">
          <label>Название</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Консультация" />
        </div>
        <div className="field">
          <label>Длительность (мин)</label>
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <button className="button-primary" onClick={add}>Добавить</button>
      </div>
      {list.map((s) => (
        <div className="card" key={s.id}>
          <div className="row"><span>{s.name}</span><span className="badge">{s.durationMin} мин</span></div>
          <button className="button-secondary" style={{ color: s.isActive ? '#d33' : '#2481cc' }} onClick={() => toggle(s.id, s.isActive)}>
            {s.isActive ? 'Скрыть' : 'Включить'}
          </button>
        </div>
      ))}
    </div>
  );
}

function LinksTab() {
  const [list, setList] = useState<{ id: number; token: string; deepLink: string; status: string; note: string | null; serviceTypeName: string | null; expiresAt: string | null }[]>([]);
  const [serviceTypes, setServiceTypes] = useState<{ id: number; name: string; isActive: boolean }[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [lastLink, setLastLink] = useState<string | null>(null);

  async function load() {
    const [linksRes, servicesRes] = await Promise.all([api.adminLinks(), api.adminServiceTypes()]);
    setList(linksRes.links);
    setServiceTypes(servicesRes.serviceTypes.filter((s) => s.isActive));
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    const res = await api.adminCreateLink({
      serviceTypeId: serviceTypeId || null,
      note: note || null,
      expiresInDays: expiresInDays ? Number(expiresInDays) : null,
    });
    setLastLink(res.deepLink);
    setNote('');
    load();
  }

  async function revoke(id: number) {
    await api.adminRevokeLink(id);
    load();
  }

  function copy(link: string) {
    navigator.clipboard?.writeText(link).catch(() => null);
  }

  return (
    <div>
      <div className="card">
        <h2>Выдать новую ссылку</h2>
        <div className="field">
          <label>Услуга</label>
          <select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— не указано —</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Заметка (имя клиента и т.п.)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field">
          <label>Срок действия, дней (необязательно)</label>
          <input type="number" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </div>
        <button className="button-primary" onClick={create}>Создать ссылку</button>
        {lastLink && (
          <div className="card" style={{ marginTop: 12, wordBreak: 'break-all' }}>
            {lastLink}
            <button className="button-secondary" style={{ color: '#2481cc' }} onClick={() => copy(lastLink)}>Скопировать</button>
          </div>
        )}
      </div>

      {list.map((l) => (
        <div className="card" key={l.id}>
          <div className="row"><span className="badge">{statusLabel(l.status)}</span>{l.serviceTypeName && <span>{l.serviceTypeName}</span>}</div>
          {l.note && <div className="hint">{l.note}</div>}
          <div style={{ wordBreak: 'break-all', fontSize: 13, margin: '6px 0' }}>{l.deepLink}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button-secondary" style={{ color: '#2481cc' }} onClick={() => copy(l.deepLink)}>Скопировать</button>
            {l.status === 'active' && (
              <button className="button-secondary" onClick={() => revoke(l.id)}>Отозвать</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'Активна';
    case 'used':
      return 'Использована';
    case 'revoked':
      return 'Отозвана';
    default:
      return status;
  }
}
