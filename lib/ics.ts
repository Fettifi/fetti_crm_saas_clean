// Minimal iCalendar (.ics) builder — no dependencies. Produces a VCALENDAR that
// any calendar app (Google, Apple, Outlook) can subscribe to or import.

const esc = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

export type ICSEvent = {
  uid: string;
  title: string;
  start: Date;
  end?: Date;
  description?: string;
  reminderMinutes?: number; // minutes before to alert
};

export function buildICS(events: ICSEvent[], calName = "Fetti Quest Log"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fetti Financial//Quest Log//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
    "X-PUBLISHED-TTL:PT30M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
  ];
  for (const e of events) {
    const end = e.end || new Date(e.start.getTime() + 30 * 60000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp(new Date())}`);
    lines.push(`DTSTART:${stamp(e.start)}`);
    lines.push(`DTEND:${stamp(end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.reminderMinutes && e.reminderMinutes > 0) {
      lines.push("BEGIN:VALARM", `TRIGGER:-PT${Math.round(e.reminderMinutes)}M`, "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
