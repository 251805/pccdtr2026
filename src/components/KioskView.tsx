/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Clock, ShieldAlert, Monitor, Sparkles, ArrowLeft } from 'lucide-react';

interface KioskViewProps {
  onLinesStatus: boolean;
  todayToken: string;
  serverTime: string;
}

export default function KioskView({
  onLinesStatus,
  todayToken,
  serverTime
}: KioskViewProps) {
  const [timeState, setTimeState] = useState(new Date());
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Clock Ticker (runs every 1sec)
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeState(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Generate QR Data URL dynamically when the rolling daily token updates
  useEffect(() => {
    if (!todayToken) return;
    QRCode.toDataURL(todayToken, {
      width: 450,
      margin: 2,
      color: {
        dark: '#000000', // Crisp, high-contrast dark bars
        light: '#FFFFFF' // Perfect light backdrop
      }
    })
    .then(url => setQrDataUrl(url))
    .catch(err => console.error("Kiosk QR generation failure:", err));
  }, [todayToken]);

  // Formats
  const formattedTime = timeState.toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const formattedDate = timeState.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col justify-between p-6 sm:p-12 selection:bg-orange-600/30 select-none">
      
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-6">
        <div className="flex items-center space-x-4">
          <a
            href="https://pccdtr2026-180156270797.asia-east1.run.app/"
            className="flex h-10 px-3.5 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer gap-2 text-xs font-mono tracking-wider font-semibold"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>BACK</span>
          </a>

          <img 
            src="https://raw.githubusercontent.com/251805/sirpacheck/main/PCCLogo.png" 
            alt="PCC Logo" 
            className="h-12 w-12 object-contain rounded-2xl shadow-lg"
            referrerPolicy="no-referrer"
          />
          <div>
            <h1 className="font-sans font-bold text-lg tracking-tight text-white uppercase sm:text-2xl">
              Pagbilao Command Center
            </h1>
            <p className="font-mono text-[10px] sm:text-xs text-zinc-500 font-medium tracking-widest uppercase mt-0.5">
              DTR • QR Display
            </p>
          </div>
        </div>

        {/* Sync ping light */}
        <div className="flex items-center space-x-2 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2">
          <span className={`h-2.5 w-2.5 rounded-full ${onLinesStatus ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-bounce'}`} />
          <span className="font-mono text-xs text-zinc-300 uppercase tracking-widest font-bold">
            {onLinesStatus ? 'SYSTEM ONLINE *' : 'OFFLINE MODE'}
          </span>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-12 items-center my-10 max-w-7xl mx-auto w-full">
        
        {/* Left Side: Live ticking Clock */}
        <div className="space-y-6 text-center md:text-left">
          <div className="flex flex-col space-y-2">
            <span className="font-mono text-zinc-500 text-xs sm:text-sm font-semibold tracking-wider uppercase flex items-center justify-center md:justify-start space-x-1.5">
              <Clock className="h-4 w-4 text-orange-500" />
              <span>Manila Standard Time</span>
            </span>
            <div className="font-mono font-bold text-5xl sm:text-7xl lg:text-8xl tracking-tight text-white font-semibold tabular-nums leading-none">
              {formattedTime}
            </div>
          </div>
          <div className="font-sans text-base sm:text-xl text-zinc-400 font-medium">
            {formattedDate}
          </div>
          
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-900 p-6 space-y-4 max-w-sm mx-auto md:mx-0">
            <div className="flex items-start space-x-3 text-left">
              <ShieldAlert className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-sans text-xs font-semibold text-zinc-200">QR Code</h4>
                <p className="font-sans text-[11px] text-zinc-500 leading-relaxed mt-1">
                  Changes daily no need to copy,works on Android and IOS.
                </p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3 text-left">
              <Sparkles className="h-5 w-5 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-sans text-xs font-semibold text-zinc-200">Scan via Smartphone</h4>
                <p className="font-sans text-[11px] text-zinc-500 leading-relaxed mt-1">
                  Open your mobile browser scanner and point at this canvas to log your shift seamlessly in sub-seconds.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: QR code visual container */}
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="relative p-6 bg-white rounded-3xl shadow-2xl shadow-zinc-950/80 max-w-md w-full aspect-square border-4 border-zinc-900 flex items-center justify-center overflow-hidden transition-transform duration-300 hover:scale-[1.02]">
            {qrDataUrl ? (
              <img 
                src={qrDataUrl} 
                alt="Station QR code ticket"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain select-none shadow"
              />
            ) : (
              <div className="animate-pulse bg-zinc-100 w-full h-full rounded flex items-center justify-center text-zinc-400">
                Generating rolling barcode...
              </div>
            )}
          </div>
          
          {/* Active security indicators */}
          <div className="text-center space-y-1">
            <span className="font-sans text-[10px] text-zinc-500 tracking-wider">
              ACTIVE SECURITY BROADCAST:
            </span>
            <div className="font-mono text-xs text-orange-400 bg-orange-950/30 border border-orange-950 px-3 py-1.5 rounded-full font-bold">
              {todayToken || 'qr-not-init'}
            </div>
          </div>
        </div>

      </div>

      {/* Footer copyright */}
      <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-900 pt-6 text-[10px] sm:text-xs font-mono text-zinc-650">
        <div>
          PAGBILAO MUNICIPAL MONITORING MONITORS • STATION 01
        </div>
        <div className="mt-2 sm:mt-0 flex items-center space-x-1">
          <Monitor className="h-3.5 w-3.5" />
          <span>REAL-TIME SERVER POOL SYNCED</span>
        </div>
      </div>

    </div>
  );
}
