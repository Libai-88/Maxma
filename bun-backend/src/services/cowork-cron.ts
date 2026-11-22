/**
 * cowork-cron.ts — 5 字段 cron 的最小实现（本地调度专用）。
 *
 * 支持 `*`、数字、范围、步长与逗号列表；day-of-month 与 day-of-week 同时受限时
 * 按标准 cron 语义取“任一满足”。时区换算使用 Intl，不引入第三方 cron 库。
 */

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(raw: string, min: number, max: number, label: string): { values: Set<number>; restricted: boolean } {
  const text = raw.trim();
  if (!text) throw new Error(`${label} 不能为空`);
  const values = new Set<number>();
  let restricted = false;
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) throw new Error(`${label} 含空项`);
    if (token === "*") {
      for (let value = min; value <= max; value += 1) values.add(value);
      continue;
    }
    restricted = true;
    const stepSplit = token.split("/");
    if (stepSplit.length > 2) throw new Error(`${label} 步长写法不合法：${token}`);
    const rangeText = stepSplit[0] ?? "";
    const step = stepSplit.length === 2 ? Number(stepSplit[1]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`${label} 步长必须是正整数`);
    let start = min;
    let end = max;
    if (rangeText !== "*") {
      const range = rangeText.split("-");
      if (range.length > 2) throw new Error(`${label} 范围写法不合法：${token}`);
      start = Number(range[0] ?? "");
      end = range.length === 2 ? Number(range[1] ?? "") : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`${label} 超出 ${min}-${max}：${token}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, restricted };
}

export function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("cron 必须是 5 段：分 时 日 月 周");
  const [minuteRaw, hourRaw, dayRaw, monthRaw, weekdayRawField] = fields;
  if (!minuteRaw || !hourRaw || !dayRaw || !monthRaw || !weekdayRawField) {
    throw new Error("cron 段不能为空");
  }
  const minute = parseField(minuteRaw, 0, 59, "分钟");
  const hour = parseField(hourRaw, 0, 23, "小时");
  const day = parseField(dayRaw, 1, 31, "日");
  const month = parseField(monthRaw, 1, 12, "月");
  const weekdayRaw = parseField(weekdayRawField, 0, 7, "周");
  const weekday = new Set<number>();
  for (const value of weekdayRaw.values) weekday.add(value === 7 ? 0 : value);
  return {
    minute: minute.values,
    hour: hour.values,
    day: day.values,
    month: month.values,
    weekday,
    domRestricted: day.restricted,
    dowRestricted: weekdayRaw.restricted,
  };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timezone);
  if (existing) return existing;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  } catch {
    throw new Error(`时区不合法：${timezone}`);
  }
  formatterCache.set(timezone, formatter);
  return formatter;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface LocalParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

function localParts(date: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const hour = Number(values.hour === "24" ? "0" : values.hour);
  return {
    minute: Number(values.minute),
    hour,
    day: Number(values.day),
    month: Number(values.month),
    weekday: WEEKDAY_MAP[values.weekday ?? ""] ?? 0,
  };
}

export function validateTimezone(timezone: string): string {
  const text = timezone.trim() || "Asia/Shanghai";
  formatterFor(text);
  return text;
}

function matches(spec: CronSpec, parts: LocalParts): boolean {
  if (!spec.minute.has(parts.minute) || !spec.hour.has(parts.hour) || !spec.month.has(parts.month)) {
    return false;
  }
  const domOk = spec.day.has(parts.day);
  const dowOk = spec.weekday.has(parts.weekday);
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

/** 返回严格晚于 after 的下一次触发时间（UTC Date）；一年内无匹配返回 null。 */
export function nextCronRun(expression: string, timezone: string, after: Date = new Date()): Date | null {
  const spec = parseCron(expression);
  const zone = validateTimezone(timezone);
  const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const limit = start.getTime() + 366 * 24 * 60 * 60_000;
  for (let time = start.getTime(); time <= limit; time += 60_000) {
    const candidate = new Date(time);
    if (matches(spec, localParts(candidate, zone))) return candidate;
  }
  return null;
}

/** UI 用的常用预设；不替代自由 cron。 */
export const CRON_PRESETS: Array<{ id: string; label: string; cron: string }> = [
  { id: "weekday-9", label: "工作日 9:00", cron: "0 9 * * 1-5" },
  { id: "monday-9", label: "每周一 9:00", cron: "0 9 * * 1" },
  { id: "daily-9", label: "每天 9:00", cron: "0 9 * * *" },
  { id: "monthly-1-9", label: "每月 1 日 9:00", cron: "0 9 1 * *" },
];
