/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Scan, 
  ChevronDown, 
  ChevronUp, 
  User, 
  Signpost, 
  Clock, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { getSavedEID, setSavedEID } from '../lib/db';

interface AttendanceCardProps {
  onScanClick: () => void;
  onManualPunch: (eid: string, action: 'LOGIN' | 'LOGOUT', comment?: string) => void;
  pendingStatus: 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';
  statusMessage: string;
}

export default function AttendanceCard({
  onScanClick,
  onManualPunch,
  pendingStatus,
  statusMessage
}: AttendanceCardProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [savedEid, setLocalSavedEid] = useState('');
  const [showIdentityRegister, setShowIdentityRegister] = useState(false);
  
  // Registration forms
  const [registerEid, setRegisterEid] = useState('');
  
  // Manual punch forms
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualEid, setManualEid] = useState('');
  const [remarks, setRemarks] = useState('');

  // Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Hydrate local EID on mount
  useEffect(() => {
    const eid = getSavedEID();
    setLocalSavedEid(eid);
    if (!eid) {
      setShowIdentityRegister(true);
    } else {
      setManualEid(eid); // prefill manual EID with identified EID
    }
  }, []);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = registerEid.trim();
    if (!clean) return;
    setSavedEID(clean);
    setLocalSavedEid(clean);
    setManualEid(clean);
    setShowIdentityRegister(false);
  };

  const handleClearIdentity = () => {
    setSavedEID('');
    setLocalSavedEid('');
    setManualEid('');
    setShowIdentityRegister(true);
  };

  const formattedTime = currentTime.toLocaleTimeString('en-US', {
    hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="mx-auto max-w-lg w-full px-4 py-8">
      <div className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-xl space-y-6">
        
        {/* Real Time clock display */}
        <div className="text-center space-y-1.5 pb-4 border-b border-zinc-100">
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-400 uppercase flex items-center justify-center space-x-1.5 animate-pulse">
            <Clock className="h-4 w-4 text-orange-600" />
            <span>Clock Synchronized (GMT+8)</span>
          </span>
          <div className="font-mono font-bold text-4xl sm:text-5xl tracking-tight text-zinc-900 tabular-nums leading-none">
            {formattedTime}
          </div>
          <p className="font-sans text-xs text-zinc-500 font-medium">
            {formattedDate}
          </p>
        </div>

        {/* Sync loading status alerts */}
        {pendingStatus !== 'IDLE' && (
          <div className={`rounded-2xl p-4 flex items-start space-x-3 text-xs leading-relaxed border transition-all ${
            pendingStatus === 'LOADING' ? 'bg-zinc-50 border-zinc-200 text-zinc-650' :
            pendingStatus === 'SUCCESS' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            'bg-rose-50 border-rose-200 text-rose-700'
          }`}>
            {pendingStatus === 'LOADING' && (
              <div className="h-4 w-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            {pendingStatus === 'SUCCESS' && (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            )}
            {pendingStatus === 'ERROR' && (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <p className="font-sans font-medium">{statusMessage}</p>
          </div>
        )}

        {/* Identity session manager */}
        <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-sans text-xs font-semibold text-zinc-700">
              Mobile Device Identity State
            </span>
            {savedEid && (
              <button 
                onClick={handleClearIdentity}
                className="font-mono text-[9px] font-bold text-rose-600 uppercase hover:underline"
              >
                Forget device
              </button>
            )}
          </div>

          {savedEid ? (
            <div className="flex items-center justify-between bg-white border border-zinc-200 rounded-xl px-3 py-2.5">
              <div className="flex items-center space-x-2.5">
                <User className="h-4 w-4 text-orange-600" />
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-850">
                    EID: {savedEid}
                  </div>
                  <div className="font-sans text-[10px] text-zinc-400 capitalize">
                    Browser verified session
                  </div>
                </div>
              </div>
              <span className="font-mono text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full uppercase">
                PINNED
              </span>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3 bg-white border border-zinc-200 rounded-xl p-3">
              <p className="font-sans text-[10px] text-zinc-400 leading-relaxed">
                Save your EID to bind your device.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Employee EID (e.g. 251805)"
                  value={registerEid}
                  onChange={(e) => setRegisterEid(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 font-mono text-xs outline-none focus:border-orange-500"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-orange-600 px-3.5 py-2 font-sans text-xs font-semibold text-white hover:bg-orange-700 transition-colors"
                >
                  Save ID
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Scanner card Trigger */}
        <button
          onClick={onScanClick}
          className="relative w-full aspect-[4/1.8] rounded-2xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-center space-y-2 overflow-hidden group select-none transition-all shadow-lg active:scale-[0.98]"
        >
          {/* subtle scanning laser effect */}
          <div className="absolute inset-0 bg-gradient-to-b from-orange-500/10 to-transparent translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-[1500ms] ease-in-out pointer-events-none" />
          
          <Scan className="h-7 w-7 text-orange-500 transition-transform group-hover:scale-110" />
          <div className="text-center">
            <span className="font-sans text-xs font-bold text-white uppercase tracking-wider block">
              [ USE CAMERA TO SCAN QR CODE ]
            </span>
            <span className="font-sans text-[10px] text-zinc-500">
              Compatible with iOS & Android Camera scans
            </span>
          </div>
        </button>

        {/* Manual Keyboard entry Accordion */}
        <div className="border-t border-zinc-100 pt-4">
          <button
            onClick={() => setShowManualInput(!showManualInput)}
            className="w-full flex items-center justify-between font-sans text-xs font-medium text-zinc-650 hover:text-orange-600 transition-colors py-1"
          >
            <span>Enter EID (Manual Logs)</span>
            {showManualInput ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showManualInput && (
            <div className="space-y-4 pt-3 mt-1 animate-fadeIn">
              <div className="space-y-1.5">
                <label className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  Employee EID
                </label>
                <input
                  type="text"
                  required
                  value={manualEid}
                  onChange={(e) => setManualEid(e.target.value)}
                  placeholder="Type ID, e.g. 251805"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-800 outline-none focus:border-orange-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  Deployment / Shift Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Field assignment, Delayed dispatch"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-sans text-xs text-zinc-800 outline-none focus:border-orange-500"
                />
              </div>

              {/* punch controls */}
              <div className="grid grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => onManualPunch(manualEid, 'LOGIN', remarks)}
                  className="rounded-xl border border-emerald-500 hover:bg-emerald-500/10 text-emerald-700 py-3 font-sans text-xs font-bold transition-all hover:shadow"
                >
                  CLOCK IN
                </button>
                <button
                  type="button"
                  onClick={() => onManualPunch(manualEid, 'LOGOUT', remarks)}
                  className="rounded-xl border border-rose-500 hover:bg-rose-500/10 text-rose-700 py-3 font-sans text-xs font-bold transition-all hover:shadow"
                >
                  CLOCK OUT
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
