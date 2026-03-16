import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";

const databasePath = path.resolve("data", "company_demo.db");
const backupPath = path.resolve(
  "data",
  `company_demo.backup-before-clean-reseed-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);
const companyTimeZone = "Europe/Vienna";
const defaultPassword = "demo1234";

const customFields = [
  {
    id: "bereich",
    label: "Bereich",
    type: "select",
    targets: ["work"],
    required: true,
    placeholder: null,
    options: [
      { id: "anmeldung", label: "Anmeldung", value: "Anmeldung" },
      { id: "ordination", label: "Ordination", value: "Ordination" },
      { id: "labor", label: "Labor", value: "Labor" },
      { id: "telefon", label: "Telefon", value: "Telefon" },
      { id: "behandlung", label: "Behandlung", value: "Behandlung" },
    ],
  },
  {
    id: "taetigkeit",
    label: "Taetigkeit",
    type: "select",
    targets: ["work"],
    required: true,
    placeholder: null,
    options: [
      { id: "visite", label: "Visite", value: "Visite" },
      { id: "sprechstunde", label: "Sprechstunde", value: "Sprechstunde" },
      { id: "befund", label: "Befund", value: "Befund" },
      { id: "op_vorbereitung", label: "OP Vorbereitung", value: "OP Vorbereitung" },
      { id: "infusion", label: "Infusionsvorbereitung", value: "Infusionsvorbereitung" },
      { id: "verwaltung", label: "Verwaltung", value: "Verwaltung" },
      { id: "dokumentation", label: "Dokumentation", value: "Dokumentation" },
    ],
  },
  {
    id: "ort",
    label: "Ort",
    type: "select",
    targets: ["work"],
    required: true,
    placeholder: null,
    options: [
      { id: "empfang", label: "Empfang", value: "Empfang" },
      { id: "raum_1", label: "Raum 1", value: "Raum 1" },
      { id: "raum_2", label: "Raum 2", value: "Raum 2" },
      { id: "labor", label: "Labor", value: "Labor" },
      { id: "op", label: "OP", value: "OP" },
    ],
  },
];

const staff = [
  {
    username: "anna.leitner",
    fullName: "Dr. Anna Leitner",
    role: "admin",
    pinCode: "2468",
    email: "anna.leitner@demo-ordination.at",
    contract: { hoursPerWeek: 38.5, paymentPerHour: 58 },
    active: true,
  },
  {
    username: "daniel.aichinger",
    fullName: "Daniel Aichinger",
    role: "manager",
    pinCode: "1357",
    email: "daniel.aichinger@demo-ordination.at",
    contract: { hoursPerWeek: 40, paymentPerHour: 32 },
    active: true,
  },
  {
    username: "verena.koller",
    fullName: "Verena Koller",
    role: "manager",
    pinCode: "8642",
    email: "verena.koller@demo-ordination.at",
    contract: { hoursPerWeek: 32, paymentPerHour: 33 },
    active: true,
  },
  {
    username: "lukas.gruber",
    fullName: "Dr. Lukas Gruber",
    role: "employee",
    pinCode: "1122",
    email: "lukas.gruber@demo-ordination.at",
    contract: { hoursPerWeek: 32, paymentPerHour: 25 },
    active: true,
  },
  {
    username: "sarah.moser",
    fullName: "Dr. Sarah Moser",
    role: "employee",
    pinCode: "2233",
    email: "sarah.moser@demo-ordination.at",
    contract: { hoursPerWeek: 30, paymentPerHour: 27 },
    active: true,
  },
  {
    username: "eva.schober",
    fullName: "Eva Schober",
    role: "employee",
    pinCode: "3344",
    email: "eva.schober@demo-ordination.at",
    contract: { hoursPerWeek: 25, paymentPerHour: 24 },
    active: true,
  },
  {
    username: "maria.hauser",
    fullName: "Maria Hauser",
    role: "employee",
    pinCode: "4455",
    email: "maria.hauser@demo-ordination.at",
    contract: { hoursPerWeek: 35, paymentPerHour: 26 },
    active: true,
  },
];

const scheduleTemplates = {
  "Dr. Anna Leitner": {
    weekdayWork: [1, 2, 3, 4, 5],
    slots: ["07:30-16:00", "08:00-16:30", "08:15-17:00", "07:45-15:45"],
    notes: ["Vormittagsordination", "Befundfreigabe", "Patientengespraeche", "OP Abstimmung"],
    fieldTriples: [
      ["Ordination", "Sprechstunde", "Raum 1"],
      ["Behandlung", "Visite", "Raum 2"],
      ["Ordination", "Befund", "Empfang"],
      ["Telefon", "Dokumentation", "Labor"],
    ],
    vacationRanges: [{ startDate: "2026-02-23", endDate: "2026-02-27", notes: "Skiurlaub Tirol" }],
    sickLeaveRanges: [],
  },
  "Daniel Aichinger": {
    weekdayWork: [1, 2, 3, 4, 5],
    slots: ["07:30-16:30", "08:00-17:00", "07:15-15:45", "08:30-16:00"],
    notes: ["Dienstplanung", "Visite Koordination", "Materialabstimmung", "Tageskoordination"],
    fieldTriples: [
      ["Ordination", "Verwaltung", "Empfang"],
      ["Telefon", "Visite", "Raum 2"],
      ["Anmeldung", "Dokumentation", "Empfang"],
      ["Labor", "OP Vorbereitung", "OP"],
    ],
    vacationRanges: [],
    sickLeaveRanges: [],
  },
  "Verena Koller": {
    weekdayWork: [1, 2, 3, 4],
    slots: ["07:30-15:30", "08:00-16:00", "07:45-15:45"],
    notes: ["Empfangskoordination", "Verwaltungsblock", "Telefonorganisation"],
    fieldTriples: [
      ["Anmeldung", "Verwaltung", "Empfang"],
      ["Telefon", "Dokumentation", "Empfang"],
      ["Ordination", "Sprechstunde", "Raum 1"],
    ],
    vacationRanges: [{ startDate: "2026-03-05", endDate: "2026-03-06", notes: "Kurzurlaub Salzburg" }],
    sickLeaveRanges: [],
  },
  "Dr. Lukas Gruber": {
    weekdayWork: [1, 2, 4, 5],
    slots: ["08:00-16:00", "08:15-16:45", "09:00-17:00"],
    notes: ["Nachmittagsordination", "Kontrolltermine", "Befundbesprechung"],
    fieldTriples: [
      ["Ordination", "Sprechstunde", "Raum 1"],
      ["Behandlung", "Visite", "Raum 2"],
      ["Labor", "Befund", "Labor"],
    ],
    vacationRanges: [{ startDate: "2026-03-02", endDate: "2026-03-04", notes: "Erholungsurlaub" }],
    sickLeaveRanges: [],
  },
  "Dr. Sarah Moser": {
    weekdayWork: [1, 2, 3, 4, 5],
    slots: ["08:00-15:30", "08:15-16:00", "09:00-17:00", "07:30-15:00"],
    notes: ["Labororganisation", "Vormittagsordination", "Rueckfragen", "Kontrolltermine"],
    fieldTriples: [
      ["Labor", "Befund", "Labor"],
      ["Ordination", "Sprechstunde", "Raum 2"],
      ["Telefon", "Dokumentation", "Empfang"],
      ["Behandlung", "Infusionsvorbereitung", "Raum 1"],
    ],
    vacationRanges: [],
    sickLeaveRanges: [{ startDate: "2026-02-18", endDate: "2026-02-20", notes: "Grippaler Infekt" }],
  },
  "Eva Schober": {
    weekdayWork: [1, 2, 3, 4, 5],
    slots: ["07:30-13:30", "08:00-14:00", "08:30-14:30"],
    notes: ["Empfangsdienst", "Telefonmanagement", "Patientenannahme"],
    fieldTriples: [
      ["Anmeldung", "Sprechstunde", "Empfang"],
      ["Telefon", "Verwaltung", "Empfang"],
      ["Anmeldung", "Dokumentation", "Empfang"],
    ],
    vacationRanges: [{ startDate: "2026-02-12", endDate: "2026-02-13", notes: "Familienurlaub" }],
    sickLeaveRanges: [],
  },
  "Maria Hauser": {
    weekdayWork: [1, 2, 3, 4, 5],
    slots: ["07:00-15:00", "07:30-15:30", "08:00-16:00", "08:30-16:30"],
    notes: ["Infusionsvorbereitung", "Praxisorganisation", "Befundablage", "Materialcheck"],
    fieldTriples: [
      ["Behandlung", "Infusionsvorbereitung", "Raum 2"],
      ["Labor", "Dokumentation", "Labor"],
      ["Anmeldung", "Verwaltung", "Empfang"],
      ["Ordination", "OP Vorbereitung", "OP"],
    ],
    vacationRanges: [],
    sickLeaveRanges: [{ startDate: "2026-03-09", endDate: "2026-03-10", notes: "Akute Erkaeltung" }],
  },
};

function toInstantIso(day, clockTime) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = clockTime.split(":").map(Number);
  return Temporal.ZonedDateTime.from(
    {
      timeZone: companyTimeZone,
      year,
      month,
      day: date,
      hour,
      minute,
      second: 0,
      millisecond: 0,
    },
    { disambiguation: "reject" },
  ).toInstant().toString();
}

function toNoonInstantIso(day) {
  return toInstantIso(day, "12:00");
}

function enumerateBusinessDays(startDay, endDay) {
  const start = Temporal.PlainDate.from(startDay);
  const end = Temporal.PlainDate.from(endDay);
  const days = [];
  for (let cursor = start; Temporal.PlainDate.compare(cursor, end) <= 0; cursor = cursor.add({ days: 1 })) {
    if (cursor.dayOfWeek <= 5) {
      days.push(cursor.toString());
    }
  }
  return days;
}

function isWithinRange(day, range) {
  return day >= range.startDate && day <= range.endDate;
}

function resetDemoData(db) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM time_entries;
    DELETE FROM user_contracts;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('users', 'user_contracts', 'time_entries');
    PRAGMA foreign_keys = ON;
  `);
}

