/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Employee {
  id: string | number;
  eid: string; // e.g. "251805"
  name: string;
  rate_per_day: number;
  philhealth: number; // PhilHealth contribution rate or standard deduction
}

export type AttendanceAction = 'LOGIN' | 'LOGOUT';
export type AttendanceSource = 'SCAN' | 'MANUAL';

export interface Attendance {
  id: string | number;
  employee_id: string; // links to Employee.eid
  action: AttendanceAction;
  source: AttendanceSource;
  timestamp: string; // ISO 8601
  remarks?: string;
}

export interface AttendanceSession {
  id: string | number;
  employee_id: string; // links to Employee.eid
  login_at: string | null;
  logout_at: string | null;
  date: string; // YYYY-MM-DD
}

export interface AttendanceLogLegacy {
  id: string | number;
  eid: string;
  name: string;
  start_time: string | null;
  end_time: string | null;
  date: string; // YYYY-MM-DD
  remarks: string;
  tardiness: number; // minutes late
  undertime: number; // minutes short
}

// Admin configuration stored in app state
export interface ConnectionState {
  status: 'ONLINE' | 'LOCAL ONLY';
  sheetId?: string;
}
