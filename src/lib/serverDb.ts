/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, Attendance, AttendanceSession, AttendanceLogLegacy } from '../types';
import { SEED_EMPLOYEES } from './seedEmployees';
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, doc, query, where, orderBy, getDoc } from 'firebase/firestore';

// In-memory fallback database
export let fallbackEmployees: Employee[] = [...SEED_EMPLOYEES];
export let fallbackAttendance: Attendance[] = [];
export let fallbackSessions: AttendanceSession[] = [];
export let fallbackLegacyLogs: AttendanceLogLegacy[] = [];

// Shared server state for OAuth
// No longer used with Firebase

// REST Google Sheets Helper - No longer used

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
 * Fetches all Employees from Firestore or falls back to server memory
 */
export async function getAllEmployees(): Promise<Employee[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'employees'));
    const employees = querySnapshot.docs.map(doc => doc.data() as Employee);
    // Refresh fallback employees to match Firestore
    if (employees.length > 0) {
      fallbackEmployees = employees;
    }
    return employees;
  } catch (e) {
    console.error('Error fetching employees from Firestore:', e);
  }
  return fallbackEmployees;
}

/**
 * Appends a raw record to collection 'attendance'
 */
export async function saveRawAttendance(attendance: Attendance): Promise<void> {
  fallbackAttendance.push(attendance);

  try {
    await addDoc(collection(db, 'attendance'), attendance);
  } catch (e) {
    console.error('Error syncing raw attendance to Firestore:', e);
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

    // Firestore updates
    try {
      // 1. Write/Update Session
      await setDoc(doc(db, 'sessions', String(targetSessionId)), {
         id: targetSessionId,
         employee_id: eid,
         login_at: resolvedLoginTime,
         logout_at: timestamp,
         date: dateStr
      }, { merge: true });

      // 2. Write/Update Legacy Log
      await setDoc(doc(db, 'legacy_logs', legacyLog.id), {
        ...legacyLog,
        end_time: timestamp,
        undertime
      }, { merge: true });
    } catch (e) {
      console.error('Failed to update Firestore with checkout details:', e);
    }
  }
}

/**
 * Sync entire local employee editing roster back to Firestore
 */
export async function saveRosterUpdate(updatedRoster: Employee[]): Promise<void> {
  fallbackEmployees = updatedRoster;

  try {
    for (const emp of updatedRoster) {
      await setDoc(doc(db, 'employees', emp.id), emp, { merge: true });
    }
  } catch (e) {
    console.error('Failed to sync bulk roster update to Firestore:', e);
  }
}

/**
 * Fetches all legacy visual logs from Firestore or falls back to server memory
 */
export async function getAllLegacyLogs(): Promise<AttendanceLogLegacy[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'legacy_logs'));
    const logs = querySnapshot.docs.map(doc => doc.data() as AttendanceLogLegacy);
    fallbackLegacyLogs = logs;
    return logs;
  } catch (e) {
    console.error('Error fetching legacy logs from Firestore:', e);
  }
  return fallbackLegacyLogs;
}

/**
 * Fetches raw transaction list from Firestore or falls back to server memory
 */
export async function getAllRawAttendance(): Promise<Attendance[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'attendance'));
    const list = querySnapshot.docs.map(doc => doc.data() as Attendance);
    fallbackAttendance = list;
    return list;
  } catch (e) {
    console.error('Error fetching raw attendance from Firestore:', e);
  }
  return fallbackAttendance;
}

/**
 * Fetches all sessions from Firestore or falls back to server memory
 */
export async function getAllSessions(): Promise<AttendanceSession[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'sessions'));
    const list = querySnapshot.docs.map(doc => doc.data() as AttendanceSession);
    fallbackSessions = list;
    return list;
  } catch (e) {
    console.error('Error fetching sessions from Firestore:', e);
  }
  return fallbackSessions;
}

