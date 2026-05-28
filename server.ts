/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { 
  normalizeEID, 
  getClosestShift, 
  calculateTardiness, 
  calculateUndertime 
} from "./src/lib/shiftLogic";
import {
  setSharedAuth,
  getSharedAuth,
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

// Configure Google Sheets session details
app.post("/api/auth/save-token", async (req, res) => {
  const { accessToken, spreadsheetId, appsScriptUrl } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required." });
  }
  if (!accessToken && !appsScriptUrl) {
    return res.status(400).json({ error: "Either accessToken or appsScriptUrl is required to connect." });
  }

  // Extract pure spreadsheet ID if a full Google Sheets URL was pasted
  const rawId = String(spreadsheetId).trim();
  const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const normalizedId = urlMatch && urlMatch[1] ? urlMatch[1] : rawId;

  // Track previous authorization details for safety rollback
  const previousConfig = getSharedAuth();

  try {
    // Stage the new connection settings globally
    setSharedAuth(accessToken || null, normalizedId, appsScriptUrl || null);
    
    if (appsScriptUrl) {
      // Verify connectivity by running a synchronous roster fetch test
      await getAllEmployees(true);
    } else {
      // Verify direct Google Sheets access
      await ensureSpreadsheetStructure();
    }

    res.json({ 
      success: true, 
      message: appsScriptUrl ? "Google Apps Script connection active." : "Google Sheets context saved successfully.",
      connected: true
    });
  } catch (err: any) {
    // Discard broken staging state, rollback to previous working layout configuration
    setSharedAuth(
      previousConfig.adminAccessToken, 
      previousConfig.activeSpreadsheetId, 
      previousConfig.googleAppsScriptUrl
    );
    
    console.error("Connection sync verification failed:", err);
    res.status(400).json({ 
      error: err.message || "Failed to establish a valid connection. Check configuration details."
    });
  }
});

// Clear Google Sheets connection (go offline/back up database mode)
app.post("/api/auth/clear-token", (req, res) => {
  setSharedAuth(null, null, null);
  res.json({ 
    success: true, 
    message: "Google Sheets connection terminated. Operating in Offline storage.",
    connected: false
  });
});

// Get configuration, token status, and current validation tokens
app.get("/api/config", (req, res) => {
  const { adminAccessToken, activeSpreadsheetId, googleAppsScriptUrl, lastAppsScriptError } = getSharedAuth();
  const todayStr = getManilaDateStr(0);
  const yesterdayStr = getManilaDateStr(-1);

  res.json({
    connected: !!adminAccessToken || !!googleAppsScriptUrl,
    spreadsheetId: activeSpreadsheetId,
    googleAppsScriptUrl,
    appsScriptError: lastAppsScriptError,
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


// Proxy endpoint to prevent CORS blocks of Apps Script Web App in static / serverless hosting environments (e.g. Vercel)
app.post("/api/proxy", async (req: express.Request, res: express.Response) => {
  const { scriptUrl, payload } = req.body;
  if (!scriptUrl) {
    return res.status(400).json({ error: "scriptUrl is required." });
  }

  try {
    // Perform server-to-server request
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Apps Script replied with HTTP Error ${response.status}` 
      });
    }

    const rawText = await response.text();
    const trimmed = rawText.trim();

    if (trimmed.startsWith("<")) {
      return res.status(422).json({ 
        error: "Apps Script returned HTML. Check permissions (Anyone)." 
      });
    }

    const parsed = JSON.parse(trimmed);
    res.json(parsed);
  } catch (err: any) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message || "Failed to communicate with Apps Script via proxy" });
  }
});


// -------------------------------------------------------------
// Vite Dev & Production Serving Setup
// -------------------------------------------------------------
async function initServerAndListeners() {
  if (process.env.VERCEL) {
    // Under Vercel environment, static routing is handled natively via configuration,
    // and listeners are managed serverless-side.
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
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

export default app;
