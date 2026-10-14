// Day / month keys and reset times in a fixed timezone (not the server's).

const partsIn = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

// Milliseconds the timezone is ahead of UTC at `date`.
const offsetAt = (date, timeZone) => {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
};

// The UTC instant of local midnight on year-month-day in the timezone.
const midnightIn = (year, month, day, timeZone) => {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetAt(new Date(guess), timeZone);
  // Correct once in case the offset differs at the target instant (DST).
  instant = guess - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
};

const pad = (value) => String(value).padStart(2, "0");

const periodInfo = (timeZone, now = new Date()) => {
  const { year, month, day } = partsIn(now, timeZone);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const nextMonth = new Date(Date.UTC(year, month, 1));

  return {
    dayKey: `${year}-${pad(month)}-${pad(day)}`,
    monthKey: `${year}-${pad(month)}`,
    dayResetsAt: midnightIn(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timeZone),
    monthResetsAt: midnightIn(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1, timeZone),
  };
};

module.exports = { periodInfo };
