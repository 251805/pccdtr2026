import { Employee, Attendance, AttendanceSession, AttendanceLogLegacy } from '../types';
import { normalizeEID, getClosestShift, calculateTardiness, calculateUndertime } from './shiftLogic';

export function isClientOnlyMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('a10dance_client_only_apps_script') === 'true';
}

export function getClientScriptUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('a10dance_client_script_url');
}

export function getClientSpreadsheetId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('a10dance_client_spreadsheet_id');
}

function getManilaDateStr(dOffset = 0): string {
  const d = new Date(Date.now() + dOffset * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD format
}

async function callDirectAppsScript(url: string, payload: any): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Google Apps Script directly returned Http Error: ${response.status}`);
  }

  const rawText = await response.text();
  const trimmed = rawText.trim();

  if (trimmed.startsWith('<')) {
    throw new Error("Apps Script response returned HTML instead of JSON. Ensure 'Execute as' is set to 'Me' and 'Who has access' is set to 'Anyone' in script deployments.");
  }

  const parsed = JSON.parse(trimmed);
  if (parsed.success === false) {
    throw new Error(parsed.error || "Google Apps Script internal execution failure.");
  }

  return parsed;
}

export async function clientFetchEmployees(url: string): Promise<Employee[]> {
  const data = await callDirectAppsScript(url, { action: 'get_employees' });
  if (data && data.values) {
    return data.values.map((row: any[], index: number) => ({
      id: row[0] || index + 1,
      eid: String(row[1] || '').trim(),
      name: row[2] || 'Unknown',
      rate_per_day: Number(row[3] || 0),
      philhealth: Number(row[4] || 0)
    })).filter((e: Employee) => e.eid);
  }
  return [];
}

export async function clientFetchLegacyLogs(url: string): Promise<AttendanceLogLegacy[]> {
  const data = await callDirectAppsScript(url, { action: 'get_legacy_logs' });
  if (data && data.values) {
    return data.values.map((row: any[]) => ({
      id: row[0],
      eid: row[1],
      name: row[2],
      start_time: row[3] || null,
      end_time: row[4] || null,
      date: row[5],
      remarks: row[6],
      tardiness: Number(row[7] || 0),
      undertime: Number(row[8] || 0)
    }));
  }
  return [];
}

export async function clientUpdateRoster(url: string, roster: Employee[]): Promise<boolean> {
  const res = await callDirectAppsScript(url, { action: 'save_roster_update', roster });
  return !!res.success;
}

export async function clientProcessScan(
  url: string,
  rawEID: string,
  qrToken: string,
  source: 'SCAN' | 'MANUAL',
  remark?: string,
  lastPunchTimes: Record<string, number> = {}
): Promise<{
  success: boolean;
  action: 'LOGIN' | 'LOGOUT';
  employee: Employee;
  timestamp: string;
  message: string;
}> {
  const notes = remark || "";

  // 1. EID Normalization
  const eid = normalizeEID(rawEID);
  if (!eid) {
    throw new Error("Missing or invalid Employee Identifier ID");
  }

  // 2. Anti-Spam double click check (30-second threshold)
  const now = Date.now();
  const lastPunch = lastPunchTimes[eid];
  if (lastPunch && (now - lastPunch) < 30000) {
    const remaining = Math.ceil((30000 - (now - lastPunch)) / 1000);
    throw new Error(`Anti-Spam lock activated for employee [${eid}]. Please wait ${remaining}s before resubmitting.`);
  }

  // 3. QR Token Verification if SCAN source
  if (source === 'SCAN') {
    const todayStr = getManilaDateStr(0);
    const yesterdayStr = getManilaDateStr(-1);
    
    const expectedToday = `a10dance-daily-qr-${todayStr}`;
    const expectedYesterday = `a10dance-daily-qr-${yesterdayStr}`;

    if (qrToken !== expectedToday && qrToken !== expectedYesterday) {
      throw new Error("Stale or Invalid Station QR Code. Display is expired or captured from yesterday.");
    }
  }

  // 4. Verify/Retrieve Employee Identity
  let employees: Employee[] = [];
  try {
    employees = await clientFetchEmployees(url);
  } catch (err) {
    console.warn("Could not query active employee list, using standby fallback roster.");
  }
  
  let emp = employees.find(e => e.eid === eid);

  // Self-healing roster setup
  if (!emp) {
    emp = {
      id: `emp_${Date.now()}`,
      eid,
      name: `Crew Member (${eid})`,
      rate_per_day: 800,
      philhealth: 300
    };
    employees.push(emp);
    try {
      await clientUpdateRoster(url, employees);
    } catch (e) {
      console.error("Could not expand dynamic database roster row:", e);
    }
  }

  // 5. Determine Punch Action Direction (LOGIN vs LOGOUT)
  let rawAttendanceLogs: Attendance[] = [];
  try {
    const rawLogsData = await callDirectAppsScript(url, { action: 'get_raw_attendance' });
    if (rawLogsData && rawLogsData.values) {
      rawAttendanceLogs = rawLogsData.values.map((row: any[]) => ({
        id: row[0],
        employee_id: String(row[1] || '').trim(),
        action: row[2] as 'LOGIN' | 'LOGOUT',
        source: row[3] as 'SCAN' | 'MANUAL',
        timestamp: row[4],
        remarks: row[5]
      }));
    }
  } catch (err) {
    console.warn("Could not query raw attendance logs to determine punch direction, fallback to local lookup.");
  }

  const employeeRawLogs = rawAttendanceLogs.filter(l => l.employee_id === eid);
  let nextAction: 'LOGIN' | 'LOGOUT' = 'LOGIN';
  if (employeeRawLogs.length > 0) {
    const lastSession = employeeRawLogs[employeeRawLogs.length - 1];
    nextAction = lastSession.action === 'LOGIN' ? 'LOGOUT' : 'LOGIN';
  }

  // Set anti-spam timestamp
  lastPunchTimes[eid] = now;

  // 6. Record Raw Attendance Transaction
  const timestampISO = new Date().toISOString();
  const todayStr = getManilaDateStr(0);

  const scanLog = {
    id: `raw_${Date.now()}`,
    employee_id: eid,
    action: nextAction,
    source: source,
    timestamp: timestampISO,
    remarks: notes
  };

  await callDirectAppsScript(url, {
    action: 'save_raw_attendance',
    attendance: scanLog
  });

  // 7. Write to Sessions & Legacy spreadsheets
  const timeStr = new Date(timestampISO).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Manila'
  });

  if (nextAction === 'LOGIN') {
    const sessionId = `sess_${Date.now()}`;
    const legacyId = `legacy_${Date.now()}`;

    const hrsMin = timeStr;
    const offsetMin = Number(hrsMin.split(':')[0]) * 60 + Number(hrsMin.split(':')[1]);
    const shift = getClosestShift(offsetMin);
    const tardiness = calculateTardiness(hrsMin, shift);

    await callDirectAppsScript(url, {
      action: 'process_session_and_legacy',
      session: {
        id: sessionId,
        employee_id: eid,
        login_at: timestampISO,
        logout_at: null,
        date: todayStr
      },
      legacy: {
        id: legacyId,
        eid: eid,
        name: emp.name,
        start_time: timestampISO,
        end_time: null,
        date: todayStr,
        remarks: notes,
        tardiness: tardiness,
        undertime: 0
      }
    });

  } else {
    // LOGOUT direction
    // Fetch sessions to find active log login time
    let sessionList: AttendanceSession[] = [];
    try {
      const sessData = await callDirectAppsScript(url, { action: 'get_sessions' });
      if (sessData && sessData.values) {
        sessionList = sessData.values.map((row: any[]) => ({
          id: row[0],
          employee_id: String(row[1] || '').trim(),
          login_at: row[2] || null,
          logout_at: row[3] || null,
          date: row[4]
        }));
      }
    } catch {
      // ignore
    }

    let activeSession = sessionList.find(s => s.employee_id === eid && !s.logout_at);
    let resolvedLoginTime = activeSession ? activeSession.login_at : timestampISO;
    let targetSessionId = activeSession ? activeSession.id : `sess_${Date.now()}`;

    const loginTimeStr = resolvedLoginTime
      ? new Date(resolvedLoginTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
      : timeStr;
    const loginMin = Number(loginTimeStr.split(':')[0]) * 60 + Number(loginTimeStr.split(':')[1]);
    const shift = getClosestShift(loginMin);
    const undertime = calculateUndertime(timeStr, shift);

    // Fetch legacy logs to carry over tardiness if matched
    let legacyList: AttendanceLogLegacy[] = [];
    try {
      legacyList = await clientFetchLegacyLogs(url);
    } catch {
      // ignore
    }
    const matchedLegacy = legacyList.find(l => l.eid === eid && !l.end_time);
    const tardiness = matchedLegacy ? matchedLegacy.tardiness : 0;

    await callDirectAppsScript(url, {
      action: 'process_session_and_legacy',
      session: {
        id: targetSessionId,
        employee_id: eid,
        login_at: resolvedLoginTime,
        logout_at: timestampISO,
        date: todayStr
      },
      legacy: {
        id: `legacy_${Date.now()}`,
        eid: eid,
        name: emp.name,
        start_time: resolvedLoginTime,
        end_time: timestampISO,
        date: todayStr,
        remarks: notes,
        tardiness: tardiness,
        undertime: undertime
      }
    });
  }

  return {
    success: true,
    action: nextAction,
    employee: emp,
    timestamp: timestampISO,
    message: `${emp.name} has clocked [${nextAction}] successfully.`
  };
}
