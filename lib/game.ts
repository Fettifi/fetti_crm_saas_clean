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

// Streak: consecutive days up to today (1-day grace) from a set of YYYY-MM-DD.
export function streakFrom(days: Set<string>): number {
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayStr(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(dayStr(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return streak;
}
