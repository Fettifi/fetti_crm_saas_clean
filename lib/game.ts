// Shared game math for the Quest Log: XP rewards, leveling curve, ranks.
export const xpFor = (source?: string) => 10 + (source === "brain" ? 5 : 0);

export const RANKS = ["Rookie", "Hustler", "Closer", "Rainmaker", "Mogul", "Legend"];
export const LEVEL_SIZE = 100;

export function levelInfo(xp: number) {
  const level = Math.floor(xp / LEVEL_SIZE) + 1;
  const xpInLevel = xp % LEVEL_SIZE;
  const rank = RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))];
  return { xp, level, xpInLevel, xpToNext: LEVEL_SIZE - xpInLevel, levelSize: LEVEL_SIZE, rank };
}

export const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export const CADENCES = ["daily", "weekly", "monthly", "once"] as const;

// A stable key for the current period of a cadence, used to tell if a recurring
// quest has already been cleared "this day / week / month".
export function periodKey(cadence: string, d: Date): string {
  if (cadence === "daily") return dayStr(d);
  if (cadence === "monthly") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (cadence === "weekly") {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7; // Mon=0
    t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this ISO week
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return "once";
}

export function doneThisPeriod(cadence: string, lastDoneAt?: string | null): boolean {
  if (!lastDoneAt || cadence === "once") return false;
  return periodKey(cadence, new Date(lastDoneAt)) === periodKey(cadence, new Date());
}

// Streak: consecutive days up to today (1-day grace) from a set of YYYY-MM-DD.
export function streakFrom(days: Set<string>): number {
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayStr(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(dayStr(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return streak;
}
