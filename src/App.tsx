/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  getSpreadsheetIdFromCache, 
  syncTokenToBackend,
  setSpreadsheetIdToCache
} from './lib/firebaseAuth';
import { 
  initLocalCache, 
  getCachedEmployees, 
  updateCachedEmployees, 
  getSavedEID, 
  saveOfflinePunch,
  getOfflinePunches,
  flushOfflinePunches
} from './lib/db';
import { Employee, AttendanceLogLegacy, Attendance } from './types';

// Components
import TopNav from './components/TopNav';
import AttendanceCard from './components/AttendanceCard';
import KioskView from './components/KioskView';
import QRScanner from './components/QRScanner';
import AdminModal from './components/AdminModal';
import ReportModal from './components/ReportModal';
import SpecialEmployeeModal from './components/SpecialEmployeeModal';

export default function App() {
  // Interface mode toggles
  const [isKiosk, setIsKiosk] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);

  // Connection and Network states
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  
  // Active Spreadsheet State
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);

  // Records and Data rosters states
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLogLegacy[]>([]);
  const [todayToken, setTodayToken] = useState('a10dance-daily-qr-2026-05-27');
  const [serverTime, setServerTime] = useState('');

  // Scanning Result UI Feedbacks
  const [punchStatus, setPunchStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [statusMessage, setStatusMessage] = useState('');

  // 1. First-time load initializations
  useEffect(() => {
    initLocalCache();
    setEmployeesList(getCachedEmployees());

    // Recover cached Sheet ID
    const savedSheetId = getSpreadsheetIdFromCache();
    if (savedSheetId) {
      setSpreadsheetId(savedSheetId);
    }

    // Check kiosk URL query triggers
    const params = new URLSearchParams(window.location.search);
    if (params.get('kiosk') === 'true') {
      setIsKiosk(true);
    }

    // Monitor online-offline toggles
    const handleOnline = () => {
      setIsOnline(true);
      // Run automated sync recovery
      flushOfflinePunches((msg) => {
        setPunchStatus('LOADING');
        setStatusMessage(msg);
      }).then((count) => {
        if (count > 0) {
          setPunchStatus('SUCCESS');
          setStatusMessage(`Sync Completed! Uploaded ${count} offline punches sequentially.`);
          setTimeout(() => setPunchStatus('IDLE'), 4000);
          refreshLocalData();
        }
      });
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Boot Firebase Auth State Observer
    const unsubscribeAuth = initAuth(
      async (firebaseUser, token) => {
        setUser(firebaseUser);
        setNeedsAuth(false);
        setAuthChecking(false);

        // If sheet id is present in state, notify Express backend
        if (savedSheetId) {
          await syncTokenToBackend(savedSheetId);
        }
        refreshLocalData();
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
        setAuthChecking(false);
        refreshLocalData();
      }
    );

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeAuth();
    };
  }, []);

  // 2. Continuous data refresh polling (every 10 seconds)
  useEffect(() => {
    refreshLocalData();
    const interval = setInterval(refreshLocalData, 10000);
    return () => clearInterval(interval);
  }, [user, spreadsheetId]);

  const refreshLocalData = async () => {
    try {
      // Pull configuration
      const configRes = await fetch('/api/config');
      if (configRes.ok) {
        const config = await configRes.json();
        setTodayToken(config.todayToken);
        setServerTime(config.serverTime);
        if (config.spreadsheetId && config.spreadsheetId !== spreadsheetId) {
          setSpreadsheetId(config.spreadsheetId);
          setSpreadsheetIdToCache(config.spreadsheetId);
        } else if (!config.spreadsheetId && spreadsheetId) {
          setSpreadsheetId(null);
          setSpreadsheetIdToCache(null);
        }
      }

      // Pull crew member indices
      const empRes = await fetch('/api/employees');
      if (empRes.ok) {
        const empData = await empRes.json();
        setEmployeesList(empData);
        updateCachedEmployees(empData);
      }

      // Pull daily sync logs
      const logRes = await fetch('/api/logs');
      if (logRes.ok) {
        const logsPayload = await logRes.json();
        setAttendanceLogs(logsPayload.legacy || []);
      }
    } catch (e) {
      console.warn("Standby Mode: fetching data directly from server offline fallback.");
      // If server is not fully reachable or on errors, load cached localStorage datasets
      setEmployeesList(getCachedEmployees());
    }
  };

  // Login click handlers
  const handleAdminLogin = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setNeedsAuth(false);
        refreshLocalData();
      }
    } catch {
      alert('Authentication failure. Cancelled by operator.');
    }
  };

  const handleAdminLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
    refreshLocalData();
  };

  const handleSaveSpreadsheetId = async (id: string) => {
    setSpreadsheetId(id);
    setSpreadsheetIdToCache(id);
    if (id) {
       const status = await syncTokenToBackend(id);
       if (status) {
         setPunchStatus('SUCCESS');
         setStatusMessage('Google Sheets synchronization active! Schema checks validated.');
         setTimeout(() => setPunchStatus('IDLE'), 3000);
       }
    } else {
       // Disconnect
       await fetch('/api/auth/clear-token', { method: 'POST' });
    }
    refreshLocalData();
  };

  // Bulk roster changes handler
  const handleSaveRoster = async (updatedRoster: Employee[]) => {
    const confirmation = window.confirm('Confirm roster bulk modification? This overwrites matching index rows in your Google Sheet.');
    if (!confirmation) return;

    try {
      const res = await fetch('/api/employees/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster: updatedRoster })
      });

      if (res.ok) {
        setEmployeesList(updatedRoster);
        updateCachedEmployees(updatedRoster);
        alert('Roster indices compiled and saved successfully!');
      } else {
        throw new Error('Overwriting payload rejected.');
      }
    } catch {
      alert('Failed to update roster on remote database. Reverting to local fallback cached definitions.');
    }
  };

  // QR Code camera scan callback
  const handleScanSuccess = async (scannedBarcode: string) => {
    setPunchStatus('LOADING');
    setStatusMessage('Normalizing credentials and verifying Security Token...');

    const savedEID = getSavedEID();
    if (!savedEID) {
      setPunchStatus('ERROR');
      setStatusMessage('Device identified session not active. Register a mobile EID ID before launching scanner!');
      return;
    }

    try {
      // Trigger API endpoint sync scan
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawEID: savedEID,
          qrToken: scannedBarcode,
          source: 'SCAN'
        })
      });

      const data = await res.json();
      if (res.ok) {
        setPunchStatus('SUCCESS');
        setStatusMessage(data.message || `Punch successfully matching login sequence.`);
        setTimeout(() => setPunchStatus('IDLE'), 6000);
        refreshLocalData();
        if (savedEID === '251805') {
          setShowSpecialModal(true);
        }
      } else {
        setPunchStatus('ERROR');
        setStatusMessage(data.error || 'Security ticket validation error.');
      }
    } catch (e) {
      // Offline transition, handle local sync append
      console.warn("Connection disrupted. Saving offline scan packet:", e);
      const offlinePunch: Attendance = {
        id: `local_${Date.now()}`,
        employee_id: savedEID,
        action: 'LOGIN', // Standby defaults
        source: 'SCAN',
        timestamp: new Date().toISOString(),
        remarks: '[CACHED OFFLINE IN BROWSER]'
      };
      saveOfflinePunch(offlinePunch);
      setPunchStatus('SUCCESS');
      setStatusMessage('Scan recognized locally! Committing to browser index. Punch will self-heal on network restoration.');
      setTimeout(() => setPunchStatus('IDLE'), 5000);
      if (savedEID === '251805') {
        setShowSpecialModal(true);
      }
    }
  };

  // Manual Punch fallback callback handler
  const handleManualPunch = async (eid: string, action: 'LOGIN' | 'LOGOUT', comment?: string) => {
    setPunchStatus('LOADING');
    setStatusMessage(`Entering manual DTR clock for operator [${eid}] ...`);

    if (!eid.trim()) {
      setPunchStatus('ERROR');
      setStatusMessage('Operator EID input area cannot stay empty.');
      return;
    }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawEID: eid,
          qrToken: '',
          source: 'MANUAL',
          remark: comment
        })
      });

      const data = await res.json();
      if (res.ok) {
        setPunchStatus('SUCCESS');
        setStatusMessage(data.message || 'DTR punch validated successfully.');
        setTimeout(() => setPunchStatus('IDLE'), 6000);
        refreshLocalData();
        if (eid.trim() === '251805' && action === 'LOGIN') {
          setShowSpecialModal(true);
        }
      } else {
        setPunchStatus('ERROR');
        setStatusMessage(data.error || 'Server rejected manual insertion sequence.');
      }
    } catch (error) {
      // offline fallback
      const offlinePunch: Attendance = {
        id: `local_${Date.now()}`,
        employee_id: eid,
        action: action,
        source: 'MANUAL',
        timestamp: new Date().toISOString(),
        remarks: `[OFFLINE MANUAL] ${comment || ''}`
      };
      saveOfflinePunch(offlinePunch);
      setPunchStatus('SUCCESS');
      setStatusMessage(`Offline fallback engaged. Shift logged client-side. Connection Sync triggers online.`);
      setTimeout(() => setPunchStatus('IDLE'), 5000);
      if (eid.trim() === '251805' && action === 'LOGIN') {
        setShowSpecialModal(true);
      }
    }
  };

  const handleToggleKioskMode = () => {
    const nextState = !isKiosk;
    setIsKiosk(nextState);
    // synchronize window parameters in URL bar
    const url = new URL(window.location.href);
    if (nextState) {
      url.searchParams.set('kiosk', 'true');
    } else {
      url.searchParams.delete('kiosk');
    }
    window.history.replaceState({}, '', url.toString());
  };

  // Rendering Kiosk full screens
  if (isKiosk) {
    return (
      <KioskView
        onLinesStatus={isOnline}
        todayToken={todayToken}
        serverTime={serverTime}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 font-sans selection:bg-orange-600/30 overflow-x-hidden pb-12">
      
      {/* Universal navigation menu */}
      <TopNav
        onLinesStatus={isOnline}
        onOpenAdmin={() => setShowAdmin(true)}
        onOpenReports={() => setShowReports(true)}
        isKiosk={isKiosk}
        onToggleKiosk={handleToggleKioskMode}
      />

      {/* Main Punchboard Element */}
      <main className="pt-8">
        <AttendanceCard
          onScanClick={() => setShowScanner(true)}
          onManualPunch={handleManualPunch}
          pendingStatus={punchStatus}
          statusMessage={statusMessage}
        />
      </main>

      {/* Viewfinders QR Modals */}
      {showScanner && (
        <QRScanner
          onScanSuccess={handleScanSuccess}
          onScanError={(err) => console.log('Continuous scans feedback:', err)}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Administration Modals */}
      {showAdmin && (
        <AdminModal
          employeesList={employeesList}
          onSaveRoster={handleSaveRoster}
          onClose={() => setShowAdmin(false)}
          spreadsheetId={spreadsheetId}
          onSaveSpreadsheetId={handleSaveSpreadsheetId}
          user={user}
          needsAuth={needsAuth}
          onLogin={handleAdminLogin}
          onLogout={handleAdminLogout}
        />
      )}

      {/* Analytics Reports Modals */}
      {showReports && (
        <ReportModal
          logs={attendanceLogs}
          employeesList={employeesList}
          onClose={() => setShowReports(false)}
        />
      )}

      {/* Special Employee 251805 Welcome Modal */}
      {showSpecialModal && (
        <SpecialEmployeeModal
          onClose={() => setShowSpecialModal(false)}
        />
      )}

    </div>
  );
}
