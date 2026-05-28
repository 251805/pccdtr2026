/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, Attendance } from '../types';
import { SEED_EMPLOYEES } from './seedEmployees';

// Setup local offline employees copy if missing
export function initLocalCache() {
  if (typeof window === 'undefined') return;
  const cached = localStorage.getItem('theory11_local_employees');
  if (!cached) {
    localStorage.setItem('theory11_local_employees', JSON.stringify(SEED_EMPLOYEES));
  }
}

export function getCachedEmployees(): Employee[] {
  if (typeof window === 'undefined') return SEED_EMPLOYEES;
  const raw = localStorage.getItem('theory11_local_employees');
  return raw ? JSON.parse(raw) : SEED_EMPLOYEES;
}

export function updateCachedEmployees(list: Employee[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('theory11_local_employees', JSON.stringify(list));
}

// Identified saved Employee ID
export function getSavedEID(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('a10dance_eid') || '';
}

export function setSavedEID(eid: string) {
  if (typeof window === 'undefined') return;
  if (eid) {
    localStorage.setItem('a10dance_eid', eid);
  } else {
    localStorage.removeItem('a10dance_eid');
  }
}

// Queued offline attendance transactions
export function getOfflinePunches(): Attendance[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem('theory11_local_attendance');
  return raw ? JSON.parse(raw) : [];
}

export function saveOfflinePunch(punch: Attendance) {
  if (typeof window === 'undefined') return;
  const list = getOfflinePunches();
  list.push(punch);
  localStorage.setItem('theory11_local_attendance', JSON.stringify(list));
}

export function clearOfflinePunches() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('theory11_local_attendance');
}

/**
 * Flush all pending offline logs to the real server databases
 */
export async function flushOfflinePunches(onProgress?: (msg: string) => void): Promise<number> {
  const pending = getOfflinePunches();
  if (pending.length === 0) return 0;

  if (onProgress) onProgress(`Synchronizing ${pending.length} offline scans to live loggers...`);
  
  let successCount = 0;
  for (const punch of pending) {
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawEID: punch.employee_id,
          qrToken: '', // manual fallback skip token block
          source: 'MANUAL',
          remark: `[SYNCED FROM OFFLINE QUEUE] ${punch.remarks || ''}`
        })
      });

      if (res.ok) {
        successCount++;
      }
    } catch (e) {
      console.error('Failed to sync offline log:', e);
    }
  }

  clearOfflinePunches();
  return successCount;
}
