/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Database, 
  ShieldCheck, 
  TableProperties, 
  FileSpreadsheet, 
  UserCheck, 
  LogOut,
  HelpCircle
} from 'lucide-react';
import { User } from 'firebase/auth';

interface TopNavProps {
  onLinesStatus: boolean;
  onOpenAdmin: () => void;
  onOpenReports: () => void;
  isKiosk: boolean;
  onToggleKiosk: () => void;
}

export default function TopNav({
  onLinesStatus,
  onOpenAdmin,
  onOpenReports,
  isKiosk,
  onToggleKiosk
}: TopNavProps) {
  return (
    <nav className="border-b border-zinc-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* PCC Logo and Title */}
          <div className="flex items-center space-x-3">
            <img 
              src="https://raw.githubusercontent.com/251805/sirpacheck/main/PCCLogo.png" 
              alt="PCC Logo" 
              className="h-10 w-10 object-contain rounded-xl"
              referrerPolicy="no-referrer"
            />
            <div>
              <h1 className="font-sans text-base font-semibold tracking-tight text-zinc-900">
                Pagbilao Command Center
              </h1>
              <span className="font-mono text-[10px] text-zinc-400 font-medium">
                DTR TRACKER V1.0
              </span>
            </div>
          </div>

          {/* Core Controls */}
          <div className="flex items-center space-x-4">
            {/* Network Sockets Status */}
            <div 
              className={`flex items-center space-x-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-medium transition-all ${
                onLinesStatus 
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
              }`}
            >
              {onLinesStatus ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
                  <span>ONLINE</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-rose-600" />
                  <span>LOCAL ONLY</span>
                </>
              )}
            </div>

            {/* General Actions Nav */}
            <div className="flex items-center space-x-2 border-l border-zinc-200 pl-4">
              {/* Kiosk Mode Toggle */}
              <button
                onClick={onToggleKiosk}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-sans text-xs font-medium transition-all ${
                  isKiosk 
                    ? 'bg-zinc-950 text-white hover:bg-zinc-850' 
                    : 'bg-zinc-50 text-zinc-650 hover:bg-zinc-150'
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${isKiosk ? 'bg-orange-500 animate-pulse' : 'bg-transparent'}`} />
                <span>{isKiosk ? 'Exit Kiosk' : 'QR Code'}</span>
              </button>

              {/* Reports Dashboard */}
              <button
                onClick={onOpenReports}
                className="flex items-center space-x-1.5 rounded-lg px-2.5 py-1.5 font-sans text-xs font-medium text-zinc-650 hover:bg-zinc-100"
              >
                <TableProperties className="h-4 w-4 text-zinc-500" />
                <span className="hidden md:inline">Reports</span>
              </button>

              {/* Roster Controls */}
              <button
                onClick={onOpenAdmin}
                className="flex items-center space-x-1.5 rounded-lg px-2.5 py-1.5 font-sans text-xs font-medium text-zinc-650 hover:bg-zinc-100"
              >
                <ShieldCheck className="h-4 w-4 text-zinc-500" />
                <span className="hidden md:inline">Admin Panel</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
