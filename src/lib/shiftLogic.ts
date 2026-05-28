/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Shift {
  name: string;
  startMin: number; // minutes from midnight
  endMin: number;
  isOvernight?: boolean;
}

export const SHIFTS: Shift[] = [
  { name: 'Morning Shift', startMin: 360, endMin: 840 },       // 06:00 AM - 02:00 PM
  { name: 'Regular Shift', startMin: 480, endMin: 1020 },      // 08:00 AM - 05:00 PM
  { name: 'Afternoon Shift', startMin: 840, endMin: 1320 },    // 02:00 PM - 10:00 PM
  { name: 'Night Shift', startMin: 1320, endMin: 360, isOvernight: true }, // 10:00 PM - 06:00 AM (Overnight)
];

/**
 * Normalizes any variations of Employee ID (EID) formats.
 * E.g., strips quotes, extracts from JSON, handles HTTP URLs and parameters.
 */
export function normalizeEID(rawInput: string): string {
  if (!rawInput) return '';
  let clean = rawInput.trim();

  // Strip wrapping single or double quotes
  if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
    clean = clean.slice(1, -1).trim();
  }

  // Handle JSON
  if (clean.startsWith('{')) {
    try {
      const parsed = JSON.parse(clean);
      const possibleKeys = ['eid', 'id', 'employeeId', 'employee_id'];
      for (const key of possibleKeys) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          return String(parsed[key]).trim();
        }
      }
    } catch {
      // Fallback if JSON parse fails
    }
  }

  // Handle URL
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      const url = new URL(clean);
      const possibleParams = ['eid', 'id', 'empid', 'emp_id', 'employee_id', 'employee'];
      for (const param of possibleParams) {
        const val = url.searchParams.get(param);
        if (val) return val.trim();
      }
      // If no parameter matches, split path name and get the last segment
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        return segments[segments.length - 1].trim();
      }
    } catch {
      // Keep as clean url trimmed if URL parse fails
    }
  }

  return clean;
}

/**
 * Parses "HH:MM" string to minutes from midnight
 */
export function timeToMinutes(timeStr: string): number {
  const [hrs, mins] = timeStr.split(':').map(Number);
  if (isNaN(hrs) || isNaN(mins)) return 0;
  return hrs * 60 + mins;
}

/**
 * Determines closest shift from clocked in minutes
 */
export function getClosestShift(clockInMin: number): Shift {
  let closestShift = SHIFTS[0];
  let minDiff = Infinity;

  for (const shift of SHIFTS) {
    let diff = Math.abs(clockInMin - shift.startMin);
    // Handle overnight shift wrap-around check if closest difference is > 12 hours
    if (diff > 720) {
      diff = 1440 - diff;
    }
    if (diff < minDiff) {
      minDiff = diff;
      closestShift = shift;
    }
  }

  return closestShift;
}

/**
 * Calculates tardiness minutes based on close match shift and clock in time
 */
export function calculateTardiness(clockInTimeStr: string, shift: Shift): number {
  const clockInMin = timeToMinutes(clockInTimeStr);
  
  if (shift.isOvernight) {
    // 10:00 PM (1320) to 06:00 AM (360)
    // If they clocked in from 10:00 PM until 11:59 PM (between 1320 and 1439)
    if (clockInMin >= shift.startMin) {
      return Math.max(0, clockInMin - shift.startMin);
    }
    // If they clocked in after midnight (between 0 and morning shift threshold 360)
    if (clockInMin < 360) {
      return (1440 - shift.startMin) + clockInMin;
    }
    return 0;
  } else {
    return Math.max(0, clockInMin - shift.startMin);
  }
}

/**
 * Calculates undertime minutes based on shift and clock out time
 */
export function calculateUndertime(clockOutTimeStr: string, shift: Shift): number {
  const clockOutMin = timeToMinutes(clockOutTimeStr);

  if (shift.isOvernight) {
    // End is 06:00 AM (360 mins from midnight)
    // If they clocked out before midnight (e.g., 11:00 PM / 1380 mins)
    if (clockOutMin >= shift.startMin) {
      return (1440 - clockOutMin) + shift.endMin;
    }
    // If they clocked out after midnight but before end of shift (06:00 AM)
    if (clockOutMin < shift.endMin) {
      return shift.endMin - clockOutMin;
    }
    return 0;
  } else {
    return Math.max(0, shift.endMin - clockOutMin);
  }
}
