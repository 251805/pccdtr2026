/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, Attendance, AttendanceSession, AttendanceLogLegacy } from '../types';
import { SEED_EMPLOYEES } from './seedEmployees';
import fs from 'fs';
import path from 'path';

// In-memory fallback database
export let fallbackEmployees: Employee[] = [...SEED_EMPLOYEES];
export let fallbackAttendance: Attendance[] = [];
export let fallbackSessions: AttendanceSession[] = [];
export let fallbackLegacyLogs: AttendanceLogLegacy[] = [];

// Shared server state for OAuth
export let adminAccessToken: string | null = null;
export let activeSpreadsheetId: string | null = null;

const configPath = path.join(process.cwd(), 'sheet-config.json');

// Initially load from file, if exists!
try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    adminAccessToken = parsed.adminAccessToken || null;
    activeSpreadsheetId = parsed.activeSpreadsheetId || null;
    console.log("Loaded sheet configuration successfully. Persisted Sheet ID:", activeSpreadsheetId);
  }
} catch (e) {
  console.error("Failed to load sheet-config.json:", e);
}

export function setSharedAuth(token: string | null, sheetId: string | null) {
  adminAccessToken = token;
  activeSpreadsheetId = sheetId;
  
  try {
    fs.writeFileSync(configPath, JSON.stringify({ adminAccessToken, activeSpreadsheetId }, null, 2), 'utf8');
    console.log("Saved sheet configuration context successfully.");
  } catch (e) {
    console.error("Failed to save sheet-config.json:", e);
  }
}

export function getSharedAuth() {
  return { adminAccessToken, activeSpreadsheetId };
}

// REST Google Sheets Helper
async function sheetsFetch(endpoint: string, method: string, body?: any): Promise<any> {
  if (!adminAccessToken || !activeSpreadsheetId) {
    throw new Error('Google Sheets is not fully connected. Operating in offline mode.');
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${activeSpreadsheetId}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${adminAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) {
      console.error('Google Sheets API: Token expired (401). Client needs to re-authenticate.');
      // Keep previous token, but the client must know to re-login next time it tries to use it.
    }
    throw new Error(`Google Sheets API Error (${response.status}): ${errText}`);
  }

  return response.json();
}

/**
 * Ensures required sheets ("employees", "attendance", "attendance_sessions", "attendance_logs")
 * exist in the working spreadsheet.
 */
export async function ensureSpreadsheetStructure() {
  if (!adminAccessToken || !activeSpreadsheetId) return;

  try {
    // Check if sheets exist by fetching spreadsheet details
    const meta = await sheetsFetch('', 'GET');
    const existingTitles = meta.sheets?.map((s: any) => s.properties?.title) || [];

    const requiredSheets = ['employees', 'attendance', 'attendance_sessions', 'attendance_logs'];
    const addRequests: any[] = [];

    for (const sheet of requiredSheets) {
      if (!existingTitles.includes(sheet)) {
        addRequests.push({
          addSheet: {
            properties: { title: sheet }
          }
        });
      }
    }

    if (addRequests.length > 0) {
      await sheetsFetch(':batchUpdate', 'POST', { requests: addRequests });
    }

    // Now write headers to sheets that are newly created / empty
    await initializeHeadersIfEmpty();
  } catch (error) {
    console.error('Error ensuring spreadsheet structure:', error);
  }
}

async function initializeHeadersIfEmpty() {
  const checkAndInitRange = async (sheetName: string, headers: string[]) => {
    try {
      const data = await sheetsFetch(`/values/${sheetName}!A1:Z5`, 'GET');
      if (!data.values || data.values.length === 0) {
        // Sheet empty, write headers
        await sheetsFetch(`/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`, 'POST', {
          values: [headers]
        });
        
        // If employee sheet, push our initial seed workers immediately
        if (sheetName === 'employees') {
          const rows = fallbackEmployees.map(e => [e.id, e.eid, e.name, e.rate_per_day, e.philhealth]);
          await sheetsFetch(`/values/employees!A2:append?valueInputOption=USER_ENTERED`, 'POST', {
            values: rows
          });
        }
      }
    } catch (e) {
      console.error(`Failed to initialize headers for sheet ${sheetName}:`, e);
    }
  };

  await checkAndInitRange('employees', ['ID', 'EID', 'Name', 'DailyRate', 'PhilHealth']);
  await checkAndInitRange('attendance', ['ID', 'EmployeeID', 'Action', 'Source', 'Timestamp', 'Remarks']);
  await checkAndInitRange('attendance_sessions', ['ID', 'EmployeeID', 'LoginAt', 'LogoutAt', 'Date']);
  await checkAndInitRange('attendance_logs', ['ID', 'EID', 'Name', 'StartTime', 'EndTime', 'Date', 'Remarks', 'Tardiness', 'Undertime']);
}

