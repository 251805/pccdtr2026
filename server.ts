/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { 
  normalizeEID, 
  getClosestShift, 
  calculateTardiness, 
  calculateUndertime 
} from "./src/lib/shiftLogic";
import {
  ensureSpreadsheetStructure,
  getAllEmployees,
  saveRawAttendance,
  processSessionAndLegacyWrite,
  saveRosterUpdate,
  getAllRawAttendance,
  getAllLegacyLogs,
  getAllSessions,
  fallbackEmployees,
  fallbackAttendance,
  fallbackLegacyLogs,
  fallbackSessions
} from "./src/lib/serverDb";

const app = express();
const PORT = 3000;

app.use(express.json());

// Anti-spam scan history: { [eid: string]: number (timestamp in ms) }
const lastPunchTimes: Record<string, number> = {};

// Helper: Get Manila Standard Time date string (YYYY-MM-DD)
function getManilaDateStr(dOffset = 0): string {
  const d = new Date(Date.now() + dOffset * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD format
}

// -------------------------------------------------------------
// API Endpoints FIRST
// -------------------------------------------------------------

// API health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get configuration, token status, and current validation tokens
app.get("/api/config", (req, res) => {
  const todayStr = getManilaDateStr(0);
  const yesterdayStr = getManilaDateStr(-1);

  res.json({
    connected: true, // Always true now with Firebase
    todayToken: `a10dance-daily-qr-${todayStr}`,
    yesterdayToken: `a10dance-daily-qr-${yesterdayStr}`,
    serverTime: new Date().toISOString(),
    todayDate: todayStr
  });
});

// Fetch active employees
app.get("/api/employees", async (req, res) => {
  try {
    const list = await getAllEmployees();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update employees roster
app.post("/api/employees/update", async (req, res) => {
  try {
    const { roster } = req.body;
    if (!Array.isArray(roster)) {
      return res.status(400).json({ error: "Roster must be a valid array" });
    }
    await saveRosterUpdate(roster);
    res.json({ success: true, length: roster.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch historical logs (both legacy visual matrices and raw logs lists)
app.get("/api/logs", async (req, res) => {
  try {
    const raw = await getAllRawAttendance();
    const legacy = await getAllLegacyLogs();
    const sessions = await getAllSessions();
    res.json({
      raw,
      legacy,
      sessions
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to sync historical logs from Google Sheets." });
  }
});

// Main clocking scan trigger: POST /api/scan
app.post("/api/scan", async (req, res) => {
  try {
    const { rawEID, qrToken, source, remark } = req.body;
    const notes = remark || "";

    // 1. EID Normalization
    const eid = normalizeEID(rawEID);
    if (!eid) {
      return res.status(400).json({ error: "Missing or invalid Employee Identifier ID" });
    }

    // 2. Anti-Spam double click / focus loop protector: 30-second threshold
    const now = Date.now();
    const lastPunch = lastPunchTimes[eid];
    if (lastPunch && (now - lastPunch) < 30000) {
      const remaining = Math.ceil((30000 - (now - lastPunch)) / 1000);
      return res.status(429).json({ 
        error: `Anti-Spam lock activated for employee [${eid}]. Please wait ${remaining}s before resubmitting.` 
      });
    }

    // 3. QR Token Verification if triggered via SCAN source
    if (source === 'SCAN') {
      const todayStr = getManilaDateStr(0);
      const yesterdayStr = getManilaDateStr(-1);
      
      const expectedToday = `a10dance-daily-qr-${todayStr}`;
      const expectedYesterday = `a10dance-daily-qr-${yesterdayStr}`;

      if (qrToken !== expectedToday && qrToken !== expectedYesterday) {
        return res.status(400).json({ 
          error: "Stale or Invalid Station QR Code. Display is expired or captured from yesterday." 
        });
      }
    }

    // 4. Verification Check of Employee ID
    const employees = await getAllEmployees();
    let emp = employees.find(e => e.eid === eid);

    // Self-healing roster: if EID is unknown, append a generic crew identity automatically
    if (!emp) {
      emp = {
        id: `emp_${Date.now()}`,
        eid,
        name: `Crew Member (${eid})`,
        rate_per_day: 800, // standard default
        philhealth: 300 // standard default
      };
      fallbackEmployees.push(emp);
      await saveRosterUpdate(fallbackEmployees);
    }

    // 5. Determine Punch Action Direction (LOGIN vs LOGOUT)
    // Find last logged event for this employee ID in raw logs
    const allRawLogs = await getAllRawAttendance();
    const employeeRawLogs = allRawLogs.filter(l => l.employee_id === eid);
    let nextAction: 'LOGIN' | 'LOGOUT' = 'LOGIN';
    if (employeeRawLogs.length > 0) {
      const lastSession = employeeRawLogs[employeeRawLogs.length - 1];
      nextAction = lastSession.action === 'LOGIN' ? 'LOGOUT' : 'LOGIN';
    }

    // Set anti-spam timestamp
    lastPunchTimes[eid] = now;

    // 6. Record Raw Attendance Transaction
    const timestampISO = new Date().toISOString();
    const todayStr = getManilaDateStr(0);

    const scanLog = {
      id: `raw_${Date.now()}`,
      employee_id: eid,
      action: nextAction,
      source: source || 'MANUAL',
      timestamp: timestampISO,
      remarks: notes
    };

    await saveRawAttendance(scanLog);

    // 7. Write to Sessions & Legacy spreadsheets
    await processSessionAndLegacyWrite(
      eid,
      nextAction,
      timestampISO,
      todayStr,
      notes,
      getClosestShift,
      calculateTardiness,
      calculateUndertime
    );

    res.json({
      success: true,
      action: nextAction,
      employee: emp,
      timestamp: timestampISO,
      message: `${emp.name} has clocked [${nextAction}] successfully.`
    });

  } catch (error: any) {
    console.error("Scan processing failure:", error);
    res.status(500).json({ error: error.message || "Attendance logging exception." });
  }
});


// -------------------------------------------------------------
// Vite Dev & Production Serving Setup
// -------------------------------------------------------------
async function initServerAndListeners() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

initServerAndListeners();
