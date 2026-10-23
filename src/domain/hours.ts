import type { SupportHours } from "./types";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The weekday and minute-of-day `now` maps to inside a time zone. */
function zoneClock(
  timeZone: string,
  now: Date,
): { weekday: number; minuteOfDay: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const weekday = WEEKDAY_INDEX[parts.find((part) => part.type === "weekday")?.value ?? ""] ?? -1;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return { weekday, minuteOfDay: hour * 60 + minute };
}

/** Whether the desk is staffed at `now`, judged in the configured zone. */
export function isWithinSupportHours(hours: SupportHours, now: Date = new Date()): boolean {
  const { weekday, minuteOfDay } = zoneClock(hours.timeZone, now);
  return (
    hours.days.includes(weekday) &&
    minuteOfDay >= hours.startMinute &&
    minuteOfDay < hours.endMinute
  );
}

/** "09:00"-style clock label for a minute of day (shared with the form). */
export function clockLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "Monday to Friday" / "every day" / "Tuesday, Thursday, Saturday". */
function daysLabel(days: number[]): string {
  if (days.length === 7) {
    return "every day";
  }
  const sorted = [...days].sort((a, b) => a - b);
  // Rotate only for a run that wraps past Saturday into Sunday (Fri–Sun);
  // ordinary gaps keep calendar order.
  let rotationOffset = 0;
  if ((sorted[sorted.length - 1]! + 1) % 7 === sorted[0]!) {
    for (let index = 0; index < sorted.length; index += 1) {
      const next = sorted[(index + 1) % sorted.length]!;
      const expected = (sorted[index]! + 1) % 7;
      if (next !== expected) {
        rotationOffset = (index + 1) % sorted.length;
        break;
      }
    }
  }
  const rotated = [...sorted.slice(rotationOffset), ...sorted.slice(0, rotationOffset)];
  const runs: string[] = [];
  let runStart = rotated[0]!;
  let previous = rotated[0]!;
  const closeRun = () => {
    runs.push(
      runStart === previous
        ? WEEKDAY_NAMES[runStart]!
        : `${WEEKDAY_NAMES[runStart]!} to ${WEEKDAY_NAMES[previous]!}`,
    );
  };
  for (const day of rotated.slice(1)) {
    if (day === (previous + 1) % 7) {
      previous = day;
      continue;
    }
    closeRun();
    runStart = day;
    previous = day;
  }
  closeRun();
  return runs.join(", ");
}

/** The schedule as a visitor reads it. */
export function scheduleSummary(hours: SupportHours): string {
  return `${daysLabel(hours.days)}, ${clockLabel(hours.startMinute)}–${clockLabel(hours.endMinute)} (${hours.timeZone})`;
}

const HANDOFF_PREFIX =
  "I can't answer that from my approved topics, so I've handed our conversation to the college staff team.";

/**
 * What the bot tells the visitor at handoff (ticket 09). Unconfigured hours
 * promise nothing about response time; configured hours set an accurate
 * expectation — on duty now, or open only at the listed times. Deterministic
 * in `now` so tests can sit exactly on day and zone boundaries.
 */
export function handoffReply(hours: SupportHours | null, now: Date = new Date()): string {
  if (!hours) {
    return `${HANDOFF_PREFIX} A staff member will reply here — please stay in the chat if you can.`;
  }
  if (isWithinSupportHours(hours, now)) {
    const closing = clockLabel(hours.endMinute);
    return `${HANDOFF_PREFIX} Staff are on duty until ${closing} (${hours.timeZone}); a staff member will reply here — please stay in the chat if you can.`;
  }
  return `${HANDOFF_PREFIX} Staff answer chats ${scheduleSummary(hours)}; they will reply here when the desk is open — please stay in the chat, or leave an email for a way back.`;
}
