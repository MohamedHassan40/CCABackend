/** Add calendar months to a date (matches renew logic). */
export function addCalendarMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
