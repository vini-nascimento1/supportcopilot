const UK_TZ = "Europe/London"

/**
 * Validates an IANA timezone string by attempting to use it.
 * Returns a normalized valid timezone, or the fallback.
 */
export function validTimezone(tz: string | null | undefined, fallback = UK_TZ): string {
  if (!tz) return fallback
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return tz
  } catch {
    console.warn(`[timezone] invalid IANA zone "${tz}", falling back to "${fallback}"`)
    return fallback
  }
}

export const COMMON_TIMEZONES = [
  { value: "Pacific/Midway", label: "(UTC-11) Midway" },
  { value: "Pacific/Honolulu", label: "(UTC-10) Hawaii" },
  { value: "America/Anchorage", label: "(UTC-09) Alaska" },
  { value: "America/Los_Angeles", label: "(UTC-08) Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "(UTC-07) Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "(UTC-06) Central Time (US & Canada)" },
  { value: "America/New_York", label: "(UTC-05) Eastern Time (US & Canada)" },
  { value: "America/Halifax", label: "(UTC-04) Atlantic Time (Canada)" },
  { value: "America/St_Johns", label: "(UTC-03:30) Newfoundland" },
  { value: "America/Sao_Paulo", label: "(UTC-03) Brasília" },
  { value: "America/Noronha", label: "(UTC-02) Fernando de Noronha" },
  { value: "Atlantic/Azores", label: "(UTC-01) Azores" },
  { value: "Europe/London", label: "(UTC+00) London / UK" },
  { value: "Europe/Paris", label: "(UTC+01) Central Europe" },
  { value: "Europe/Berlin", label: "(UTC+01) Berlin" },
  { value: "Europe/Madrid", label: "(UTC+01) Madrid" },
  { value: "Europe/Rome", label: "(UTC+01) Rome" },
  { value: "Europe/Athens", label: "(UTC+02) Athens / Eastern Europe" },
  { value: "Europe/Helsinki", label: "(UTC+02) Helsinki" },
  { value: "Europe/Moscow", label: "(UTC+03) Moscow" },
  { value: "Asia/Dubai", label: "(UTC+04) Dubai" },
  { value: "Asia/Karachi", label: "(UTC+05) Karachi" },
  { value: "Asia/Kolkata", label: "(UTC+05:30) India" },
  { value: "Asia/Dhaka", label: "(UTC+06) Dhaka" },
  { value: "Asia/Bangkok", label: "(UTC+07) Bangkok / Jakarta" },
  { value: "Asia/Shanghai", label: "(UTC+08) Beijing / Singapore" },
  { value: "Asia/Tokyo", label: "(UTC+09) Tokyo" },
  { value: "Australia/Sydney", label: "(UTC+10) Sydney" },
  { value: "Pacific/Auckland", label: "(UTC+12) Auckland" },
]

export function formatLocalAndUkTime(
  iso: string,
  localTz: string | null | undefined,
): { local: string; uk: string } {
  const date = new Date(iso)
  const safeTz = validTimezone(localTz)
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  return {
    local: date.toLocaleString("en-US", { ...opts, timeZone: safeTz }),
    uk: date.toLocaleString("en-US", { ...opts, timeZone: UK_TZ }),
  }
}

export function formatLocalDate(
  date: Date,
  tz: string | null | undefined,
): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: validTimezone(tz),
  })
}

export function getLocalHour(tz: string | null | undefined): number {
  const now = new Date()
  return parseInt(
    now.toLocaleString("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: validTimezone(tz),
    }),
    10,
  )
}
