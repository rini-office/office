/**
 * Minimal cron expression parser — calculates the next run time.
 * Supports standard 5-field cron: minute hour dayOfMonth month dayOfWeek
 * with wildcard (*), specific values, and step values (/N).
 */

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      const [rangeMin, rangeMax] = range === '*'
        ? [min, max]
        : range.split('-').map(Number);

      for (let i = rangeMin; i <= rangeMax; i += step) {
        values.add(i);
      }
    } else if (part.includes('-')) {
      const [rangeMin, rangeMax] = part.split('-').map(Number);
      for (let i = rangeMin; i <= rangeMax; i++) {
        values.add(i);
      }
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

function dayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getNextCronTime(
  cronExpression: string,
  from: Date = new Date(),
  timezone: string = 'UTC'
): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${cronExpression}". Expected 5 fields, got ${parts.length}.`);
  }

  const fields: CronFields = {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0=Sunday
  };

  // Start from the next minute
  const start = new Date(from);
  start.setMilliseconds(0);
  start.setSeconds(0);
  start.setMinutes(start.getMinutes() + 1);

  const year = start.getFullYear();
  const maxYear = year + 4;

  for (let y = year; y <= maxYear; y++) {
    for (const month of fields.month) {
      const maxDay = dayOfMonth(y, month - 1);

      for (const day of fields.dayOfMonth) {
        if (day > maxDay) continue;

        const date = new Date(y, month - 1, day);

        // Check dayOfWeek (0=Sunday) — match if dayOfWeek field is not just wildcard
        if (parts[4] !== '*') {
          if (!fields.dayOfWeek.includes(date.getDay())) continue;
        }

        for (const hour of fields.hour) {
          for (const minute of fields.minute) {
            const candidate = new Date(y, month - 1, day, hour, minute, 0, 0);

            if (candidate > start) {
              return candidate;
            }
          }
        }
      }
    }
  }

  throw new Error(`No next cron time found within 4 years for "${cronExpression}"`);
}

/**
 * Human-readable description of a cron expression (for common patterns).
 */
export function describeCron(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (hour === '*' && minute === '*') return 'Every minute';
    if (hour === '*' && !minute.includes('*')) return `Every hour at minute ${minute}`;
    if (!hour.includes('*') && !minute.includes('*')) {
      const h = parseInt(hour, 10);
      const m = parseInt(minute, 10);
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `Daily at ${h12}:${m.toString().padStart(2, '0')} ${period}`;
    }
  }

  return cronExpression;
}

/**
 * Check if it's time to run based on the cron expression and last run time.
 * Called by the Vercel Cron endpoint (runs every ~5 min) to decide whether to execute.
 */
export function shouldRunCron(
  cronExpression: string,
  lastRunIso: string | undefined,
  now: Date = new Date()
): boolean {
  if (!lastRunIso) return true; // never run before

  const lastRun = new Date(lastRunIso);
  // Find the most recent cron-matched time on or before now
  const expectedRun = getMostRecentCronTime(cronExpression, now);

  return expectedRun > lastRun;
}

/**
 * Find the most recent cron-matched time on or before the given time.
 */
function getMostRecentCronTime(cronExpression: string, before: Date): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${cronExpression}`);

  const fields: CronFields = {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };

  // Search backward from before, up to 4 years
  const start = new Date(before);
  const minYear = before.getFullYear() - 4;

  for (let y = start.getFullYear(); y >= minYear; y--) {
    const months = [...fields.month].reverse();
    for (const month of months) {
      const maxDay = dayOfMonth(y, month - 1);
      const days = fields.dayOfMonth.filter(d => d <= maxDay).reverse();

      for (const day of days) {
        const date = new Date(y, month - 1, day);

        if (parts[4] !== '*') {
          if (!fields.dayOfWeek.includes(date.getDay())) continue;
        }

        const hours = [...fields.hour].reverse();
        for (const hour of hours) {
          const minutes = [...fields.minute].reverse();
          for (const minute of minutes) {
            const candidate = new Date(y, month - 1, day, hour, minute, 0, 0);

            if (candidate <= start) {
              return candidate;
            }
          }
        }
      }
    }
  }

  return new Date(0); // epoch — will trigger run if no match found
}
