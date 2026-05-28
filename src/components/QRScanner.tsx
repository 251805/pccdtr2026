/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import { Camera, Image, X, RefreshCw, Volume2 } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  onClose: () => void;
}

export default function QRScanner({
  onScanSuccess,
  onScanError,
  onClose
}: QRScannerProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [scanStatus, setScanStatus] = useState<'IDLE' | 'SCANNING' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [useUploadFallback, setUseUploadFallback] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const qrElementId = "qr-reader-surface";

  // Synthesize custom audible chip beep feedback using browser Web Audio API oscillators
  const playSynthesizedChirp = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      // Dual resonant swoop (880Hz to 1400Hz)
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.12);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      console.warn('Audio synthesis disabled due to user interaction blocks:', e);
    }
  };

  useEffect(() => {
    // 1. Fetch available webcams
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back camera if available
          const backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear'));
          setSelectedCameraId(backCam ? backCam.id : devices[0].id);
        } else {
          setErrorMessage('No local hardware cameras resolved. Defaulting to file upload snapshots.');
          setUseUploadFallback(true);
        }
      })
      .catch((err) => {
        console.warn('Camera lookup exception. Pivot to uploader:', err);
        setErrorMessage('Failed to trigger camera list. Try file upload snapshots!');
        setUseUploadFallback(true);
      });

    return () => {
      stopCameraScanner();
    };
  }, []);

  const startCameraScanner = (cameraId: string) => {
    if (!cameraId || useUploadFallback) return;

    stopCameraScanner()
      .then(() => {
        const scanner = new Html5Qrcode(qrElementId);
        scannerRef.current = scanner;
        setScanStatus('SCANNING');
        setErrorMessage('');

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        };

        scanner.start(
          cameraId,
          config,
          (decodedText) => {
            playSynthesizedChirp();
            onScanSuccess(decodedText);
            stopCameraScanner();
            onClose();
          },
          (err) => {
            if (onScanError) onScanError(err);
          }
        )
        .catch((err) => {
          console.error("Failed to boot local camera engine:", err);
          setScanStatus('ERROR');
          setErrorMessage('Failed to acquire webcam streaming focus. Is it active in another tab?');
        });
      });
  };

  const stopCameraScanner = (): Promise<void> => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      return scannerRef.current.stop()
        .then(() => {
          scannerRef.current = null;
          setScanStatus('IDLE');
        })
        .catch(err => {
          console.error("Stop scanner error:", err);
          scannerRef.current = null;
        });
    }
    return Promise.resolve();
  };

  useEffect(() => {
    if (selectedCameraId && !useUploadFallback) {
      startCameraScanner(selectedCameraId);
    }
  }, [selectedCameraId, useUploadFallback]);

  // Handle fallback file scan
  const handleFileUploadScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanStatus('SCANNING');
    setErrorMessage('');

    const html5Qr = new Html5Qrcode(qrElementId);
    html5Qr.scanFile(file, true)
      .then((decodedText) => {
        playSynthesizedChirp();
        onScanSuccess(decodedText);
        onClose();
      })
      .catch((err) => {
        console.error("Static image QR lookup exception:", err);
        setScanStatus('ERROR');
        setErrorMessage('Could not locate any valid high-contrast daily QR code in this snapshot. Adjust alignment.');
      });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-50 p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 text-white shadow-2xl p-6 overflow-hidden">
        
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
          <div className="flex items-center space-x-2">
            <Camera className="h-5 w-5 text-orange-500" />
            <h3 className="font-sans font-semibold text-sm">Station QR Viewfinder</h3>
          </div>
          <button 
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4 text-zinc-400 hover:text-white" />
          </button>
        </div>

        {/* Diagnostic Status warnings */}
        {errorMessage && (
          <div className="mb-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 p-3 text-xs leading-relaxed">
            {errorMessage}
          </div>
        )}

        {/* Viewport Render surface */}
        <div className="relative aspect-square w-full rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col items-center justify-center overflow-hidden mb-4">
          
          {/* Laser scanning animations overlay */}
          {scanStatus === 'SCANNING' && !useUploadFallback && (
            <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between">
              {/* Corner framing brackets */}
              <div className="absolute top-4 left-4 h-6 w-6 border-t-2 border-l-2 border-orange-500 rounded-tl" />
              <div className="absolute top-4 right-4 h-6 w-6 border-t-2 border-r-2 border-orange-500 rounded-tr" />
              <div className="absolute bottom-4 left-4 h-6 w-6 border-b-2 border-l-2 border-orange-500 rounded-bl" />
              <div className="absolute bottom-4 right-4 h-6 w-6 border-b-2 border-r-2 border-orange-500 rounded-br" />
              
              {/* Rolling laser line */}
              <div className="w-full h-0.5 bg-orange-500/80 shadow-[0_0_10px_2px_rgba(249,115,22,0.6)] animate-[bounce_2s_infinite]" />
            </div>
          )}

          {/* Canvas container for html5-qrcode */}
          <div 
            id={qrElementId} 
            className={`w-full h-full object-cover select-none ${useUploadFallback ? 'hidden' : 'block'}`}
          />

          {/* Upload fallback state */}
          {useUploadFallback && (
            <div className="p-8 text-center flex flex-col items-center space-y-4">
              <div className="rounded-full bg-zinc-900 border border-zinc-800 h-16 w-16 flex items-center justify-center text-zinc-400">
                <Image className="h-8 w-8 text-orange-400" />
              </div>
              <div>
                <p className="font-sans text-xs font-semibold text-zinc-200">Browser sandboxed camera blocked</p>
                <p className="font-sans text-[10px] text-zinc-500 mt-1">Upload an instant snapshot of yesterday or today's kiosk station barcode.</p>
              </div>
              <label className="flex items-center space-x-1 px-4 py-2 border border-orange-600 hover:bg-orange-600/10 rounded-lg cursor-pointer transition-colors text-orange-400 font-sans text-xs font-medium">
                <Volume2 className="h-3.5 w-3.5" />
                <span>Upload Snapshot Image</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleFileUploadScan} 
                />
              </label>
            </div>
          )}
        </div>

        {/* Camera Switching selectors */}
        {!useUploadFallback && cameras.length > 1 && (
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-500 text-zinc-300"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || `Camera ${cameras.indexOf(c) + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-center mt-4">
          <button
            onClick={() => setUseUploadFallback(!useUploadFallback)}
            className="text-[11px] font-sans font-medium text-zinc-400 hover:text-white underline transition-colors"
          >
            {useUploadFallback ? "Return to Webcam streaming" : "Switch to Photo Snapshot Uploader"}
          </button>
        </div>

      </div>
    </div>
  );
}