function seedSettings(db) {
  db.prepare(`
    UPDATE company_settings
    SET currency = @currency,
        locale = @locale,
        time_zone = @timeZone,
        date_time_format = @dateTimeFormat,
        first_day_of_week = @firstDayOfWeek,
        edit_days_limit = @editDaysLimit,
        insert_days_limit = @insertDaysLimit,
        allow_one_record_per_day = @allowOneRecordPerDay,
        allow_intersecting_records = @allowIntersectingRecords,
        country = @country,
        tablet_idle_timeout_seconds = @tabletIdleTimeoutSeconds,
        auto_break_after_minutes = @autoBreakAfterMinutes,
        auto_break_duration_minutes = @autoBreakDurationMinutes,
        custom_fields_json = @customFieldsJson
    WHERE id = 1
  `).run({
    currency: "EUR",
    locale: "de-AT",
    timeZone: companyTimeZone,
    dateTimeFormat: "g",
    firstDayOfWeek: 1,
    editDaysLimit: 120,
    insertDaysLimit: 120,
    allowOneRecordPerDay: 0,
    allowIntersectingRecords: 0,
    country: "AT",
    tabletIdleTimeoutSeconds: 10,
    autoBreakAfterMinutes: 360,
    autoBreakDurationMinutes: 30,
    customFieldsJson: JSON.stringify(customFields),
  });
}

