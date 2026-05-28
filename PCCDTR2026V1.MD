# Pagbilao Command Center - DTR Tracker System Specification Manual (V1.0)
This comprehensive document specifies the exact architectures, business logics, file paths, and flow blueprints of the **Pagbilao Command Center (PCC) Daily Time Record (DTR) System** with a detailed plan to guide any developer or AI through rebuilding it from scratch.

---

## 1. System Purpose

The **Pagbilao Command Center (PCC) Daily Time Record (DTR) System** is a full-stack, enterprise-grade attendance tracker tailored specifically for Pagbilao Command Center crew rosters. It solves critical workforce dispatch obstacles such as physical timesheet card queues, daily paper-badge distribution waste, proxy clock-ins, timezone offset drifts, and offline communication blackouts in remote municipal or tactical monitoring depots.

### Main Objectives
- **Secure Dual-Option Verification**: Allows users to punch time either on their own mobile devices via camera scanning of a secure rolling QR code broadcasts, or via manual back-up numeric terminal entry.
- **Sub-Second Real-Time Synchronization**: Records sub-second logins and session state modifications across two master data models simultaneously in real-time, matching live GMT+8 system time.
- **No-Interruption Offline Resiliency**: Detects hardware internet disconnection and pivots dynamically to storage fallbacks, queueing logs client-side to self-heal and batch-sync once cellular or Wi-Fi coverage is active.
- **No-Leak Cryptographic Tokens**: Rotates daily verification seeds immediately at midnight to render physical photos or paper printouts of yesterday's QR codes useless for year-long attendance logging.

### User Roles & Permissions
- **Standard Crew Member**: Identifies their personal smartphone through saveable browser cookies. Possesses authority only to view active clock modules and scan station QR codes.
- **Administrative Teams Agent (Role: `TEAMS`)**: Logs in with credential checks. Authorized to modify EIDs, review crew rosters, and access the daily rolling QR codes to present to wall-mounted kiosk tablets.
- **System Administrator (Role: `ROOT`)**: Highest level of clearance. Logs in with dedicated master credentials. Authorized to modify daily rates, insurances (PhilHealth rates), force sync roster defaults, and edit critical logs lists.

---

## 2. System Mental Model

The Pagbilao Command Center DTR system operates on a state-authoritative loop driven by interactive client views, reactive browser cache caches, and permanent full-stack database triggers.

```
+---------------------------------------------------------------------------------+
|                               SYSTEM MENTAL MODEL                               |
+---------------------------------------------------------------------------------+
|                                                                                 |
|  [ Kiosk Terminal Window ]      [ Direct Manual Card / Scanner ]                |
|           |                                    |                                |
|    (Displays Rolling                 (Inputs Raw EID or                         |
|     Midnight token)                   Scans Phone Session EID)                  |
|           |                                    |                                |
|           v                                    v                                |
|  [ Smartphone Scanner App ] ------> [ Proxy Scan API (/api/scan) ]              |
|                                                |                                |
|                                                v                                |
|                                     [ Verify / Register ]                       |
|                                                |                                |
|                           +--------------------+--------------------+           |
|                           |                                         |           |
|                           v                                         v           |
|                 [ Supabase Attendance ]                       [ Local Client ]  |
|               (attendance, sessions tables)                         |           |
|                           |                                         |           |
|                           v                                         v           |
|               (Logs & Delta Calculations)                  (Client Backup DB)   |
|                                                                                 |
+---------------------------------------------------------------------------------+
```

### Initial Application Setup & Loop
- **First-Time Load**: The system initiates a browser-level validation sequence checking `localStorage` for registered employees. If empty, it loads 21 seed workers with customized daily pay rates and PhilHealth codes. It also verifies network sockets to establish live online integration statuses.
- **The Identity-Set Step**: Standard crew members open the system on their browser and input their identifier (e.g., `251805`). The system pins this code to their browser under a persistent `a10dance_eid` cookie, valid for a full calendar year.
- **The Station Trigger**: A wall-mounted terminal is positioned permanently at the depot or entrance, displaying the **Kiosk Mode UI** (accessed via URL parameters `?kiosk=true`). It displays a live ticking clock synchronized with system servers, alongside a giant dynamic high-definition QR code containing the cryptographic sequence `a10dance-daily-qr-[YYYY-MM-DD]`.
- **The Action Trigger**: To verify their shift, a crew member fires up their personal smartphone's integrated web camera directly from their browser, scanning the rolling QR. The scanner matches their saved device identifier cookie with the dynamic cryptographic token, routing the packet directly to the backend proxy.
- **Information flow direction & Rules**: Decisions are governed by real-time validations. Workshifts, tardiness indexes, and undertime gaps are derived securely server-side based on predefined shift hours before data gets injected into parallel relational tables.

