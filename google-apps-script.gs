/**
 * google-apps-script.gs
 * 
 * Google Apps Script Web App Endpoint for Pagbilao Command Center DTR.
 * This bridges Google Sheets directly with the Pagbilao DTR Full Stack Application.
 * 
 * INSTRUCTIONS FOR SETTING UP:
 * ----------------------------------------------------------------------------
 * 1. Create a blank Google Sheet or open your existing DTR spreadsheet.
 * 2. Click "Extensions" -> "Apps Script" in the top menu of your Google Sheet.
 * 3. Delete any default code in Code.gs and PASTE this entire script.
 * 4. Run any initial test function if needed, or proceed directly to Deploy.
 * 5. Click the "Deploy" button (top right) -> "New deployment".
 * 6. Click the gear icon next to "Select type" and choose "Web app".
 * 7. Change these exact three fields:
 *    - Description: "PCC Attendance Production Web App"
 *    - Execute as: "Me (your-google-account@gmail.com)"  <-- CRITICAL!
 *    - Who has access: "Anyone"                          <-- CRITICAL!
 * 8. Click "Deploy".
 * 9. Google will request you to "Authorize Access". Click it and complete the
 *    permission popup windows (Click Advanced -> Go to PCC Attendance (unsafe)).
 * 10. Copy the Web App URL that Google gives you (it MUST end in "/exec").
 * 11. Paste that URL into the Admin Modal Panel of your Pagbilao App to bind!
 * 
 * Note: Never copy your script editor URL ending in "/edit" or testing URL ending in "/dev".
 */

// SPREADSHEET CONFIGURATION:
// Leave this empty ("") if you opened this Apps Script from "Extensions -> Apps Script" inside the Google Sheet.
// If you are hosting the script separately, paste the Spreadsheet ID from the URL below:
var SPREADSHEET_ID = ""; 

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var payload = JSON.parse(rawData);
    var action = payload.action;
    
    // Select correct Spreadsheet (active container-bound or ID)
    var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error("Could not find or open active spreadsheet. Please specify a SPREADSHEET_ID or check Extensions -> Apps Script inside your sheet.");
    }
    
    var result = {};
    
    // --- action Router ---
    if (action === "get_employees") {
      var sheet = getOrCreateSheet(ss, "employees", ["ID", "EID", "Name", "DailyRate", "PhilHealth"]);
      var lastRow = sheet.getLastRow();
      var data = [];
      if (lastRow > 1) {
        data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      }
      // Clean and remove trailing/header empty rows where EID is missing
      var cleanData = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim() !== "") {
          cleanData.push(data[i]);
        }
      }
      result = { success: true, values: cleanData };
      
    } else if (action === "save_raw_attendance") {
      var sheet = getOrCreateSheet(ss, "attendance", ["ID", "EmployeeID", "Action", "Source", "Timestamp", "Remarks"]);
      var att = payload.attendance;
      sheet.appendRow([
        att.id,
        att.employee_id,
        att.action,
        att.source,
        att.timestamp,
        att.remarks || ""
      ]);
      result = { success: true };
      
    } else if (action === "process_session_and_legacy") {
      // 1. Synchronize attendance_sessions
      var sSheet = getOrCreateSheet(ss, "attendance_sessions", ["ID", "EmployeeID", "LoginAt", "LogoutAt", "Date"]);
      var session = payload.session;
      
      // Match by ID to update exists logout dates
      var foundSIndex = -1;
      var sLast = sSheet.getLastRow();
      if (sLast > 1) {
        var sValues = sSheet.getRange(1, 1, sLast, 1).getValues();
        for (var idx = sValues.length - 1; idx >= 1; idx--) {
          if (String(sValues[idx][0]) === String(session.id)) {
            foundSIndex = idx + 1; // 1-indexed conversion
            break;
          }
        }
      }
      
      if (foundSIndex !== -1) {
        sSheet.getRange(foundSIndex, 4).setValue(session.logout_at || "");
      } else {
        sSheet.appendRow([
          session.id,
          session.employee_id,
          session.login_at || "",
          session.logout_at || "",
          session.date
        ]);
      }
      
      // 2. Synchronize legacy grid records
      var lSheet = getOrCreateSheet(ss, "attendance_logs", ["ID", "EID", "Name", "StartTime", "EndTime", "Date", "Remarks", "Tardiness", "Undertime"]);
      var legacy = payload.legacy;
      
      var foundLIndex = -1;
      var lLast = lSheet.getLastRow();
      if (lLast > 1) {
        // Find most recent matching row where EndTime is empty for this crew's EID
        var lValues = lSheet.getRange(1, 1, lLast, 5).getValues();
        for (var jIdx = lValues.length - 1; jIdx >= 1; jIdx--) {
          if (String(lValues[jIdx][1]).trim() === String(legacy.eid).trim() && String(lValues[jIdx][4]).trim() === "") {
            foundLIndex = jIdx + 1;
            break;
          }
        }
      }
      
      if (foundLIndex !== -1 && legacy.end_time) {
        lSheet.getRange(foundLIndex, 5).setValue(legacy.end_time);
        lSheet.getRange(foundLIndex, 7).setValue(legacy.remarks || "");
        lSheet.getRange(foundLIndex, 9).setValue(legacy.undertime || 0);
      } else {
        lSheet.appendRow([
          legacy.id,
          legacy.eid,
          legacy.name,
          legacy.start_time || "",
          legacy.end_time || "",
          legacy.date,
          legacy.remarks || "",
          legacy.tardiness || 0,
          legacy.undertime || 0
        ]);
      }
      result = { success: true };
      
    } else if (action === "save_roster_update") {
      var sheet = getOrCreateSheet(ss, "employees", ["ID", "EID", "Name", "DailyRate", "PhilHealth"]);
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
      }
      var roster = payload.roster || [];
      for (var r = 0; r < roster.length; r++) {
        var emp = roster[r];
        sheet.appendRow([
          emp.id || r + 1,
          emp.eid,
          emp.name,
          emp.rate_per_day,
          emp.philhealth
        ]);
      }
      result = { success: true };
      
    } else if (action === "get_legacy_logs") {
      var sheet = getOrCreateSheet(ss, "attendance_logs", ["ID", "EID", "Name", "StartTime", "EndTime", "Date", "Remarks", "Tardiness", "Undertime"]);
      var lastRow = sheet.getLastRow();
      var data = [];
      if (lastRow > 1) {
        data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
      }
      var cleanLogs = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim() !== "") {
          cleanLogs.push(data[i]);
        }
      }
      result = { success: true, values: cleanLogs };
      
    } else if (action === "get_raw_attendance") {
      var sheet = getOrCreateSheet(ss, "attendance", ["ID", "EmployeeID", "Action", "Source", "Timestamp", "Remarks"]);
      var lastRow = sheet.getLastRow();
      var data = [];
      if (lastRow > 1) {
        data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
      }
      var cleanAtts = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim() !== "") {
          cleanAtts.push(data[i]);
        }
      }
      result = { success: true, values: cleanAtts };
      
    } else if (action === "get_sessions") {
      var sheet = getOrCreateSheet(ss, "attendance_sessions", ["ID", "EmployeeID", "LoginAt", "LogoutAt", "Date"]);
      var lastRow = sheet.getLastRow();
      var data = [];
      if (lastRow > 1) {
        data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      }
      var cleanSessions = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim() !== "") {
          cleanSessions.push(data[i]);
        }
      }
      result = { success: true, values: cleanSessions };
      
    } else {
      throw new Error("Action not recognized: " + action);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}
