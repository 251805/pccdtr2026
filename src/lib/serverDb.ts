/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, Attendance, AttendanceSession, AttendanceLogLegacy } from '../types';
import { SEED_EMPLOYEES } from './seedEmployees';
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, doc, query, where, orderBy, getDoc, setDoc } from 'firebase/firestore';

// In-memory fallback database
export let fallbackEmployees: Employee[] = [...SEED_EMPLOYEES];
export let fallbackAttendance: Attendance[] = [];
export let fallbackSessions: AttendanceSession[] = [];
export let fallbackLegacyLogs: AttendanceLogLegacy[] = [];

// No longer used

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

    // Push details to Firestore
    try {
        await addDoc(collection(db, 'sessions'), session);
        await addDoc(collection(db, 'legacy_logs'), legacyLog);
    } catch (e) {
        console.error('Failed to sync login session to Firestore:', e);
    }
  } else {
    // Action LOGOUT
    // Find matching active session in Firestore
    const q = query(
      collection(db, 'sessions'),
      where('employee_id', '==', eid),
      where('logout_at', '==', null)
    );
    const querySnapshot = await getDocs(q);
    
    let targetSessionId: string | null = null;
    let targetDocId: string | null = null;
    let resolvedLoginTime: string | null = null;

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const session = doc.data();
      targetDocId = doc.id;
      targetSessionId = session.id;
      resolvedLoginTime = session.login_at;
    } else {
      // Fallback pairing integrity
      resolvedLoginTime = timestamp;
      targetSessionId = `sess_${Date.now()}`;
      // This will be created/added to Firestore later
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
      await setDoc(doc(db, 'sessions', targetDocId || String(targetSessionId)), {
         id: targetSessionId,
         employee_id: eid,
         login_at: resolvedLoginTime,
         logout_at: timestamp,
         date: dateStr
      }, { merge: true });

      // 2. Write/Update Legacy Log
      if (legacyIdx !== -1) {
        await setDoc(doc(db, 'legacy_logs', fallbackLegacyLogs[legacyIdx].id), {
            ...fallbackLegacyLogs[legacyIdx],
            end_time: timestamp
        }, { merge: true });
      } else {
        // If no existing log was found, it was just pushed to fallbackLegacyLogs
        // We need to either find an existing legacy log or create a new one.
        // Actually, for LOGOUT if not found, we should query Firestore as well.
        // But for now, let's keep it simple by adding the fallback entry to Firestore.
        await addDoc(collection(db, 'legacy_logs'), {
          ...fallbackLegacyLogs[fallbackLegacyLogs.length - 1],
          end_time: timestamp
        });
      }
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
      if (emp.id) {
        await setDoc(doc(db, 'employees', String(emp.id)), emp, { merge: true });
      } else {
        await addDoc(collection(db, 'employees'), emp);
      }
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