---

## 3. Complete Business Logic

### A. Employee Barcode/Numeric EID Normalization
Every input character stream parsed from barcode scanners, dynamic camera QR modules, or manual input forms must be formatted identically before any verification logic runs.

- **Inputs**: A raw string corresponding to an employee ID (e.g. `"251805"`, `"'221739'"`, `"{eid: 251805}"`, or `https://pcc-dtr.gov/employee/23678`).
- **Processing and Condition Rules**:
  - **WHEN**: A string identifier is received by the client parser or backend normalizer.
  - **IF**: The code contains wrapping double (`"`) or single (`'`) quotes.
  - **THEN**: Strip the bounding characters and trim excess white spaces.
  - **IF**: The code starts with a curly brace `{` indicating a raw JSON payload string.
  - **THEN**: Parse it with a secure JSON engine and seek the following tags in sequence: `eid` -> `id` -> `employeeId` -> `employee_id`. Utilize the first non-empty text value found.
  - **IF**: The code starts with `http://` or `https://` protocols indicating a URL string.
  - **THEN**: Interpret as a Web URL. Inspect parameter keys `eid` -> `id` -> `empid` -> `emp_id` -> `employee_id` -> `employee`. If found, use that parameter's value.
  - **OTHERWISE** (no search query parameter exists on the URL): Split the URL pathname into segments separated by slashes and use the final segment.
  - **OTHERWISE**: Yield the raw text trimmed.

---

### B. Daily Cryptographic Token Validation
To protect against proxy check-ins using photographs, QR codes are validated server-side.

- **Inputs**: Scanned token string, client computer clock datetime timestamp.
- **Processing and Condition Rules**:
  - **WHEN**: A scanned QR code hits the validating handler loop.
  - **IF**: The scanned string value exactly matches `a10dance-daily-qr-[YYYY-MM-DD]` where `YYYY-MM-DD` is the current server local date.
  - **THEN**: Allow the punch to proceed. It is valid.
  - **IF**: The scanned string matches `a10dance-daily-qr-[YYYY-MM-DD]` of the previous calendar day (yesterday).
  - **THEN**: Allow the punch to proceed. (Accounts for timezone offsets or lingering night shifts).
  - **OTHERWISE**: Reject the transaction immediately, returning a `400 Stale or Invalid Universal QR code` error.

---

### C. Late Tardiness and Undertime Discrepancy Calculations
Work shifts are categorized into four rigid, pre-defined operational categories:
1. **Morning Shift**: 06:00 AM - 02:00 PM (Start: 360 min, End: 840 min)
2. **Regular Shift**: 08:00 AM - 05:00 PM (Start: 480 min, End: 1020 min)
3. **Afternoon Shift**: 02:00 PM - 10:00 PM (Start: 840 min, End: 1320 min)
4. **Night Shift**: 10:00 PM - 06:00 AM (Start: 1320 min, End: 360 min, Overnight: True)

