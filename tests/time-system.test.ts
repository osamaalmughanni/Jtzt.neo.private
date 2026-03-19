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
import { getCompanyDb } from "../backend/db/company-db.js";
import { getSystemDb, setSystemDbPathForTests, closeSystemDb } from "../backend/db/system-db.js";
import { createNodeDatabase } from "../backend/db/app-database.js";
import { timeService } from "../backend/services/time-service.js";

async function verify(name: string, run: () => void | Promise<void>) {
  await run();
  process.stdout.write(`PASS ${name}\n`);
}

(async () => {
await verify("getLocalNowSnapshot resolves business day in company timezone across UTC day boundary", () => {
  const instant = new Date("2026-03-15T23:07:04.000Z");
  const snapshot = getLocalNowSnapshot(instant, "Europe/Vienna");

  assert.equal(snapshot.localDay, "2026-03-16");
  assert.equal(formatDayInTimeZone(instant, "Asia/Shanghai"), "2026-03-16");
});

await verify("combineLocalDayAndTimeToIsoInTimeZone round-trips exact wall time for distant timezones", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-03-16", "12:07", "Asia/Shanghai");

  assert.ok(instant);
  assert.equal(toClockTimeValue(instant, "Asia/Shanghai"), "12:07");
  assert.equal(formatDayInTimeZone(new Date(instant!), "Asia/Shanghai"), "2026-03-16");
});

await verify("combineLocalDayAndTimeToIsoInTimeZone rejects DST gap wall times", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-03-29", "02:30", "Europe/Vienna");
  assert.equal(instant, null);
});

await verify("combineLocalDayAndTimeToIsoInTimeZone rejects ambiguous DST overlap wall times", () => {
  const instant = combineLocalDayAndTimeToIsoInTimeZone("2026-10-25", "02:30", "Europe/Vienna");
  assert.equal(instant, null);
});

await verify("calendar day helpers stay deterministic", () => {
  assert.equal(diffCalendarDays("2026-03-16", "2026-03-15"), 1);
  assert.deepEqual(enumerateLocalDays("2026-03-29", "2026-04-02"), [
    "2026-03-29",
    "2026-03-30",
    "2026-03-31",
    "2026-04-01",
    "2026-04-02",
  ]);
});

await verify("manual non-work entries store canonical UTC anchors instead of naive local timestamps", async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-time-test-"));
  const databasePath = join(tempDir, "app.db");
  const companyId = "11111111-1111-1111-1111-111111111111";

  try {
    setSystemDbPathForTests(databasePath);
    const db = getSystemDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(companyId, "Test Co", "2026-03-16T00:00:00.000Z");
    db.prepare(
      "INSERT INTO users (company_id, username, full_name, password_hash, role, is_active, created_at, pin_code) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(
      companyId,
      "test-user",
      "Test User",
      "hash",
      "employee",
      "2026-03-16T00:00:00.000Z",
      "1234",
    );
    getCompanyDb(companyId);
    db.prepare("UPDATE company_settings SET time_zone = ? WHERE company_id = ?").run("Europe/Vienna", companyId);

    const created = await timeService.createManualEntry(createNodeDatabase(databasePath), companyId, 1, {
      entryType: "vacation",
      startDate: "2026-03-16",
      endDate: "2026-03-18",
      startTime: null,
      endTime: null,
      notes: "",
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
    closeSystemDb();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

process.stdout.write("Time system verification complete.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