/**
 * Fetches all Employees from Google Sheets or falls back to server memory
 */
export async function getAllEmployees(): Promise<Employee[]> {
  if (adminAccessToken && activeSpreadsheetId) {
    try {
      const data = await sheetsFetch('/values/employees!A2:E5000', 'GET');
      if (data.values) {
        const employees: Employee[] = data.values.map((row: any[], index: number) => ({
          id: row[0] || index + 1,
          eid: String(row[1] || '').trim(),
          name: row[2] || 'Unknown',
          rate_per_day: Number(row[3] || 0),
          philhealth: Number(row[4] || 0)
        })).filter((e: Employee) => e.eid);
        // Refresh fallback employees to match Sheets
        if (employees.length > 0) {
          fallbackEmployees = employees;
        }
        return employees;
      }
    } catch (e) {
      console.error('Error fetching employees from sheets:', e);
    }
  }
  return fallbackEmployees;
}

/**
 * Appends a raw record to sheet 'attendance'
 */
export async function saveRawAttendance(attendance: Attendance): Promise<void> {
  fallbackAttendance.push(attendance);

  if (adminAccessToken && activeSpreadsheetId) {
    try {
      const row = [
        attendance.id,
        attendance.employee_id,
        attendance.action,
        attendance.source,
        attendance.timestamp,
        attendance.remarks || ''
      ];
      await sheetsFetch('/values/attendance!A2:append?valueInputOption=USER_ENTERED', 'POST', {
        values: [row]
      });
    } catch (e) {
      console.error('Error syncing raw attendance to Google Sheets:', e);
    }
  }
}

/**
 * PAIR LOG: Updates or creates a session
 */