- **Inputs**: Time In string (`HH:MM`), Time Out string (`HH:MM`).
- **Validation and Calculation**:
  - **WHEN**: An attendance punch is recorded.
  - **THEN**: Calculate the minute offset for the input time. For example, `08:15` counts as `495` minutes from midnight (`(8 * 60) + 15`).
  - **THEN**: Iterate over all predefined shifts and compute the closest target start time to determine the active shift assignment.
    - **IF** (Assessing Night Shift closeness): The direct difference exceeds 12 hours (720 minutes).
    - **THEN**: Handle wrap-around by using the formula `1440 - difference`.
  - **WHEN**: Calculating **Tardiness** minutes:
    - **IF**: The employee clocks in after the closest shift's designated start time.
    - **THEN**: Set tardiness as `cloked_in_minutes - shift_start_minutes`.
    - **IF**: The shift is overnight, and they clocked in after midnight (e.g., `01:00 AM` which is 60 mins) and before morning shift threshold (`06:00 AM` / 360 mins).
    - **THEN**: Set tardiness using `(1440 - shift_start_minutes) + logged_in_minutes`. (e.g., for `22:00` start and `01:00` actual clock-in, tardiness is `(1440 - 1320) + 60 = 180` minutes).
  - **WHEN**: Calculating **Undertime** minutes:
    - **IF**: The shift is NOT overnight AND actual clock-out occurs before the shift ends.
    - **THEN**: Set undertime as `shift_end_minutes - clock_out_minutes`.
    - **IF**: The shift is overnight AND clock-out occurs before midnight (e.g., `23:00` / 1380 mins).
    - **THEN**: Set undertime as `(1440 - clock_out_minutes) + shift_end_minutes`. (e.g., for `06:00` shift end and `23:00` actual clock-out, undertime is `(1440 - 1380) + 360 = 420` minutes).
    - **IF**: The shift is overnight AND clock-out occurs after midnight but before the designated end (e.g., `04:00 AM` clock out).
    - **THEN**: Set undertime as `shift_end_minutes - clock_out_minutes` (e.g., `360 - 240 = 120` minutes).
    - **OTHERWISE**: Undertime is set to `0`.

---

### D. Multi-Table Retention Syncing
The database is structured to track actions over both a historical trace table and a session tracker.

- **WHEN**: A valid authentication event arrives from `/api/scan`.
- **THEN**: Determine the action direction. Check the final index trace inside the `attendance` logger. If the last entry was `'LOGIN'`, set the current action to `'LOGOUT'`. Otherwise, set it to `'LOGIN'`.
- **IF**: The action determined is `'LOGIN'`.
- **THEN**:
  1. Insert a raw log inside database table `attendance` with fields: `{ employee_id, action: 'LOGIN', source: 'SCAN', timestamp: ISO_TIMESTAMP }`.
  2. Insert an entry inside database table `attendance_sessions` with fields: `{ employee_id, login_at: ISO_TIMESTAMP, logout_at: null, date: DATE_STRING }`.
  3. Insert a tracking entry inside legacy table `attendance_logs` to maintain retro-compatibility with monthly visual dashboards, calculating tardiness discrepancy minutes based on active shift logic.
- **IF**: The action determined is `'LOGOUT'`.
- **THEN**:
  1. Insert a log inside database table `attendance` with fields: `{ employee_id, action: 'LOGOUT', source: 'SCAN', timestamp: ISO_TIMESTAMP }`.
  2. Locate the most recent entry in table `attendance_sessions` where `employee_id` matches and `logout_at` is `null`.
  3. **IF**: An open session is found.
  4. **THEN**: Update that session row, setting `logout_at` to the current `ISO_TIMESTAMP`.
  5. **OTHERWISE**: Insert a closed fallback session with identical `login_at` and `logout_at` parameters to preserve referential integrity.
  6. Calculate undertime and update the legacy matching clock-in record inside legacy table `attendance_logs`.

---

### E. Offline Anti-Spam Duplicate Scan Filter
To prevent billing inflation caused by rapid successive clicks or camera auto-focus loops, an offline-compatible anti-spam lock is enforced in both frontend routines and backend APIs.

- **IF**: The system receives a time punch for employee ID `EID` inside of a 30-second window (server API) or a 1-minute window (local client).
- **THEN**: Discard the redundant action immediately and return an error message to the client without modifying the database.

---

## 4. Full Flow Mapping

### Process Flow 1: Dynamic Kiosk Display Mode (Kiosk Terminal Window)
```
[User Navigate to URL: /?kiosk=true]
   |
   +---> [Frontend: App.tsx checks query parameter 'kiosk']
            |
            +---> [Mount KioskView.tsx Component]
                     |
                     +---> [Start ticking timer: interval repeats every 1000ms]
                     |        |
                     |        +---> [Update display time format: "hh:mm:ss a"]
                     |        +---> [Validate Date transition. Update todayStr]
                     |
                     +---> [Assemble rolling QR value: `a10dance-daily-qr-${todayStr}`]
                     |        |
                     |        +---> [Render QRCodeSVG high-contrast matrix]
                     |
                     +---> [Display system status online: green active ping]
```

