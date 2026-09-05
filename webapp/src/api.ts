import { getInitData } from './telegram';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? 'request_failed');
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export const api = {
  bookingInit: (token: string) => request<{ serviceType: { name: string; durationMin: number } | null; horizonDays: number; note: string | null }>(`/booking/init?token=${encodeURIComponent(token)}`),
  bookingDays: (token: string) => request<{ days: { date: string; hasSlots: boolean }[] }>(`/booking/days?token=${encodeURIComponent(token)}`),
  bookingSlots: (token: string, date: string) => request<{ slots: { startMin: number; label: string }[] }>(`/booking/slots?token=${encodeURIComponent(token)}&date=${date}`),
  bookingConfirm: (token: string, date: string, startMin: number) =>
    request<{ booking: { id: number; date: string; startMin: number; endMin: number; serviceTypeName: string | null } }>('/booking/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, date, startMin }),
    }),
  myBookings: () => request<{ bookings: { id: number; date: string; startMin: number; endMin: number; serviceTypeName: string | null }[] }>('/booking/my'),
  cancelMyBooking: (id: number) => request<{ ok: true }>(`/booking/my/${id}/cancel`, { method: 'POST' }),

  adminSchedule: () =>
    request<{
      settings: { slotMinutes: number; bufferMinutes: number; timezone: string; bookingHorizonDays: number };
      workingHours: { weekday: number; startMin: number; endMin: number; isActive: boolean }[];
    }>('/admin/schedule'),
  adminSaveSchedule: (body: unknown) => request<{ ok: true }>('/admin/schedule', { method: 'PUT', body: JSON.stringify(body) }),

  adminExceptions: () =>
    request<{ exceptions: { id: number; date: string; isClosed: boolean; startMin: number | null; endMin: number | null; note: string | null }[] }>('/admin/exceptions'),
  adminAddException: (body: unknown) => request<{ id: number }>('/admin/exceptions', { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteException: (id: number) => request<{ ok: true }>(`/admin/exceptions/${id}`, { method: 'DELETE' }),

  adminBookings: (status?: string) => request<{ bookings: { id: number; date: string; startMin: number; endMin: number; status: string; serviceTypeName: string | null; client: { firstName: string | null; lastName: string | null; username: string | null } }[] }>(`/admin/bookings${status ? `?status=${status}` : ''}`),
  adminCancelBooking: (id: number) => request<{ ok: true }>(`/admin/bookings/${id}/cancel`, { method: 'POST' }),

  adminServiceTypes: () => request<{ serviceTypes: { id: number; name: string; durationMin: number; isActive: boolean }[] }>('/admin/service-types'),
  adminCreateServiceType: (body: unknown) => request<{ serviceType: unknown }>('/admin/service-types', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateServiceType: (id: number, body: unknown) => request<{ serviceType: unknown }>(`/admin/service-types/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  adminLinks: (status?: string) => request<{ links: { id: number; token: string; deepLink: string; status: string; note: string | null; serviceTypeName: string | null; createdAt: string; expiresAt: string | null; usedAt: string | null }[] }>(`/admin/links${status ? `?status=${status}` : ''}`),
  adminCreateLink: (body: unknown) => request<{ id: number; token: string; deepLink: string }>('/admin/links', { method: 'POST', body: JSON.stringify(body) }),
  adminRevokeLink: (id: number) => request<{ ok: true }>(`/admin/links/${id}/revoke`, { method: 'POST' }),
};
