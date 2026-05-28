/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Calendar, 
  Search, 
  Download, 
  FileSpreadsheet,
  Printer,
  PieChart,
  UserCheck
} from 'lucide-react';
import { Employee, AttendanceLogLegacy } from '../types';

function parseDateParts(dateStr: string) {
  if (!dateStr) return { year: '', month: '', day: '' };
  const d = String(dateStr).trim();
  
  // Clean separators
  const parts = d.split(/[-/]/);
  if (parts.length === 3) {
    // Check if first part is a year (YYYY or YY)
    if (parts[0].length === 4 || (parts[0].length === 2 && parseInt(parts[0], 10) > 12 && parseInt(parts[2], 10) <= 31)) {
      let year = parts[0];
      if (year.length === 2) {
        year = '20' + year;
      }
      return {
        year,
        month: parts[1]?.padStart(2, '0') || '',
        day: parts[2]?.padStart(2, '0') || ''
      };
    }
    
    // Check if third part is a year
    if (parts[2].length === 4 || parts[2].length === 2) {
      let year = parts[2];
      if (year.length === 2) {
        year = '20' + year;
      }
      const p0 = parseInt(parts[0], 10) || 0;
      const p1 = parseInt(parts[1], 10) || 0;
      
      // Heuristic: If p0 > 12, then p0 must be the day, making p1 the month (DD/MM/YYYY)
      if (p0 > 12) {
        return {
          year,
          month: String(p1).padStart(2, '0'),
          day: String(p0).padStart(2, '0')
        };
      }
      // If p1 > 12, then p1 must be the day, making p0 the month (MM/DD/YYYY)
      if (p1 > 12) {
        return {
          year,
          month: String(p0).padStart(2, '0'),
          day: String(p1).padStart(2, '0')
        };
      }
      // Default: assume MM/DD/YYYY if ambiguous
      return {
        year,
        month: String(p0).padStart(2, '0'),
        day: String(p1).padStart(2, '0')
      };
    }
  }
  
  // Fallback to substring if it's formatted as custom string starting with year
  return {
    year: d.substring(0, 4),
    month: d.substring(5, 7),
    day: d.substring(8, 10)
  };
}

interface ReportModalProps {
  onClose: () => void;
  logs: AttendanceLogLegacy[];
  employeesList: Employee[];
}