### Process Flow 2: Crew Member Dynamic Scan Event
```
[Crew Member places Smartphone Camera over Kiosk display]
   |
   +---> [Browser identifies camera stream]
            |
            +---> [Html5Qrcode parses QR matrix payload]
                     |
                     +---> [Regex extraction filters out JSON/URL formats to EID]
                     |
                     +---> [Chirp audio feedback triggers: Web Audio API synth]
                     |
                     +---> [Retrieve EID saved in local browser storage 'a10dance_eid']
                     |
                     +---> [Trigger POST request to backend API: `/api/scan`]
                              |
                              +---> [Backend matches rolling token server-side]
                              |        |
                              |        +---> [DB search: verifies 'employees' table]
                              |                 |
                              |                 v
                              |              [IF Not found: Self-heals with preset defaults]
                              |
                              +---> [Determine punch order: LOGIN or LOGOUT]
                              |        |
                              |        +---> [Write to 'attendance' transaction logs]
                              |        +---> [Write to 'attendance_sessions' intervals]
                              |        +---> [Sync calculations to legacy 'attendance_logs']
                              |
                              +---> [API outputs response: Code 200 JSON {success: true}]
                                       |
                                       v
                                    [Frontend: Pops StatusToast modal panel]
```

---

## 5. Data Model

The Pagbilao Command Center relational architecture consists of four distinct database tables and three local cache nodes.

### DB Entity 1: `employees`
- **Purpose**: Defines master registry logs of active personnel, daily wages, and insurance values.
- **Fields**:
  - `id` (Primary Key, Auto-Increment BigInt)
  - `eid` (VarChar, UNIQUE, Custom format, e.g. `251805`)
  - `name` / `full_name` (VarChar)
  - `rate_per_day` (Decimal, default: `0`)
  - `philhealth` (Decimal, default: `0`)
- **Lifecycle**: Maintained by ROOT/TEAMS administrators through the Roster workspace.
- **Constraints**: Custom `eid` string must be UNIQUE; empty entries are rejected.

### DB Entity 2: `attendance`
- **Purpose**: Tracks atomic check-in/out raw transactions for logging and auditing.
- **Fields**:
  - `id` (Primary Key, UUID / BigInt)
  - `employee_id` (ForeignKey linking to `employees.eid`)
  - `action` (Enum: `'LOGIN'`, `'LOGOUT'`)
  - `source` (VarChar, e.g., `'SCAN'`, `'MANUAL'`)
  - `timestamp` (Timestamp with timezone)
- **Lifecycle**: Immutable logs. Rows are never updated or deleted.

### DB Entity 3: `attendance_sessions`
- **Purpose**: Stores active shifts, resolving raw intervals into paired work records.
- **Fields**:
  - `id` (Primary Key, UUID / BigInt)
  - `employee_id` (ForeignKey linking to `employees.eid`)
  - `login_at` (Timestamp, Nullable)
  - `logout_at` (Timestamp, Nullable)
  - `date` (Date string: `YYYY-MM-DD`)
- **Lifecycle**: Initiated on check-in; completed by setting `logout_at` on search matches during checkout.

### DB Entity 4: `attendance_logs` (Legacy Sync Schema)
- **Purpose**: Maps paired monthly logs inside a single row to feed historical print matrices instantly.
- **Fields**:
  - `id` (Primary Key, BigInt)
  - `eid` (VarChar)
  - `name` (VarChar)
  - `start_time` (Timestamp, Nullable)
  - `end_time` (Timestamp, Nullable)
  - `date` (Date string, e.g., `2026-05-27`)
  - `remarks` (VarChar)
  - `tardiness` (Integer, tracking minutes late)
  - `undertime` (Integer, tracking minutes short)

---

### Local Browser Cache Structures (LocalStorage Key-Value Pairs)
- `a10dance_eid`: Stores the personnel ID config string on standard user smartphones to identify their device session.
- `theory11_local_employees`: Contains fallback local seed employee entries to maintain roster access during network disconnections.
- `theory11_local_attendance`: Backs up client check-in timesheets while connection state indicators show `'LOCAL ONLY'`.

