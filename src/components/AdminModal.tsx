/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Trash2, 
  UserPlus, 
  Save, 
  Database,
  Lock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  UserCheck,
  LogOut
} from 'lucide-react';
import { Employee } from '../types';

const APPS_SCRIPT_PROTOTYPE = `/**
 * Google Sheets Proxy for Permanent Sync (PCC Attendance V1)
 * Paste this code in Extensions -> Apps Script, then deploy as a Web App:
 * - Execute as: Me (your Google account)
 * - Who has access: Anyone
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var payload = JSON.parse(rawData);
    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Auto-create sheets if they don't exist
    ensureSheetsExist(ss);

    if (action === 'get_employees') {
      var data = getSheetData(ss, 'employees');
      return ContentService.createTextOutput(JSON.stringify({ values: data }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'get_raw_attendance') {
      var data = getSheetData(ss, 'attendance');
      return ContentService.createTextOutput(JSON.stringify({ values: data }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'get_sessions') {
      var data = getSheetData(ss, 'attendance_sessions');
      return ContentService.createTextOutput(JSON.stringify({ values: data }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'get_legacy_logs') {
      var data = getSheetData(ss, 'attendance_logs');
      return ContentService.createTextOutput(JSON.stringify({ values: data }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'save_roster_update') {
      var sheet = ss.getSheetByName('employees');
      sheet.clearContents();
      sheet.appendRow(['ID', 'EID', 'Name', 'DailyRate', 'PhilHealth']);
      var list = payload.roster;
      for (var i = 0; i < list.length; i++) {
        sheet.appendRow([list[i].id, list[i].eid, list[i].name, list[i].rate_per_day, list[i].philhealth]);
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'save_raw_attendance') {
      var sheet = ss.getSheetByName('attendance');
      var item = payload.attendance;
      sheet.appendRow([item.id, item.employee_id, item.action, item.source, item.timestamp, item.remarks]);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'process_session_and_legacy') {
      var session = payload.session;
      var legacy = payload.legacy;
      
      // 1. Session Updates
      var sSheet = ss.getSheetByName('attendance_sessions');
      var sData = sSheet.getDataRange().getValues();
      var foundSIndex = -1;
      if (session.id) {
        for (var i = 1; i < sData.length; i++) {
          if (String(sData[i][0]).trim() === String(session.id).trim()) {
            foundSIndex = i + 1;
            break;
          }
        }
      }
      if (foundSIndex !== -1) {
        sSheet.getRange(foundSIndex, 4).setValue(session.logout_at);
      } else {
        sSheet.appendRow([session.id, session.employee_id, session.login_at, session.logout_at || '', session.date]);
      }
      
      // 2. Legacy Log Updates
      var lSheet = ss.getSheetByName('attendance_logs');
      var lData = lSheet.getDataRange().getValues();
      var foundLIndex = -1;
      
      for (var j = lData.length - 1; j >= 1; j--) {
        if (String(lData[j][1]).trim() === String(legacy.eid).trim() && !lData[j][4]) {
          foundLIndex = j + 1;
          break;
        }
      }
      
      if (foundLIndex !== -1) {
        lSheet.getRange(foundLIndex, 4).setValue(legacy.start_time);
        lSheet.getRange(foundLIndex, 5).setValue(legacy.end_time);
        lSheet.getRange(foundLIndex, 6).setValue(legacy.date);
        lSheet.getRange(foundLIndex, 7).setValue(legacy.remarks);
        lSheet.getRange(foundLIndex, 8).setValue(legacy.tardiness);
        lSheet.getRange(foundLIndex, 9).setValue(legacy.undertime);
      } else {
        lSheet.appendRow([
          legacy.id,
          legacy.eid,
          legacy.name,
          legacy.start_time,
          legacy.end_time || '',
          legacy.date,
          legacy.remarks || '',
          legacy.tardiness || 0,
          legacy.undertime || 0
        ]);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown action' }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Google Sheets Web App Proxy is Active.").setMimeType(ContentService.MimeType.TEXT);
}

function ensureSheetsExist(ss) {
  var required = {
    'employees': ['ID', 'EID', 'Name', 'DailyRate', 'PhilHealth'],
    'attendance': ['ID', 'EmployeeID', 'Action', 'Source', 'Timestamp', 'Remarks'],
    'attendance_sessions': ['ID', 'EmployeeID', 'LoginAt', 'LogoutAt', 'Date'],
    'attendance_logs': ['ID', 'EID', 'Name', 'StartTime', 'EndTime', 'Date', 'Remarks', 'Tardiness', 'Undertime']
  };
  for (var name in required) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(required[name]);
    }
  }
}

function getSheetData(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var mapped = row.map(function(cell) {
      if (cell instanceof Date) {
        return cell.toISOString();
      }
      return cell;
    });
    list.push(mapped);
  }
  return list;
}
`;

