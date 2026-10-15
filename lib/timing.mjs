const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock parts of an instant in a timezone. */
export function zoned(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, m: +parts.month, d: +parts.day, hour: +parts.hour, minute: +parts.minute, weekday: parts.weekday, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

/** The UTC instant for a wall-clock time in a timezone (two passes settle DST edges). */
export function fromZoned(y, m, d, hour, minute, tz) {
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i += 1) {
    const z = zoned(new Date(guess), tz);
    guess += Date.UTC(y, m - 1, d, hour, minute) - Date.UTC(z.y, z.m - 1, z.d, z.hour, z.minute);
  }
  return new Date(guess);
}

/** Parses "Tue 12:00" / "12:00" (every day) / "2026-10-20 18:30" in the configured timezone. */
export function parseWhen(text, tz, now = new Date()) {
  const abs = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (abs) return fromZoned(+abs[1], +abs[2], +abs[3], +abs[4], +abs[5], tz);
  return nextOccurrences([text], tz, now, 1)[0];
}

export function nextOccurrences(slots, tz, after = new Date(), days = 14) {
  const out = [];
  const base = zoned(after, tz);
  for (let i = 0; i <= days; i += 1) {
    const day = new Date(Date.UTC(base.y, base.m - 1, base.d + i, 12));
    const weekday = DAYS[day.getUTCDay()];
    for (const slot of slots) {
      const m = slot.match(/^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+)?(\d{1,2}):(\d{2})$/);
      if (!m || (m[1] && m[1] !== weekday)) continue;
      const at = fromZoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), +m[2], +m[3], tz);
      if (at > after) out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Earliest slot that respects the daily cap and minimum gap against posted and already-scheduled items. */
export function nextSlot({ slots, tz, dailyCap, minGapHours, taken, after = new Date() }) {
  for (const at of nextOccurrences(slots, tz, after)) {
    const sameDay = taken.filter((t) => zoned(t, tz).dateKey === zoned(at, tz).dateKey).length;
    const tooClose = taken.some((t) => Math.abs(t - at) < minGapHours * 36e5);
    if (sameDay < dailyCap && !tooClose) return at;
  }
  return undefined;
}

/** Slots from the playbook if it has earned them, else from follower-online peaks, else your starter slots. */
export function chooseSlots(playbook, config) {
  if (playbook?.slots?.length) return { slots: playbook.slots, source: `learned from ${playbook.n} posts` };
  if (playbook?.online_peaks?.length) return { slots: playbook.online_peaks, source: 'when your followers are online' };
  return { slots: config.starter_slots, source: 'starter slots (replace once you have data)' };
}

export const weekdayOf = (date, tz) => zoned(date, tz).weekday;
export const hourOf = (date, tz) => zoned(date, tz).hour;