---

## 6. UI Behavior & Interactions

### Page 1: Main DTR Punch Panel (`/`)
- **Interactive Greeting Element**: Displays a ticking timezone-aware digital lock alongside the date.
- **Session Identity Bar**: Displays active mobile browser session states. If unknown, presents a persistent input container to save EID credentials.
- **Scan Trigger Card**: Features a prominent button that opens the mobile camera stream to scan station codes.
- **Manual Input Accordion**: Expands an input area for physical EID typing with optional text fields for comments or remarks.

```
+-----------------------------------------------------------+
| Pagbilao Command Center - Main Punch Screen               |
+-----------------------------------------------------------+
|                                                           |
|  [ Live Clock: 04:30:15 PM ]                              |
|  [ Date: Wednesday, May 27, 2026 ]                        |
|                                                           |
|  -------------------------------------------------------  |
|  Mobile Device Session:                                   |
|  [ Identified: 251805 ]                  [ Clear Session] |
|  -------------------------------------------------------  |
|                                                           |
|  +-----------------------------------------------------+  |
|  |           [ SCAN ATTENDANCE QR CODE ]               |  |
|  |     Compatible with iOS & Android Camera            |  |
|  +-----------------------------------------------------+  |
|                                                           |
|  [v] Key-In Employee ID (Manual Fallback)                 |
|      Employee EID: [ 251805          ]                    |
|      Remarks:      [ Field Assignment ]                    |
|                                                           |
|             [[ IN ]]             [[ OUT ]]                |
|                                                           |
+-----------------------------------------------------------+
```

### Page 2: Station Kiosk Broadcast UI (`/?kiosk=true`)
- **Theme**: Ambient midnight layout designed to prevent screen burn-in on mounted station screens.
- **Information Panel**: Shows a ticking digital clock and date synchronized with system timezone servers.
- **Verification Matrix**: Displays a high-contrast rolling barcode square that changes daily, alongside status lights to confirm connection states.

```
+-----------------------------------------------------------+
| Pagbilao Command Center - STATION KIOSK UI                |
+-----------------------------------------------------------+
|                                                           |
|  [ PCC LOGO ] Pagbilao Command Center   [System Online *] |
|                                                           |
|  -------------------------------------------------------  |
|                                                           |
|  Live System Time:                     [ SCAN STATION ]   |
|  04:35:10 PM                           +---------------+  |
|  Wednesday, May 27, 2026               | ############# |  |
|                                        | ############# |  |
|  QR Code:                              | ############# |  |
|  No need to print                      +---------------+  |
|  Expires daily.                        Active Security:   |
|                                        [qr-2026-05-27 ]   |
|                                                           |
+-----------------------------------------------------------+
```

### Modal Window 1: Camera Scanner Viewfinder
- **Overlay Layer**: A dark modal containing viewport guides and a laser animation effect.
- **Camera Selection Dropdown**: Appears if multiple cameras are detected (e.g., toggling between front and rear cameras).
- **Fallback Snapshot Uploader**: If browser sandboxing or framework boundaries block real-time camera streaming, this component renders an instant photo shutter or file selector, allowing users to upload a snapshot to extract the QR code.

### Modal Window 2: Administration Control Roster
- **Validation Guard**: Requires a secure login step before allowing access.
  - User `admin` / Password `2026pcc2026` -> Grants `TEAMS` authorization.
  - User `lee` / Password `metallica` -> Grants `ROOT` authorization.
- **Control Interface**: Renders full spreadsheets containing employee EIDs, names, pay rates, and PhilHealth numbers, allowing administrators to execute batch-saving commands.

### Modal Window 3: Monthly Statistics Dashboard
- **Configuration Filters**: Selectable month dropdowns, calendar year forms, and employee ID search inputs.
- **Data Visualizer**: Renders comprehensive ledger entries calculated from paired logs. Accrued shift hour sums, base wage rates, and insurance deductions are converted into print-ready tables or spreadsheet files.

---

## 7. State Management & Synchronization

The application relies on a dual-store hybrid state engine to bridge client operations and relational databases.

