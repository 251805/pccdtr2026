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
import {
  isClientOnlyMode,
  getClientScriptUrl,
  getClientSpreadsheetId,
  clientFetchEmployees,
  clientFetchLegacyLogs,
  clientUpdateRoster,
  clientProcessScan
} from './lib/clientSyncBridge';

interface ExpressServerConfig {
  isExpress: boolean;
  googleAppsScriptUrl?: string | null;
  spreadsheetId?: string | null;
  appsScriptError?: string | null;
  todayToken?: string;
  serverTime?: string;
}

async function detectExpressServer(): Promise<ExpressServerConfig> {
  try {
    const res = await fetch('/api/config');
    const contentType = res.headers.get("content-type");
    if (res.ok && contentType && contentType.includes("application/json")) {
      const config = await res.json();
      if (config && typeof config === 'object' && 'serverTime' in config) {
        return { isExpress: true, ...config };
      }
    }
  } catch (e) {
    console.warn("Express server lookup failed:", e);
  }
  return { isExpress: false };
}

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

  // Anti-spam block for serverless fallback
  const [lastPunchTimes] = useState<Record<string, number>>({});
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  
  // Active Spreadsheet State
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [googleAppsScriptUrl, setGoogleAppsScriptUrl] = useState<string | null>(null);
  const [appsScriptError, setAppsScriptError] = useState<string | null>(null);

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

        // If sheet id is present in state, notify Express backend if express is running
        const serverInfo = await detectExpressServer();
        if (serverInfo.isExpress && savedSheetId && !isClientOnlyMode()) {
          await syncTokenToBackend(savedSheetId);
        }
        refreshLocalData();
      },
      async () => {
        setUser(null);
        if (isClientOnlyMode()) {
          const clientUrl = getClientScriptUrl();
          const clientSheetId = getClientSpreadsheetId();
          setGoogleAppsScriptUrl(clientUrl);
          setSpreadsheetId(clientSheetId);
          setNeedsAuth(false);
          setAuthChecking(false);
          refreshLocalData();
        } else {
          try {
            const serverInfo = await detectExpressServer();
            if (serverInfo.isExpress) {
              if (!serverInfo.googleAppsScriptUrl) {
                setNeedsAuth(true);
              } else {
                setNeedsAuth(false);
              }
            } else {
              // Serverless/Vercel static deployment detected (no Node server response)
              console.log("Vercel or client-only serverless hosting detected. Activating direct fallback mode.");
              setNeedsAuth(false);
            }
          } catch {
            setNeedsAuth(false);
          } finally {
            setAuthChecking(false);
            refreshLocalData();
          }
        }
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
    if (isClientOnlyMode()) {
      const clientUrl = getClientScriptUrl();
      if (clientUrl) {
        try {
          // Set local time zone offsets
          setServerTime(new Date().toISOString());
          const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
          setTodayToken(`a10dance-daily-qr-${dateStr}`);

          const emps = await clientFetchEmployees(clientUrl);
          if (emps && emps.length > 0) {
            setEmployeesList(emps);
            updateCachedEmployees(emps);
          }

          const logs = await clientFetchLegacyLogs(clientUrl);
          setAttendanceLogs(logs || []);
          setAppsScriptError(null);
        } catch (err: any) {
          console.error("Client sync error:", err);
          setAppsScriptError(err.message || String(err));
          setEmployeesList(getCachedEmployees());
        }
        return;
      }
    }

    try {
      const serverInfo = await detectExpressServer();
      if (serverInfo.isExpress) {
        setTodayToken(serverInfo.todayToken || '');
        setServerTime(serverInfo.serverTime || '');
        if (serverInfo.spreadsheetId && serverInfo.spreadsheetId !== spreadsheetId) {
          setSpreadsheetId(serverInfo.spreadsheetId);
          setSpreadsheetIdToCache(serverInfo.spreadsheetId);
        } else if (!serverInfo.spreadsheetId && spreadsheetId) {
          setSpreadsheetId(null);
          setSpreadsheetIdToCache(null);
        }

        if (serverInfo.googleAppsScriptUrl) {
          setGoogleAppsScriptUrl(serverInfo.googleAppsScriptUrl);
          setNeedsAuth(false);
        } else {
          setGoogleAppsScriptUrl(null);
        }
        setAppsScriptError(serverInfo.appsScriptError || null);

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
      } else {
        // Direct browser/offline local state when there is no Apps script or server configured yet
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        setTodayToken(`a10dance-daily-qr-${todayStr}`);
        setServerTime(new Date().toISOString());
        setEmployeesList(getCachedEmployees());
      }
    } catch (e) {
      console.warn("Standby Mode: fetching data directly from server offline fallback.");
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
    } catch (e: any) {
      console.error("Authentication error during admin login:", e);
      const isDomainErr = e?.code === 'auth/unauthorized-domain' || e?.message?.includes('unauthorized-domain');
      const domainSuggestion = isDomainErr 
        ? "\n\nCRITICAL VERCEL STEPS:\n1. Open Firebase Console.\n2. Go to Authentication -> Settings -> Authorized Domains.\n3. Add your Vercel deployment domain (e.g., your-app.vercel.app) to the authorized domains list.\n\nWithout this, Firebase blocks authorization popups on Vercel!" 
        : "";
      alert(`Authentication failure. Connection cancelled or domain unauthorized.\n\nDetails: ${e?.message || String(e)}${domainSuggestion}`);
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
       const serverInfo = await detectExpressServer();
       if (serverInfo.isExpress) {
         const status = await syncTokenToBackend(id);
         if (status) {
           setPunchStatus('SUCCESS');
           setStatusMessage('Google Sheets synchronization active! Schema checks validated.');
           setTimeout(() => setPunchStatus('IDLE'), 3000);
         }
       } else {
         // Offline/Vercel standby mode: save spreadsheet id in cache directly
         localStorage.setItem('a10dance_client_spreadsheet_id', id);
         setPunchStatus('SUCCESS');
         setStatusMessage('Google Sheets standalone reference updated.');
         setTimeout(() => setPunchStatus('IDLE'), 3000);
       }
    } else {
       // Disconnect both server and client caches
       localStorage.removeItem('a10dance_client_only_apps_script');
       localStorage.removeItem('a10dance_client_script_url');
       localStorage.removeItem('a10dance_client_spreadsheet_id');
       setGoogleAppsScriptUrl(null);
       setSpreadsheetId(null);
       setSpreadsheetIdToCache(null);
       await fetch('/api/auth/clear-token', { method: 'POST' }).catch(() => {});
    }
    refreshLocalData();
  };

  const handleBindAppsScript = async (id: string, scriptUrl: string) => {
    setPunchStatus('LOADING');
    setStatusMessage('Establishing secure Apps Script tunnel connection...');
    
    let serverOk = false;
    let fallbackMsg = '';

    try {
      const serverInfo = await detectExpressServer();
      if (serverInfo.isExpress) {
        const res = await fetch('/api/auth/save-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: id,
            appsScriptUrl: scriptUrl
          })
        });

        const contentType = res.headers.get("content-type");
        if (res.ok && contentType && contentType.includes("application/json")) {
          const data = await res.json();
          if (data && data.success) {
            serverOk = true;
            // Normal Express server initialization succeeded
            localStorage.removeItem('a10dance_client_only_apps_script');
            localStorage.removeItem('a10dance_client_script_url');
            localStorage.removeItem('a10dance_client_spreadsheet_id');

            setSpreadsheetId(id);
            setSpreadsheetIdToCache(id);
            setGoogleAppsScriptUrl(scriptUrl);
            setNeedsAuth(false);

            setPunchStatus('SUCCESS');
            setStatusMessage('Google Apps Script synchronization initialized permanently! Connection is live.');
            setTimeout(() => setPunchStatus('IDLE'), 5000);
          } else {
            throw new Error(data.error || 'Connection rejected by backend.');
          }
        } else {
          fallbackMsg = 'Server did not return JSON. Starting client-side direct verification...';
        }
      } else {
        fallbackMsg = 'Express backend not detected. Starting client-side direct verification...';
      }
    } catch (e: any) {
      // Network or API route 404 failed - trigger direct client-side fallback
      console.warn("Express endpoint failed/unreached, starting serverless direct handshake fallback.", e);
      fallbackMsg = 'Express backend not detected or returned error. Triggering direct client-side handshake...';
    }

    if (!serverOk) {
      try {
        if (fallbackMsg) {
          setStatusMessage(fallbackMsg);
        }

        // Test the Apps Script URL via our lightweight proxy first to avoid browser CORS / redirect preflight blocks
        let response;
        let viaProxy = false;
        try {
          const proxyTestRes = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scriptUrl: scriptUrl,
              payload: { action: 'get_employees' }
            })
          });
          if (proxyTestRes.ok) {
            response = proxyTestRes;
            viaProxy = true;
          }
        } catch (e) {
          console.warn("Proxy validation route failed, attempting direct fetch fallback...", e);
        }

        if (!response) {
          response = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'get_employees' })
          });
        }

        if (!response.ok) {
          throw new Error(`Google Apps Script directly returned HTTP Error: ${response.status}`);
        }

        const rawText = await response.text();
        const trimmed = rawText.trim();
        if (trimmed.startsWith('<')) {
          if (scriptUrl.includes('/edit') || scriptUrl.includes('/home')) {
            throw new Error("You pasted your Script Editor URL! Please deploy as a Web App (Deploy -> New deployment) and copy the production Web App URL ending in '/exec'.");
          } else if (scriptUrl.includes('/dev')) {
            throw new Error("You pasted a /dev URL! Please deploy as a new production Web App with access 'Anyone'.");
          } else {
            throw new Error("The Web App returned HTML. Ensure 'Execute as' is set to 'Me' and 'Who has access' is 'Anyone' in deploy settings.");
          }
        }

        const parsed = JSON.parse(trimmed);
        if (parsed.success === false) {
          throw new Error(parsed.error || 'Connection rejected by Apps Script Web App.');
        }

        // Direct browser interaction verified successfully! Store in localStorage client-only settings.
        localStorage.setItem('a10dance_client_only_apps_script', 'true');
        localStorage.setItem('a10dance_client_script_url', scriptUrl);
        localStorage.setItem('a10dance_client_spreadsheet_id', id);

        setSpreadsheetId(id);
        setSpreadsheetIdToCache(id);
        setGoogleAppsScriptUrl(scriptUrl);
        setNeedsAuth(false);
        setAppsScriptError(null);

        setPunchStatus('SUCCESS');
        setStatusMessage('Browser-Direct serverless sync active! The application is clocking directly to Google Sheets.');
        setTimeout(() => setPunchStatus('IDLE'), 6000);
      } catch (err: any) {
        setPunchStatus('ERROR');
        setStatusMessage(`Apps Script Connection Failed: ${err.message || 'Verification rejected'}`);
        setTimeout(() => setPunchStatus('IDLE'), 15000);
      }
    }

    refreshLocalData();
  };

  // Bulk roster changes handler
  const handleSaveRoster = async (updatedRoster: Employee[]) => {
    const confirmation = window.confirm('Confirm roster bulk modification? This overwrites matching index rows in your Google Sheet.');
    if (!confirmation) return;

    if (isClientOnlyMode()) {
      const clientUrl = getClientScriptUrl();
      if (clientUrl) {
        try {
          const success = await clientUpdateRoster(clientUrl, updatedRoster);
          if (success) {
            setEmployeesList(updatedRoster);
            updateCachedEmployees(updatedRoster);
            alert('Roster indices compiled and saved successfully directly to Google Sheets!');
          } else {
            throw new Error('Google Sheets roster save failed.');
          }
        } catch (e: any) {
          alert(`Failed to update roster on remote database: ${e.message || String(e)}`);
        }
      }
      return;
    }

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

    if (isClientOnlyMode()) {
      const clientUrl = getClientScriptUrl();
      if (clientUrl) {
        try {
          const result = await clientProcessScan(clientUrl, savedEID, scannedBarcode, 'SCAN', '', lastPunchTimes);
          if (result.success) {
            setPunchStatus('SUCCESS');
            setStatusMessage(result.message || `Punch successfully matching login sequence.`);
            setTimeout(() => setPunchStatus('IDLE'), 6000);
            refreshLocalData();
            if (savedEID === '251805') {
              setShowSpecialModal(true);
            }
          }
        } catch (e: any) {
          setPunchStatus('ERROR');
          setStatusMessage(e.message || 'Security ticket validation error.');
        }
      }
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

    if (isClientOnlyMode()) {
      const clientUrl = getClientScriptUrl();
      if (clientUrl) {
        try {
          const result = await clientProcessScan(clientUrl, eid, '', 'MANUAL', comment, lastPunchTimes);
          if (result.success) {
            setPunchStatus('SUCCESS');
            setStatusMessage(result.message || 'DTR punch validated successfully.');
            setTimeout(() => setPunchStatus('IDLE'), 6000);
            refreshLocalData();
            if (eid.trim() === '251805' && result.action === 'LOGIN') {
              setShowSpecialModal(true);
            }
          }
        } catch (e: any) {
          setPunchStatus('ERROR');
          setStatusMessage(e.message || 'Apps Script rejected manual insertion sequence.');
        }
      }
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
          googleAppsScriptUrl={googleAppsScriptUrl}
          appsScriptError={appsScriptError}
          onBindAppsScript={handleBindAppsScript}
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