export async function processSessionAndLegacyWrite(
  eid: string,
  action: 'LOGIN' | 'LOGOUT',
  timestamp: string,
  dateStr: string,
  remarks: string,
  getClosestShiftHelper: (min: number) => any,
  calculateTardinessHelper: (time: string, shift: any) => number,
  calculateUndertimeHelper: (time: string, shift: any) => number
) {
  // Grab time portion
  const timeStr = new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Manila'
  });

  const employees = await getAllEmployees();
  const emp = employees.find(e => e.eid === eid) || { name: 'Unknown Crew' };

  if (action === 'LOGIN') {
    // 1. Create session
    const session: AttendanceSession = {
      id: `sess_${Date.now()}`,
      employee_id: eid,
      login_at: timestamp,
      logout_at: null,
      date: dateStr
    };
    fallbackSessions.push(session);

    // Calculate tardiness details
    const hrsMin = timeStr;
    const offsetMin = Number(hrsMin.split(':')[0]) * 60 + Number(hrsMin.split(':')[1]);
    const shift = getClosestShiftHelper(offsetMin);
    const tardiness = calculateTardinessHelper(hrsMin, shift);

    // 2. Create legacy log row
    const legacyLog: AttendanceLogLegacy = {
      id: `legacy_${Date.now()}`,
      eid,
      name: emp.name,
      start_time: timestamp,
      end_time: null,
      date: dateStr,
      remarks,
      tardiness,
      undertime: 0
    };
    fallbackLegacyLogs.push(legacyLog);

    // Push details to Google Sheets
    if (adminAccessToken && activeSpreadsheetId) {
      try {
        await sheetsFetch('/values/attendance_sessions!A2:append?valueInputOption=USER_ENTERED', 'POST', {
          values: [[session.id, session.employee_id, session.login_at, '', session.date]]
        });

        await sheetsFetch('/values/attendance_logs!A2:append?valueInputOption=USER_ENTERED', 'POST', {
          values: [[
            legacyLog.id,
            legacyLog.eid,
            legacyLog.name,
            legacyLog.start_time,
            '',
            legacyLog.date,
            legacyLog.remarks,
            legacyLog.tardiness,
            0
          ]]
        });
      } catch (e) {
        console.error('Failed to sync login session to Google Sheets:', e);
      }
    }
  } else {
    // Action LOGOUT
    // Find matching active session (login_at is present, logout_at is empty)
    let sessionIdx = -1;
    for (let i = fallbackSessions.length - 1; i >= 0; i--) {
      if (fallbackSessions[i].employee_id === eid && !fallbackSessions[i].logout_at) {
        sessionIdx = i;
        break;
      }
    }

    let resolvedLoginTime: string | null = null;
    let targetSessionId: string | number | null = null;

    if (sessionIdx !== -1) {
      fallbackSessions[sessionIdx].logout_at = timestamp;
      resolvedLoginTime = fallbackSessions[sessionIdx].login_at;
      targetSessionId = fallbackSessions[sessionIdx].id;
    } else {
      // Fallback pairing integrity
      resolvedLoginTime = timestamp;
      targetSessionId = `sess_${Date.now()}`;
      fallbackSessions.push({
        id: targetSessionId,
        employee_id: eid,
        login_at: timestamp,
        logout_at: timestamp,
        date: dateStr
      });
    }

    // Process calculations
    const loginTimeStr = resolvedLoginTime
      ? new Date(resolvedLoginTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
      : timeStr;
    const loginMin = Number(loginTimeStr.split(':')[0]) * 60 + Number(loginTimeStr.split(':')[1]);
    const shift = getClosestShiftHelper(loginMin);
    const undertime = calculateUndertimeHelper(timeStr, shift);

    // Find legacy row
    let legacyIdx = -1;
    for (let i = fallbackLegacyLogs.length - 1; i >= 0; i--) {
      if (fallbackLegacyLogs[i].eid === eid && !fallbackLegacyLogs[i].end_time) {
        legacyIdx = i;
        break;
      }
    }

    if (legacyIdx !== -1) {
      fallbackLegacyLogs[legacyIdx].end_time = timestamp;
      fallbackLegacyLogs[legacyIdx].undertime = undertime;
    } else {
      fallbackLegacyLogs.push({
        id: `legacy_${Date.now()}`,
        eid,
        name: emp.name,
        start_time: resolvedLoginTime,
        end_time: timestamp,
        date: dateStr,
        remarks,
        tardiness: 0,
        undertime
      });
    }

    // Google sheet updates
    if (adminAccessToken && activeSpreadsheetId) {
      try {
        // Find existing sessions in Sheets to edit
        const sData = await sheetsFetch('/values/attendance_sessions!A1:E5000', 'GET');
        const sRows = sData.values || [];
        // Match by ID
        let sheetRowIndexS = -1;
        for (let i = 1; i < sRows.length; i++) {
          if (String(sRows[i][0]) === String(targetSessionId)) {
            sheetRowIndexS = i + 1; // 1-indexed for sheets
            break;
          }
        }

        if (sheetRowIndexS !== -1) {
          // Update logout_at
          await sheetsFetch(`/values/attendance_sessions!D${sheetRowIndexS}:D${sheetRowIndexS}?valueInputOption=USER_ENTERED`, 'PUT', {
            values: [[timestamp]]
          });
        } else {
          // Append session fallback
          await sheetsFetch('/values/attendance_sessions!A2:append?valueInputOption=USER_ENTERED', 'POST', {
            values: [[targetSessionId, eid, resolvedLoginTime, timestamp, dateStr]]
          });
        }

        // legacy sheet updates
        const legacyData = await sheetsFetch('/values/attendance_logs!A1:I5000', 'GET');
        const lRows = legacyData.values || [];
        let sheetRowIndexL = -1;
        for (let i = lRows.length - 1; i >= 1; i--) {
          if (String(lRows[i][1]) === eid && !lRows[i][4]) {
            sheetRowIndexL = i + 1;
            break;
          }
        }

        if (sheetRowIndexL !== -1) {
          // Update EndTime and Undertime
          await sheetsFetch(`/values/attendance_logs!E${sheetRowIndexL}:I${sheetRowIndexL}?valueInputOption=USER_ENTERED`, 'PUT', {
            values: [[timestamp, dateStr, remarks, lRows[sheetRowIndexL-1][7] || 0, undertime]]
          });
        } else {
          // Create new closed row
          await sheetsFetch('/values/attendance_logs!A2:append?valueInputOption=USER_ENTERED', 'POST', {
            values: [[`legacy_${Date.now()}`, eid, emp.name, resolvedLoginTime, timestamp, dateStr, remarks, 0, undertime]]
          });
        }
      } catch (e) {
        console.error('Failed to update Google Sheets with checkout details:', e);
      }
    }
  }
}

