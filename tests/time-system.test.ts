import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  combineLocalDayAndTimeToIsoInTimeZone,
  diffCalendarDays,
  enumerateLocalDays,
  formatDayInTimeZone,
  getLocalNowSnapshot,
  toClockTimeValue,
} from "../shared/utils/time.js";
import { closeCompanyDb, getCompanyDb } from "../backend/db/company-db.js";
import { timeService } from "../backend/services/time-service.js";

function verify(name: string, run: () => void) {
  run();
  process.stdout.write(`PASS ${name}\n`);
}

verify("getLocalNowSnapshot resolves business day in company timezone across UTC day boundary", () => {
  const instant = new Date("2026-03-15T23:07:04.000Z");
  const snapshot = getLocalNowSnapshot(instant, "Europe/Vienna");

  assert.equal(snapshot.localDay, "2026-03-16");
  assert.equal(formatDayInTimeZone(instant, "Asia/Shanghai"), "2026-03-16");
});

verify("combineLocalDayAndTimeToIsoInTimeZone round-trips exact wall time for distant timezones", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-03-16", "12:07", "Asia/Shanghai");

  assert.ok(instant);
  assert.equal(toClockTimeValue(instant, "Asia/Shanghai"), "12:07");
  assert.equal(formatDayInTimeZone(new Date(instant!), "Asia/Shanghai"), "2026-03-16");
});

verify("combineLocalDayAndTimeToIsoInTimeZone rejects DST gap wall times", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-03-29", "02:30", "Europe/Vienna");
  assert.equal(instant, null);
});

verify("combineLocalDayAndTimeToIsoInTimeZone rejects ambiguous DST overlap wall times", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-10-25", "02:30", "Europe/Vienna");
  assert.equal(instant, null);
});

verify("calendar day helpers stay deterministic", () => {
  assert.equal(diffCalendarDays("2026-03-16", "2026-03-15"), 1);
  assert.deepEqual(enumerateLocalDays("2026-03-29", "2026-04-02"), [
    "2026-03-29",
    "2026-03-30",
    "2026-03-31",
    "2026-04-01",
    "2026-04-02",
  ]);
});

verify("manual non-work entries store canonical UTC anchors instead of naive local timestamps", () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-time-test-"));
  const databasePath = join(tempDir, "company.db");

  try {
    const db = getCompanyDb(databasePath);
    db.prepare("INSERT INTO users (username, full_name, password_hash, role, is_active, created_at, pin_code) VALUES (?, ?, ?, ?, 1, ?, ?)").run(
      "test-user",
      "Test User",
      "hash",
      "employee",
      "2026-03-16T00:00:00.000Z",
      "1234",
    );
    db.prepare("UPDATE company_settings SET time_zone = ? WHERE id = 1").run("Europe/Vienna");

    const created = timeService.createManualEntry(databasePath, 1, {
      entryType: "vacation",
      startDate: "2026-03-16",
      endDate: "2026-03-18",
      startTime: null,
      endTime: null,
      notes: "",
      sickLeaveAttachment: null,
      customFieldValues: {},
    });

    const row = db.prepare("SELECT start_time, end_time FROM time_entries WHERE id = ?").get(created.id) as {
      start_time: string;
      end_time: string | null;
    };

    assert.match(row.start_time, /(?:Z|[+-]\d{2}:\d{2})$/);
    assert.match(row.end_time ?? "", /(?:Z|[+-]\d{2}:\d{2})$/);
    assert.equal(toClockTimeValue(row.start_time, "Europe/Vienna"), "12:00");
    assert.equal(formatDayInTimeZone(new Date(row.start_time), "Europe/Vienna"), "2026-03-16");
    assert.equal(formatDayInTimeZone(new Date(row.end_time ?? row.start_time), "Europe/Vienna"), "2026-03-18");
  } finally {
    closeCompanyDb(databasePath);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

process.stdout.write("Time system verification complete.\n");
