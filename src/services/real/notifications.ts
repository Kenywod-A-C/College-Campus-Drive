import type { AppNotification, NotificationPrefs, Reminder } from '@/types';
import type { NotificationService, ReminderRow, ReminderService } from '../contracts/notifications';
import { http } from '../http';

export const notificationService: NotificationService = {
  list: () => http.get<AppNotification[]>('/notifications'),
  markRead: (id) => http.post<AppNotification>(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => http.post<{ ok: boolean }>('/notifications/read-all'),
  getPrefs: () => http.get<NotificationPrefs>('/notifications/preferences'),
  setPrefs: (p) => http.put<NotificationPrefs>('/notifications/preferences', p),
};

export const reminderService: ReminderService = {
  list: () => http.get<ReminderRow[]>('/reminders'),
  save: ({ id, ...body }) => (id ? http.put<Reminder>(`/reminders/${encodeURIComponent(id)}`, body) : http.post<Reminder>('/reminders', body)),
  toggle: (id) => http.post<Reminder>(`/reminders/${encodeURIComponent(id)}/toggle`),
  remove: (id) => http.delete<{ ok: boolean }>(`/reminders/${encodeURIComponent(id)}`),
};
