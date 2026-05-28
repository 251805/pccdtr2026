/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, ShieldAlert, BadgeCheck } from 'lucide-react';

interface SpecialEmployeeModalProps {
  onClose: () => void;
}

export default function SpecialEmployeeModal({ onClose }: SpecialEmployeeModalProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-md z-50 p-4 animate-fadeIn">
      <div className="w-full max-w-md rounded-3xl bg-white border border-zinc-200 shadow-2xl overflow-hidden relative flex flex-col items-center">
        
        {/* Subtle decorative top block */}
        <div className="w-full h-2 bg-gradient-to-r from-orange-500 to-amber-500" />

        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-650 rounded-full p-2 hover:bg-zinc-100 transition-colors z-10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 flex flex-col items-center text-center w-full">
          {/* Welcome status identifier badge */}
          <div className="flex items-center space-x-1 bg-orange-50 text-orange-700 border border-orange-100 rounded-full px-3 py-1 text-xs font-mono font-bold tracking-wider uppercase mb-4 animate-bounce">
            <BadgeCheck className="h-4 w-4 text-orange-600" />
            <span>Welcome, Officer 251805</span>
          </div>

          <h3 className="font-sans font-extrabold text-xl text-zinc-900 tracking-tight leading-none mb-1">
            System Identity Match
          </h3>
          <p className="font-sans text-xs text-zinc-400 mb-5">
            Officer Lee • Verified Personnel Login
          </p>

          {/* Secure Photo visual frame */}
          <div className="relative w-full aspect-square max-w-[280px] bg-zinc-100 rounded-2xl border border-zinc-200 shadow-inner overflow-hidden flex items-center justify-center mb-5 group">
            {/* Soft backdrop radial glow */}
            <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/5 to-transparent pointer-events-none" />
            
            <img 
              src="https://raw.githubusercontent.com/251805/etcfile/main/lee.jpeg" 
              alt="Security Photo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover select-none transition-transform duration-500 group-hover:scale-105"
              onError={(e) => {
                // If raw.githubusercontent doesn't load directly, retry URL formats
                console.warn("Direct raw image fetch fallback active.");
              }}
            />
          </div>

          <div className="flex items-start bg-zinc-50 border border-zinc-150 rounded-xl p-3 text-left space-x-2.5 w-full">
            <ShieldAlert className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <span className="font-sans text-[11px] text-zinc-500 leading-relaxed">
              Clearance level verified. Access log records matching Officer Lee have been securely synchronized into your local active sheet database indices.
            </span>
          </div>

          {/* Accept/Continue button */}
          <button
            onClick={onClose}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-sans text-xs font-bold py-3 mt-5 rounded-xl shadow-md transition-all active:scale-[0.98]"
          >
            Acknowledge & Sync
          </button>
        </div>

      </div>
    </div>
  );
}
