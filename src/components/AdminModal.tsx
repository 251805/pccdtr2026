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

interface AdminModalProps {
  onClose: () => void;
  onSaveRoster: (roster: Employee[]) => Promise<void>;
  employeesList: Employee[];
  spreadsheetId: string | null;
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

  useEffect(() => {
    setTempId(spreadsheetId || '');
  }, [spreadsheetId]);

  const handleSubmitId = (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = tempId.trim();
    const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const normalizedId = urlMatch && urlMatch[1] ? urlMatch[1] : rawId;
    onSaveSpreadsheetId(normalizedId);
    setTempId(normalizedId);
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