function insertUser(db, person) {
  const result = db.prepare(`
    INSERT INTO users (
      username,
      full_name,
      password_hash,
      role,
      is_active,
      created_at,
      pin_code,
      email
    ) VALUES (
      @username,
      @fullName,
      @passwordHash,
      @role,
      @isActive,
      @createdAt,
      @pinCode,
      @email
    )
  `).run({
    username: person.username,
    fullName: person.fullName,
    passwordHash: bcrypt.hashSync(defaultPassword, 10),
    role: person.role,
    isActive: person.active ? 1 : 0,
    createdAt: "2026-01-01T08:00:00.000Z",
    pinCode: person.pinCode,
    email: person.email,
  });

  const userId = Number(result.lastInsertRowid);
  db.prepare(`
    INSERT INTO user_contracts (
      user_id,
      hours_per_week,
      start_date,
      end_date,
      payment_per_hour,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    person.contract.hoursPerWeek,
    "2026-01-01",
    null,
    person.contract.paymentPerHour,
    "2026-01-01T08:00:00.000Z",
  );

  return userId;
}

function insertWorkEntry(db, userId, day, template, index) {
  const slot = template.slots[index % template.slots.length];
  const [startClock, endClock] = slot.split("-");
  const note = template.notes[index % template.notes.length];
  const [practiceArea, serviceLine, location] = template.fieldTriples[index % template.fieldTriples.length];
  const startTime = toInstantIso(day, startClock);
  const endTime = toInstantIso(day, endClock);

  db.prepare(`
    INSERT INTO time_entries (
      user_id,
      entry_type,
      entry_date,
      end_date,
      start_time,
      end_time,
      notes,
      custom_field_values_json,
      created_at
    ) VALUES (?, 'work', ?, NULL, ?, ?, ?, ?, ?)
  `).run(
    userId,
    day,
    startTime,
    endTime,
    note,
    JSON.stringify({
      bereich: practiceArea,
      taetigkeit: serviceLine,
      ort: location,
    }),
    startTime,
  );
}

function insertLeaveEntry(db, userId, entryType, startDate, endDate, notes) {
  const startTime = toNoonInstantIso(startDate);
  const endTime = toNoonInstantIso(endDate);
  db.prepare(`
    INSERT INTO time_entries (
      user_id,
      entry_type,
      entry_date,
      end_date,
      start_time,
      end_time,
      notes,
      custom_field_values_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
  `).run(
    userId,
    entryType,
    startDate,
    endDate,
    startTime,
    endTime,
    notes,
    startTime,
  );
}

if (!fs.existsSync(databasePath)) {
  throw new Error(`Demo database not found at ${databasePath}`);
}

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("wal_checkpoint(TRUNCATE)");
fs.copyFileSync(databasePath, backupPath);

const seedTransaction = db.transaction(() => {
  resetDemoData(db);
  seedSettings(db);

  const userIds = new Map();
  for (const person of staff) {
    userIds.set(person.fullName, insertUser(db, person));
  }

  const businessDays = enumerateBusinessDays("2026-02-02", "2026-03-13");
  for (const person of staff) {
    const userId = userIds.get(person.fullName);
    const template = scheduleTemplates[person.fullName];
    let workIndex = 0;

    for (const day of businessDays) {
      const weekday = Temporal.PlainDate.from(day).dayOfWeek;
      const onVacation = template.vacationRanges.some((range) => isWithinRange(day, range));
      const onSickLeave = template.sickLeaveRanges.some((range) => isWithinRange(day, range));
      if (onVacation || onSickLeave || !template.weekdayWork.includes(weekday)) {
        continue;
      }

      insertWorkEntry(db, userId, day, template, workIndex);
      workIndex += 1;
    }

    for (const range of template.vacationRanges) {
      insertLeaveEntry(db, userId, "vacation", range.startDate, range.endDate, range.notes);
    }

    for (const range of template.sickLeaveRanges) {
      insertLeaveEntry(db, userId, "sick_leave", range.startDate, range.endDate, range.notes);
    }
  }
});

seedTransaction();
db.pragma("wal_checkpoint(TRUNCATE)");

const summary = {
  users: db.prepare("SELECT id, full_name, role FROM users ORDER BY id").all(),
  entryCounts: db.prepare(`
    SELECT entry_type, COUNT(*) AS count
    FROM time_entries
    GROUP BY entry_type
    ORDER BY entry_type
  `).all(),
  zeroDurationWorkRows: db.prepare(`
    SELECT COUNT(*) AS count
    FROM time_entries
    WHERE entry_type = 'work'
      AND (start_time IS NULL OR end_time IS NULL OR start_time = end_time)
  `).get(),
};

db.close();

console.log(JSON.stringify({
  databasePath,
  backupPath,
  summary,
  credentials: {
    password: defaultPassword,
    users: staff.map((person) => ({
      username: person.username,
      fullName: person.fullName,
      role: person.role,
      pinCode: person.pinCode,
    })),
  },
}, null, 2));
