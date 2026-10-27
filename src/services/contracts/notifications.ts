import type { AppNotification, NotificationPrefs, Reminder } from '@/types';

export interface ReminderInput { id?: string; title: string; at: string; jobId?: string; kind?: Reminder['kind'] }
export interface ReminderRow { reminder: Reminder; jobTitle?: string; companyName?: string }

export interface NotificationService {
  list(): Promise<AppNotification[]>;
  markRead(id: string): Promise<AppNotification>;
  markAllRead(): Promise<{ ok: boolean }>;
  getPrefs(): Promise<NotificationPrefs>;
  setPrefs(p: NotificationPrefs): Promise<NotificationPrefs>;
}
export interface ReminderService {
  list(): Promise<ReminderRow[]>;
  save(input: ReminderInput): Promise<Reminder>;
  toggle(id: string): Promise<Reminder>;
  remove(id: string): Promise<{ ok: boolean }>;
}