interface AdminModalProps {
  onClose: () => void;
  onSaveRoster: (roster: Employee[]) => Promise<void>;
  employeesList: Employee[];
  spreadsheetId: string | null;
  googleAppsScriptUrl: string | null;
  appsScriptError?: string | null;
  onBindAppsScript: (id: string, scriptUrl: string) => Promise<void>;
  onSaveSpreadsheetId: (id: string) => void;
  user: any;
  needsAuth: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export default function AdminModal({
  onClose,
  onSaveRoster,
  employeesList,
  spreadsheetId,
  googleAppsScriptUrl,
  appsScriptError,
  onBindAppsScript,
  onSaveSpreadsheetId,
  user,
  needsAuth,
  onLogin,
  onLogout
}: AdminModalProps) {
  // Authorization State
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminRole, setAdminRole] = useState<'TEAMS' | 'ROOT' | null>(null);
  const [authError, setAuthError] = useState('');
  
  // Login input states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Google Spreadsheet active connection ID edit state
  const [tempId, setTempId] = useState(spreadsheetId || '');
  const [tempScriptUrl, setTempScriptUrl] = useState(googleAppsScriptUrl || '');
  const [showAppsScriptGuide, setShowAppsScriptGuide] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    setTempId(spreadsheetId || '');
  }, [spreadsheetId]);

  useEffect(() => {
    setTempScriptUrl(googleAppsScriptUrl || '');
  }, [googleAppsScriptUrl]);

  const handleSubmitId = (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = tempId.trim();
    const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const normalizedId = urlMatch && urlMatch[1] ? urlMatch[1] : rawId;
    onSaveSpreadsheetId(normalizedId);
    setTempId(normalizedId);
  };

  const handleBindAppsScriptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = tempId.trim();
    const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const normalizedId = urlMatch && urlMatch[1] ? urlMatch[1] : rawId;
    const scriptUrl = tempScriptUrl.trim();
    if (!normalizedId || !scriptUrl) {
      alert("Please supply both your spreadsheet ID and deployed Google Apps Script Web App URL.");
      return;
    }
    onBindAppsScript(normalizedId, scriptUrl);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(APPS_SCRIPT_PROTOTYPE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 3000);
  };

  const handleDisconnectAll = async () => {
    const confirmTerm = window.confirm("Are you sure you want to completely unbind this Spreadsheet connection and switch back to server-local cache storage?");
    if (!confirmTerm) return;
    onSaveSpreadsheetId('');
  };

  // Spreadsheets list edit states
  const [roster, setRoster] = useState<Employee[]>([]);
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS' | 'ERROR'>('IDLE');

  // New Employee fields
  const [newEID, setNewEID] = useState('');
  const [newName, setNewName] = useState('');
  const [newDailyRate, setNewDailyRate] = useState(800);
  const [newPhilhealth, setNewPhilhealth] = useState(300);

  useEffect(() => {
    setRoster([...employeesList]);
  }, [employeesList]);

  // Auth gate checks (Section 6, Admin login parameters)
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const u = username.trim().toLowerCase();
    const p = password;

    if (u === 'admin' && p === '2026pcc2026') {
      setIsAdmin(true);
      setAdminRole('TEAMS');
    } else if (u === 'lee' && p === 'metallica') {
      setIsAdmin(true);
      setAdminRole('ROOT');
    } else {
      setAuthError('Incorrect operator username or clearance code password.');
    }
  };

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEid = newEID.trim();
    const cleanName = newName.trim();

    if (!cleanEid || !cleanName) return;

    // Check unique
    if (roster.some(e => e.eid === cleanEid)) {
      alert(`Worker ID [${cleanEid}] is already registered inside roster list.`);
      return;
    }

    const item: Employee = {
      id: `emp_${Date.now()}`,
      eid: cleanEid,
      name: cleanName,
      rate_per_day: Number(newDailyRate) || 0,
      philhealth: Number(newPhilhealth) || 0
    };

    setRoster([...roster, item]);
    
    // reset inputs
    setNewEID('');
    setNewName('');
    setNewDailyRate(800);
    setNewPhilhealth(300);
  };

  const handleUpdateRowField = (eid: string, field: keyof Employee, value: any) => {
    // Only ROOT superadmins are permitted to adjust wages and rates!
    if (adminRole !== 'ROOT' && (field === 'rate_per_day' || field === 'philhealth')) {
      alert('Clearance warning: Level [TEAMS] cannot adjust financial wages or PhilHealth tables. Access denied.');
      return;
    }

    setRoster(prev => prev.map(row => {
      if (row.eid === eid) {
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  const handleDeleteItem = (eid: string) => {
    const confirmation = window.confirm(`Permanently wipe EID ${eid} from the crew list? Active session logs can become unlinked.`);
    if (!confirmation) return;
    setRoster(prev => prev.filter(row => row.eid !== eid));
  };

  const handleSaveBulk = async () => {
    setSaveStatus('SAVING');
    try {
      await onSaveRoster(roster);
      setSaveStatus('SUCCESS');
      setTimeout(() => setSaveStatus('IDLE'), 3000);
    } catch {
      setSaveStatus('ERROR');
    }
  };

  // If locked, show security gate form
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-50 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white border border-zinc-200 shadow-2xl p-6 relative">
          
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 rounded-lg p-1.5"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex flex-col items-center text-center space-y-2 mb-6">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="font-sans font-semibold text-zinc-950">Credential Security Lock</h3>
            <p className="font-sans text-[11px] text-zinc-500 max-w-xs leading-relaxed">
              DTR sheets and employee roster structures are secured behind administrator levels. Confirm credential.
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authError && (
              <div className="text-[10px] font-sans text-rose-600 bg-rose-50 border border-rose-150 rounded-lg p-2.5">
                {authError}
              </div>
            )}

            <div className="space-y-1">
              <label className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin, lee"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-800 outline-none focus:border-orange-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-800 pr-10 outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-650"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-sans text-xs font-semibold py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all"
            >
              Verify Clearance Code
            </button>
          </form>

        </div>
      </div>
    );
  }

  // Visual layout if authorized
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-white border border-zinc-200 shadow-2xl p-6 flex flex-col justify-between overflow-hidden">
        
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4 mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <Database className="h-5 w-5 text-orange-600" />
              <h3 className="font-sans font-bold text-sm text-zinc-950">Active Personnel Roster Spreadsheet</h3>
            </div>
            <p className="font-sans text-[10px] text-zinc-400 mt-0.5 uppercase tracking-wide">
              Logged as: <strong className="text-orange-600 font-bold">Role: {adminRole}</strong> ({adminRole === 'ROOT' ? 'Unrestricted Edit Access' : 'No Financial Edit Cleared'})
            </p>
          </div>
          <button 
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-zinc-100 transition-colors"
          >
            <X className="h-4 w-4 text-zinc-400 hover:text-zinc-650" />
          </button>
        </div>

        {/* Spreadsheets body container */}
        <div className="flex-1 overflow-y-auto space-y-6 min-h-[40vh] pr-2">

          {/* Google Sheets Integration Section */}
          <div className="bg-orange-50/20 border border-orange-100 p-5 rounded-2xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-orange-100/60 pb-3">
              <div>
                <h4 className="font-sans text-xs font-semibold text-zinc-900">Google Sheets Integration Panel</h4>
                <p className="font-sans text-[10px] text-zinc-500">
                  Configure bulletproof persistent synchronization for roster lists, attendance clock records, and time logs.
                </p>
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase tracking-wider ${spreadsheetId ? (googleAppsScriptUrl ? 'bg-emerald-50 text-emerald-700 border border-emerald-150' : 'bg-indigo-50 text-indigo-700 border border-indigo-150') : 'bg-amber-50 text-amber-700 border border-amber-150'}`}>
                  {spreadsheetId ? (googleAppsScriptUrl ? 'Permanent Apps Script Sync' : 'Active Google Session Sync') : 'Standby / Local Fallback'}
                </span>
              </div>
            </div>

            {googleAppsScriptUrl ? (
              /* Option B Connected Layout */
              <div className="space-y-4">
                {appsScriptError ? (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-2.5 text-rose-900 shadow-sm animate-pulse">
                    <div className="flex items-center space-x-2 font-sans text-xs font-bold uppercase tracking-wider text-rose-800">
                      <span>⚠️ Sync Connectivity Interrupted</span>
                    </div>
                    <p className="font-sans text-[11.5px] text-rose-800 leading-relaxed font-medium">
                      Your configured Apps Script URL is returning invalid responses (e.g., HTML login/authorization redirects instead of JSON data). Click records are stored safely in local server battery cache:
                    </p>
                    <div className="bg-white/90 p-3 rounded-lg border border-rose-100 font-mono text-[10.5px] text-rose-950 whitespace-pre-wrap select-all leading-relaxed">
                      {appsScriptError}
                    </div>
                    <p className="font-sans text-[10px] text-rose-700 leading-normal pt-1">
                      <strong>How to fix this:</strong> Open your Google Apps Script editor, click <strong>Deploy &rarr; New deployment</strong> (or Manage Deployments &rarr; Edit), verify that <strong>Execute as:</strong> "Me" and <strong>Who has access:</strong> "Anyone" are selected, authorize any requested permissions popups, click Deploy, and then copy &amp; paste the produced production web app URL!
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50/40 border border-emerald-100/60 rounded-xl p-4 space-y-3">
                    <div className="flex items-center space-x-2 text-emerald-800">
                      <UserCheck className="h-4 w-4" />
                      <span className="font-sans text-xs font-bold uppercase tracking-wide">Option B (Permanent Sync) is Live</span>
                    </div>
                    <p className="font-sans text-[11px] text-zinc-600 leading-relaxed">
                      Connected in permanent bypass mode! Attendance logs are permanently synchronized directly to Google Sheets through your securely deployed Google Apps Script bridge. No re-logins or session timeouts will occur.
                    </p>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="bg-white/80 p-2.5 rounded-lg border border-zinc-200 truncate">
                    <span className="block font-mono text-[8px] font-bold uppercase text-zinc-400">Synchronized Spreadsheet ID</span>
                    <span className="font-mono text-[10px] text-zinc-700 select-all" title={spreadsheetId || ''}>{spreadsheetId}</span>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-lg border border-zinc-200 truncate">
                    <span className="block font-mono text-[8px] font-bold uppercase text-zinc-400">Apps Script Web App Endpoint</span>
                    <span className="font-mono text-[10px] text-zinc-700 select-all" title={googleAppsScriptUrl}>{googleAppsScriptUrl}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleDisconnectAll}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 text-rose-600 rounded-lg font-sans text-[10px] font-semibold transition-colors cursor-pointer"
                  >
                    Unbind Connection (Go Offline/Standby)
                  </button>
                </div>
              </div>
            ) : spreadsheetId && !needsAuth ? (
              /* Option A Connected Layout */
              <div className="space-y-4">
                <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-indigo-800">
                    <UserCheck className="h-4 w-4" />
                    <span className="font-sans text-xs font-bold uppercase tracking-wide">Option A (Standard Session Sync) is Live</span>
                  </div>
                  <p className="font-sans text-[11px] text-zinc-600 leading-relaxed">
                    Browser session proxy connected to spreadsheet. However, standard browser session tokens expire every 60 minutes and request manual admin re-login. We strongly recommend switching to Option B below for seamless, permanent background syncing.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="bg-white/80 p-2.5 rounded-lg border border-indigo-100 truncate">
                      <span className="block font-mono text-[8px] font-bold uppercase text-zinc-400">Authorized Admin</span>
                      <span className="font-sans text-xs text-zinc-700">{user?.displayName || 'Authorized Account'} ({user?.email})</span>
                    </div>

                    <div className="bg-white/80 p-2.5 rounded-lg border border-indigo-100 truncate">
                      <span className="block font-mono text-[8px] font-bold uppercase text-zinc-400">Active Spreadsheet ID</span>
                      <span className="font-mono text-[10px] text-zinc-700 select-all" title={spreadsheetId}>{spreadsheetId}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={onLogout}
                      className="px-2.5 py-1.5 font-sans text-[10px] text-zinc-500 hover:text-rose-600 transition-colors cursor-pointer"
                    >
                      Sign Out Account
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectAll}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 text-rose-600 rounded-lg font-sans text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      Unbind Connection
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Unconnected state: display choice of Option B or Option A */
              <div className="space-y-4">
                <p className="font-sans text-[11px] text-zinc-500 italic leading-relaxed bg-white p-3.5 border border-zinc-100 rounded-xl">
                  Google Sheet integration is currently disconnected. App clock records are stored safely in local server battery cache. Pick a sync option below to connect.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* OPTION B (RECOMMENDED) */}
                  <div className="bg-white border border-emerald-100 hover:border-emerald-200 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-sm">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="bg-emerald-50 text-emerald-800 text-[8px] font-bold uppercase px-2 py-0.5 rounded">Option B</span>
                        <span className="text-[9px] font-sans font-semibold text-emerald-600">Bulletproof & Permanent ★</span>
                      </div>
                      <h5 className="font-sans text-xs font-bold text-zinc-800">Google Apps Script Web App sync</h5>
                      <p className="font-sans text-[10px] text-zinc-500 leading-normal">
                        Bypass all Google token timeouts using a custom proxy web app. Sync is permanent and operates automatically in the background forever on free Google accounts. No re-logins needed!
                      </p>
                    </div>

                    <div className="pt-2 border-t border-zinc-100 space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowAppsScriptGuide(!showAppsScriptGuide)}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-sans font-medium underline flex items-center gap-1 cursor-pointer"
                      >
                        {showAppsScriptGuide ? "Hide Setup Instructions" : "Show Setup Instructions & App Code"}
                      </button>

                      {showAppsScriptGuide && (
                        <div className="bg-zinc-50 border border-zinc-200 p-3 rounded-lg space-y-2.5 max-h-[220px] overflow-y-auto">
                          <p className="font-sans text-[9px] text-zinc-655 leading-normal">
                            1. Open your target Google Spreadsheet. Make sure it is completely public (anyone with link can access) or share permissions are set.<br />
                            2. Click <strong>Extensions &rarr; Apps Script</strong>.<br />
                            3. Under Project Code, clean current script and paste the copyable template.<br />
                            4. Click <strong>Deploy &rarr; New deployment</strong>. Select type as <strong>Web app</strong>.<br />
                            5. Set <strong>Execute as:</strong> "Me" and <strong>Who has access:</strong> "Anyone". Run it.<br />
                            6. Copy the generated Web App URL and paste it below alongside your Sheet ID!
                          </p>
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            className={`w-full py-1.5 rounded text-[10px] font-sans font-medium text-white transition-colors cursor-pointer ${copiedCode ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-950'}`}
                          >
                            {copiedCode ? "✓ Copied Macro Code!" : "Copy Full Apps Script Code Template"}
                          </button>
                        </div>
                      )}

                      <form onSubmit={handleBindAppsScriptSubmit} className="space-y-2">
                        <div className="space-y-1">
                          <label className="block font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-400">Google Sheet ID or URL</label>
                          <input
                            type="text"
                            required
                            value={tempId}
                            onChange={(e) => setTempId(e.target.value)}
                            placeholder="e.g. 1aBCdEfGhIjK... or copy URL"
                            className="w-full rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 font-mono text-[10px] text-zinc-800 outline-none focus:border-emerald-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-400">Apps Script Web App URL</label>
                          <input
                            type="text"
                            required
                            value={tempScriptUrl}
                            onChange={(e) => setTempScriptUrl(e.target.value)}
                            placeholder="https://script.google.com/macros/s/.../exec"
                            className="w-full rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 font-mono text-[10px] text-zinc-800 outline-none focus:border-emerald-500"
                          />
                        </div>

                        <button
                          type="submit"
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[10.5px] font-semibold py-2 rounded-lg transition-colors cursor-pointer"
                        >
                          Establish Permanent Sync
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* OPTION A */}
                  <div className="bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-sm">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="bg-zinc-100 text-zinc-700 text-[8px] font-bold uppercase px-2 py-0.5 rounded">Option A</span>
                        <span className="text-[9px] font-sans font-semibold text-amber-600">Standard OAuth</span>
                      </div>
                      <h5 className="font-sans text-xs font-bold text-zinc-800">Direct Google Popup login</h5>
                      <p className="font-sans text-[10px] text-zinc-500 leading-normal">
                        Use full authorization protocols inside your web browser. This popups Google permission fields, let us sync immediately, but OAuth connection tokens expire after 1 hour and must be signed in again next time.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-zinc-100 space-y-3">
                      <div className="space-y-2">
                        <div className="space-y-1 font-sans">
                          <label className="block font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-400">Google Sheet ID or URL</label>
                          <input
                            type="text"
                            value={tempId}
                            onChange={(e) => setTempId(e.target.value)}
                            placeholder="e.g. 1aBCdEfGhIjK..."
                            className="w-full rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 font-mono text-[10px] text-zinc-800 outline-none focus:border-indigo-500"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (!tempId.trim()) {
                              alert("Please paste your target spreadsheet ID or URL first, then click connection login.");
                              return;
                            }
                            const rawId = tempId.trim();
                            const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                            const normalizedId = urlMatch && urlMatch[1] ? urlMatch[1] : rawId;
                            onSaveSpreadsheetId(normalizedId);
                            onLogin();
                          }}
                          className="w-full inline-flex items-center justify-center space-x-1 hover:bg-zinc-100 text-zinc-700 font-sans text-[10.5px] font-semibold py-2 rounded-lg border border-zinc-200 shadow-sm transition-colors cursor-pointer"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Login & Sync Standard OAuth</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Add Employee Form */}
          <form onSubmit={handleAddEmployee} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-zinc-50 border border-zinc-200 p-4 rounded-2xl">
            <div className="space-y-1">
              <label className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">Personnel EID</label>
              <input
                type="text"
                required
                value={newEID}
                onChange={(e) => setNewEID(e.target.value)}
                placeholder="e.g. 251805"
                className="w-full rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block font-sans text-[9px] font-bold uppercase tracking-wider text-zinc-400">Full Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Officer Juan"
                className="w-full rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 font-sans text-xs outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block font-sans text-[9px] font-bold uppercase tracking-wider text-zinc-400">Daily Salary (₱)</label>
              <input
                type="number"
                disabled={adminRole !== 'ROOT'}
                value={newDailyRate}
                onChange={(e) => setNewDailyRate(Number(e.target.value))}
                className="w-full rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 font-sans text-xs outline-none focus:border-orange-500 disabled:opacity-50"
              />
            </div>
            <div className="space-y-1 flex flex-col justify-end">
              <button
                type="submit"
                className="w-full flex items-center justify-center space-x-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-sans text-xs font-semibold py-2 shadow-sm transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Register Crew</span>
              </button>
            </div>
          </form>

          {/* Roster Spreadsheet Grid */}
          <div className="border border-zinc-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">EID</th>
                  <th className="px-4 py-3">Full Name</th>
                  <th className="px-4 py-3">Daily Wage (₱)</th>
                  <th className="px-4 py-3">PhilHealth contribution (₱)</th>
                  <th className="px-4 py-3 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 font-sans text-xs">
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-zinc-400 font-sans">
                      Roster list is currently blank. Register crews above.
                    </td>
                  </tr>
                ) : (
                  roster.map((row) => (
                    <tr key={row.eid} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-2 font-mono font-semibold text-zinc-900">
                        {row.eid}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => handleUpdateRowField(row.eid, 'name', e.target.value)}
                          className="bg-transparent border-0 font-sans text-xs text-zinc-900 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white rounded px-1.5 py-0.5 w-full"
                        />
                      </td>
                      <td className="px-4 py-2 font-mono">
                        <input
                          type="number"
                          value={row.rate_per_day}
                          disabled={adminRole !== 'ROOT'}
                          onChange={(e) => handleUpdateRowField(row.eid, 'rate_per_day', Number(e.target.value))}
                          className="bg-transparent border-0 font-mono text-xs text-zinc-900 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white rounded px-1.5 py-0.5 w-32 disabled:opacity-60"
                        />
                      </td>
                      <td className="px-4 py-2 font-mono">
                        <input
                          type="number"
                          value={row.philhealth}
                          disabled={adminRole !== 'ROOT'}
                          onChange={(e) => handleUpdateRowField(row.eid, 'philhealth', Number(e.target.value))}
                          className="bg-transparent border-0 font-mono text-xs text-zinc-900 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white rounded px-1.5 py-0.5 w-32 disabled:opacity-60"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDeleteItem(row.eid)}
                          className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>

        {/* Footer actions */}
        <div className="border-t border-zinc-100 pt-4 flex justify-between items-center mt-4">
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">
            ROSTER ENTRIES COPIED: {roster.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 font-sans text-xs font-semibold text-zinc-500 hover:bg-zinc-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveBulk}
              disabled={saveStatus === 'SAVING'}
              className="flex items-center space-x-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-sans text-xs font-semibold px-4 py-2 rounded-lg shadow-md transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>
                {saveStatus === 'SAVING' ? 'Syncing...' : 
                 saveStatus === 'SUCCESS' ? 'Roster Synced!' : 'Apply & Save Roster'}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