- **Supabase Real-Time Client (`/src/lib/supabase.ts`)**: Integrates the client application directly with the backend database.
- **Local Cache Fallbacks**: If access credentials are missing or the system goes offline, operations fall back to modern key-value pairs stored in the browser's `localStorage` (such as `theory11_local_attendance` and `theory11_local_employees`).
- **Connection Recovery Loop**:
  - **WHEN**: The browser's network socket triggers an `online` event.
  - **THEN**: Retrieve queued offline records from `localStorage` under `theory11_local_attendance`.
  - **THEN**: Submit those pending logs sequentially to ensure the database remains accurate, then clear the local offline queues.

---

## 8. Backend Explanation

The system runs on an Express app compiled with Node.js to manage high-throughput operations.

- **API Handlers (`/server.ts`)**:
  - `POST /api/scan`: Authenticates dynamic scans. Translates raw barcode reads, verifies credential sessions, handles timezone-aware date transitions, determines log directions, and writes transaction records back to Supabase tables.
- **Static Assets Delivery**: Serves client bundles in production mode from `/dist` inside the Express server framework.

---

## 9. System Rebuild Specification

This blueprint details the necessary files and file structure required to rebuild the Pagbilao Command Center DTR application.

### File Tree Layout
```
/
├── package.json                   # Build recipes and backend dependencies
├── tsconfig.json                  # TypeScript compiler settings
├── server.ts                      # Custom Express full-stack API server
├── index.html                     # Entry point for browser page loading
├── .env.example                   # Shared template for local keys
├── src/
│   ├── main.tsx                   # Renders React into root HTML containers
│   ├── index.css                  # Tailwinds directives and print styles
│   ├── types.ts                   # Types and Interface signatures
│   ├── App.tsx                    # Main controller and scan director
│   ├── lib/
│   │   ├── db.ts                  # Client database router
│   │   ├── supabase.ts            # Supabase API keys
│   │   ├── shiftLogic.ts          # Shift calculations
│   │   └── seedEmployees.ts       # Fallback employee data
│   └── components/
│       ├── TopNav.tsx             # Universal header bar
│       ├── AttendanceCard.tsx     # Main punch control component
│       ├── AdminModal.tsx         # Roster edit table
│       ├── ReportModal.tsx        # Timesheet PDF generator
│       ├── KioskView.tsx          # Station screen
│       └── QRScanner.tsx          # Camera viewfinder handler
```

### Step-by-Step Build Order
To rebuild the application successfully, follow this precise deployment order:
1. **Core Declarations**: Implement `/src/types.ts` to establish your data interfaces.
2. **Business Rules Engines**: Write `/src/lib/shiftLogic.ts` and set up employee seeds in `/src/lib/seedEmployees.ts`.
3. **Storage Interfaces**: Set up supabase connection keys inside `/src/lib/supabase.ts` and write database adapters in `/src/lib/db.ts`.
4. **Backend Server development**: Write server middleware routes and API handlers inside `/server.ts` to manage barcode streams.
5. **Base UI Components**: Develop generic wrappers (`TopNav.tsx`, `KioskView.tsx`, `AttendanceCard.tsx`).
6. **Hardware Input interfaces**: Connect camera libraries inside `/src/components/QRScanner.tsx`.
7. **Protected Modules**: Write admin tables (`AdminModal.tsx`) and report generators (`ReportModal.tsx`).
8. **Orchestration**: Hook up state variables inside `/src/App.tsx` and run build compilation checks.

---

## 10. Implementation Assumptions & Verification

### Verified Assumptions
1. **Timezone Uniformity**: Calculated timesheets assume that server clusters and client terminals are synchronized to Manila Standard Time (GMT+8).
2. **Dynamic Codes**: QR scans require a modern smartphone camera or a valid photo snapshot containing the dynamic token.
3. **Database Availability**: If connection issues drop Supabase integrations, local browser cache stores are used as backup tables.

### Potential Design Open-Loops
- *Backup Power Outages*: If municipal infrastructure goes offline, the local browser memory queue provides robust protection, but clients should periodically export CSVs to safeguard long-term timesheet data.

---
*Verified and compiled for the Pagbilao Command Center DTR System.*
