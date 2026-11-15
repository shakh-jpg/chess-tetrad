import { describe, it, expect } from 'vitest';
import { shouldRemindBackup, hasUserData, REMIND_DAYS } from '../src/ui/backup-reminder.js';

const DAY = 864e5, T = Date.UTC(2026, 10, 15);
const base = { now: T, backupAt: 0, firstRun: T - 20 * DAY, snoozeUntil: 0, cloud: false, hasUserData: true };

describe('backup reminder', () => {
  it('reminds after 14 days without a backup', () => {
    expect(REMIND_DAYS).toBe(14);
    expect(shouldRemindBackup(base)).toBe(true);
    expect(shouldRemindBackup({ ...base, backupAt: T - 13 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, backupAt: T - 14 * DAY })).toBe(true);
  });
  it('does not nag a brand-new user (counts from the first launch)', () => {
    expect(shouldRemindBackup({ ...base, firstRun: T - 2 * DAY })).toBe(false);
  });
  it('is silent when the cloud is connected or there is nothing of the user to save', () => {
    expect(shouldRemindBackup({ ...base, cloud: true })).toBe(false);
    expect(shouldRemindBackup({ ...base, hasUserData: false })).toBe(false);
  });
  it('"Позже" postpones it', () => {
    expect(shouldRemindBackup({ ...base, snoozeUntil: T + DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, snoozeUntil: T - 1 })).toBe(true);
  });
  it('treats an untouched sample book as no user data', () => {
    expect(hasUserData([{ sample: true, items: [{}, {}] }])).toBe(false);
    expect(hasUserData([{ sample: true, items: [{ stat: { n: 1 } }] }])).toBe(true);
    expect(hasUserData([{ items: [] }])).toBe(true);
  });
});