/**
 * Sync entire local employee editing roster back to Google sheets
 */
export async function saveRosterUpdate(updatedRoster: Employee[]): Promise<void> {
  fallbackEmployees = updatedRoster;

  if (adminAccessToken && activeSpreadsheetId) {
    try {
      // Overwrite employee sheet: Clear and write again (safest for updates)
      await sheetsFetch('/values/employees!A2:E5000?valueInputOption=USER_ENTERED', 'PUT', {
         values: Array(250).fill(['', '', '', '', '']) // mock clear range
      });

      const rows = updatedRoster.map(e => [e.id, e.eid, e.name, e.rate_per_day, e.philhealth]);
      await sheetsFetch('/values/employees!A2:append?valueInputOption=USER_ENTERED', 'POST', {
        values: rows
      });
    } catch (e) {
      console.error('Failed to sync bulk roster update to Google Sheets:', e);
    }
  }
}

/**
 * Fetches all legacy visual logs from Google Sheets or falls back to server memory
 */
export async function getAllLegacyLogs(): Promise<AttendanceLogLegacy[]> {
  if (adminAccessToken && activeSpreadsheetId) {
    try {
      const data = await sheetsFetch('/values/attendance_logs!A2:I5000', 'GET');
      if (data.values) {
        const logs: AttendanceLogLegacy[] = data.values.map((row: any[], index: number) => ({
          id: row[0] || `legacy_sheet_${index}`,
          eid: String(row[1] || '').trim(),
          name: row[2] || 'Unknown',
          start_time: row[3] || null,
          end_time: row[4] || null,
          date: row[5] || '',
          remarks: row[6] || '',
          tardiness: Number(row[7] || 0),
          undertime: Number(row[8] || 0)
        })).filter((l: AttendanceLogLegacy) => l.eid);
        fallbackLegacyLogs = logs;
        return logs;
      }
    } catch (e) {
      console.error('Error fetching legacy logs from sheets:', e);
    }
  }
  return fallbackLegacyLogs;
}

/**
 * Fetches raw transaction list from Google Sheets or falls back to server memory
 */
export async function getAllRawAttendance(): Promise<Attendance[]> {
  if (adminAccessToken && activeSpreadsheetId) {
    try {
      const data = await sheetsFetch('/values/attendance!A2:F5000', 'GET');
      if (data.values) {
        const list: Attendance[] = data.values.map((row: any[], index: number) => ({
          id: row[0] || `raw_sheet_${index}`,
          employee_id: String(row[1] || '').trim(),
          action: row[2] as 'LOGIN' | 'LOGOUT',
          source: row[3] || 'MANUAL',
          timestamp: row[4] || '',
          remarks: row[5] || ''
        })).filter((l: Attendance) => l.employee_id);
        fallbackAttendance = list;
        return list;
      }
    } catch (e) {
      console.error('Error fetching raw attendance from sheets:', e);
    }
  }
  return fallbackAttendance;
}

/**
 * Fetches all sessions from Google Sheets or falls back to server memory
 */
export async function getAllSessions(): Promise<AttendanceSession[]> {
  if (adminAccessToken && activeSpreadsheetId) {
    try {
      const data = await sheetsFetch('/values/attendance_sessions!A2:E5000', 'GET');
      if (data.values) {
        const list: AttendanceSession[] = data.values.map((row: any[], index: number) => ({
          id: row[0] || `sess_sheet_${index}`,
          employee_id: String(row[1] || '').trim(),
          login_at: row[2] || '',
          logout_at: row[3] || null,
          date: row[4] || ''
        })).filter((s: AttendanceSession) => s.employee_id);
        fallbackSessions = list;
        return list;
      }
    } catch (e) {
      console.error('Error fetching sessions from sheets:', e);
    }
  }
  return fallbackSessions;
}