export default function ReportModal({
  onClose,
  logs,
  employeesList
}: ReportModalProps) {
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('2026');
  const [searchEID, setSearchEID] = useState('');

  // Selected ledger data
  const [filteredLogs, setFilteredLogs] = useState<AttendanceLogLegacy[]>([]);

  // Analytics accumulators
  const [totalLateMin, setTotalLateMin] = useState(0);
  const [totalUndertimeMin, setTotalUndertimeMin] = useState(0);
  const [payoutEstimation, setPayoutEstimation] = useState(0);
  const [totalShifts, setTotalShifts] = useState(0);

  // Prefill month dropdown options
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  useEffect(() => {
    // Audit filter passes
    let subset = [...logs];

    if (filterMonth) {
      subset = subset.filter(l => {
        const { month } = parseDateParts(l.date);
        return month === filterMonth;
      });
    }
    if (filterYear) {
      subset = subset.filter(l => {
        const { year } = parseDateParts(l.date);
        return year === filterYear;
      });
    }
    if (searchEID.trim()) {
      const q = searchEID.toLowerCase().trim();
      subset = subset.filter(l => {
        const cleanEid = String(l.eid || '').toLowerCase().trim();
        const cleanName = String(l.name || '').toLowerCase().trim();
        return cleanEid.includes(q) || cleanName.includes(q);
      });
    }

    setFilteredLogs(subset);

    // Compute metrics
    let lateSum = 0;
    let undertimeSum = 0;
    let payoutSum = 0;
    let counts = subset.length;

    subset.forEach(l => {
      lateSum += l.tardiness || 0;
      undertimeSum += l.undertime || 0;

      // Calculate accrued salary
      const matchedEmployee = employeesList.find(e => {
        const leftEID = String(e.eid || '').trim().toLowerCase();
        const rightEID = String(l.eid || '').trim().toLowerCase();
        return leftEID === rightEID;
      });
      if (matchedEmployee) {
        const rate = matchedEmployee.rate_per_day || 0;
        
        // standard 8-hour daily shift (480 minutes). Tardiness / undertime deducted prorated
        const minuteRate = rate / 480;
        const totalLostMin = (l.tardiness || 0) + (l.undertime || 0);
        const dailyGross = Math.max(0, rate - (totalLostMin * minuteRate));
        
        payoutSum += dailyGross;
      }
    });

    // If searching specific EID, deduct PhilHealth once from total accrued month salary
    if (searchEID.trim() && subset.length > 0) {
      const q = searchEID.toLowerCase().trim();
      const activeEmp = employeesList.find(e => {
        const cleanEid = String(e.eid || '').toLowerCase().trim();
        const cleanName = String(e.name || '').toLowerCase().trim();
        return cleanEid === q || cleanName.includes(q);
      });
      if (activeEmp) {
        payoutSum = Math.max(0, payoutSum - (activeEmp.philhealth || 0));
      }
    }

    setTotalLateMin(lateSum);
    setTotalUndertimeMin(undertimeSum);
    setPayoutEstimation(payoutSum);
    setTotalShifts(counts);

  }, [logs, filterMonth, filterYear, searchEID, employeesList]);

  // Export visual datasets to static CSV download files
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      alert('Roster ledger represents no records for active filtering conditions.');
      return;
    }

    const headers = ['EID', 'Name', 'Date', 'Clock In', 'Clock Out', 'Tardiness (min)', 'Undertime (min)', 'Remarks'];
    const rows = filteredLogs.map(l => [
      l.eid,
      l.name,
      l.date,
      l.start_time ? new Date(l.start_time).toLocaleTimeString('en-US', { hour12: false }) : '',
      l.end_time ? new Date(l.end_time).toLocaleTimeString('en-US', { hour12: false }) : '',
      l.tardiness,
      l.undertime,
      l.remarks
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PCC_DTR_Report_${filterYear}_${filterMonth || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-50 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-3xl bg-white border border-zinc-200 shadow-2xl p-6 flex flex-col justify-between overflow-hidden">
        
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4 mb-4">
          <div className="flex items-center space-x-2">
            <PieChart className="h-5 w-5 text-orange-600" />
            <h3 className="font-sans font-bold text-sm text-zinc-950">Monthly Crew Attendance & Payroll Ledger</h3>
          </div>
          <button 
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-zinc-100 transition-colors"
          >
            <X className="h-4 w-4 text-zinc-400 hover:text-zinc-650" />
          </button>
        </div>

        {/* Dashboard filter columns */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-zinc-50 border border-zinc-200 p-4 rounded-2xl mb-4">
          <div className="space-y-1">
            <label className="block font-sans text-[9px] font-bold uppercase tracking-wider text-zinc-400">Search Crew EID</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search EID, e.g. 251805"
                value={searchEID}
                onChange={(e) => setSearchEID(e.target.value)}
                className="w-full rounded-lg bg-white border border-zinc-200 pl-8 pr-2.5 py-1.5 font-mono text-xs outline-none focus:border-orange-500"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block font-sans text-[9px] font-bold uppercase tracking-wider text-zinc-400">Target Month</label>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 font-sans text-xs outline-none focus:border-orange-500"
            >
              <option value="">Show All Months</option>
              {months.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block font-sans text-[9px] font-bold uppercase tracking-wider text-zinc-400">Target Year</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 font-sans text-xs outline-none focus:border-orange-500"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleExportCSV}
              className="w-full flex items-center justify-center space-x-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 bg-white text-zinc-700 font-sans text-xs font-semibold py-2 transition-all shadow-sm"
            >
              <Download className="h-4 w-4" />
              <span>Export Ledger CSV</span>
            </button>
          </div>
        </div>

        {/* Analytical summaries tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div className="p-3 border border-zinc-200 rounded-xl">
            <div className="font-sans text-[10px] text-zinc-400 uppercase tracking-wider">Accrued Shifts</div>
            <div className="font-mono text-xl font-bold text-zinc-900 mt-1">{totalShifts}</div>
          </div>
          <div className="p-3 border border-zinc-200 rounded-xl">
            <div className="font-sans text-[10px] text-rose-500 uppercase tracking-wider">Total tardiness</div>
            <div className="font-mono text-xl font-bold text-rose-600 mt-1">{totalLateMin} Mins</div>
          </div>
          <div className="p-3 border border-zinc-200 rounded-xl">
            <div className="font-sans text-[10px] text-amber-500 uppercase tracking-wider">Total Undertimes</div>
            <div className="font-mono text-xl font-bold text-amber-600 mt-1">{totalUndertimeMin} Mins</div>
          </div>
          <div className="p-3 border border-zinc-200 rounded-xl bg-orange-50/50 border-orange-100">
            <div className="font-sans text-[10px] text-orange-600 uppercase tracking-wider font-semibold">Projected Payout</div>
            <div className="font-mono text-xl font-bold text-orange-700 mt-1">₱ {payoutEstimation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            {searchEID.trim() && (
              <span className="font-sans text-[8px] text-zinc-400 block pt-0.5">PhilHealth deduction factored</span>
            )}
          </div>
        </div>

        {/* Ledger Grid */}
        <div className="flex-1 overflow-y-auto border border-zinc-200 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500 sticky top-0 z-10">
                <th className="px-4 py-3">EID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">In</th>
                <th className="px-4 py-3">Out</th>
                <th className="px-4 py-3">Tardiness (min)</th>
                <th className="px-4 py-3">Undertime (min)</th>
                <th className="px-4 py-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 font-sans text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-zinc-400">
                    No matching timesheet logs resolved for search filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-4 py-2 font-mono font-semibold text-zinc-700">{log.eid}</td>
                    <td className="px-4 py-2 font-medium text-zinc-900">{log.name}</td>
                    <td className="px-4 py-2 font-mono text-zinc-500">{log.date}</td>
                    <td className="px-4 py-2 font-mono text-emerald-600 select-all">
                      {log.start_time ? new Date(log.start_time).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-rose-600 select-all">
                      {log.end_time ? new Date(log.end_time).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className={`px-4 py-2 font-mono font-medium ${log.tardiness > 0 ? 'text-rose-600 bg-rose-50/50' : 'text-zinc-400'}`}>
                      {log.tardiness > 0 ? `+${log.tardiness}` : '0'}
                    </td>
                    <td className={`px-4 py-2 font-mono font-medium ${log.undertime > 0 ? 'text-amber-600 bg-amber-50/50' : 'text-zinc-400'}`}>
                      {log.undertime > 0 ? `+${log.undertime}` : '0'}
                    </td>
                    <td className="px-4 py-2 font-sans italic text-zinc-500 w-44 truncate" title={log.remarks}>
                      {log.remarks || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info logs summary */}
        <div className="border-t border-zinc-100 pt-4 flex justify-between items-center mt-4">
          <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest font-semibold">
            PCC RECORD INDEX EXCLUSIVELY SYNCED
          </span>
          <button
            onClick={onClose}
            className="bg-zinc-900 hover:bg-zinc-850 px-5 py-2 rounded-lg font-sans text-xs font-semibold text-white transition-colors"
          >
            Close Overview
          </button>
        </div>

      </div>
    </div>
  );
}
