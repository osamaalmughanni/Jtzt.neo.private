import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { createCompanyDatabase, createSystemDatabase } from "../backend/db/runtime-database";
import { adminService } from "../backend/services/admin-service";
import { calculationService } from "../backend/services/calculation-service";
import { systemService } from "../backend/services/system-service";
import { resolveRuntimeConfig } from "../backend/runtime/env";
import { createDefaultOvertimeSettings } from "../shared/utils/overtime";
import { combineLocalDayAndTimeToIsoInTimeZone, enumerateLocalDays, getIsoDayOfWeek, isWeekendDay } from "../shared/utils/time";
import type { CompanyCustomField, TimeEntryType, UserContractScheduleDay, UserRole } from "../shared/types/models";
import type { CompanySnapshot } from "../shared/types/api";

type SeedArgs = {
  companyName: string;
  year: number;
  users: number;
  projects: number;
  tasks: number;
  seed: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName: string;
};

type Rng = () => number;

const TIME_ZONE = "Europe/Vienna";
const COUNTRY_CODE = "AT";

const FIRST_NAMES = ["Anna", "Barbara", "Christoph", "Daniel", "Eva", "Franz", "Gabriele", "Hannes", "Isabel", "Johann", "Katharina", "Lukas", "Maria", "Niklas", "Olivia", "Paul", "Rita", "Stefan", "Theresa", "Valentin"];
const LAST_NAMES = ["Bauer", "Huber", "Mayer", "Gruber", "Wagner", "Pichler", "Fischer", "Auer", "Hofer", "Klein", "Jakob", "Berger", "Schmid", "Wolf", "Fuchs", "Neumann", "Reiter", "Böhm", "Mayr", "Leitner"];
const CLIENTS = ["ÖBB", "WKO", "Bundesministerium", "Land Tirol", "Stadt Wien", "A1", "Raiffeisen", "Salzburg AG"];
const PROJECT_NAMES = ["ERP Rollout", "Payroll Modernization", "Customer Portal", "Warehouse Digitization", "Internal Compliance", "Support Desk Revamp", "Cloud Migration", "Training & Onboarding"];
const TASK_TITLES = ["Kickoff", "Requirements", "Process Design", "Implementation", "QA", "Release", "Training", "Documentation", "Payroll Rules", "Helpdesk", "Audit Review", "Data Cleanup", "Migration", "Bugfixing", "UAT", "Steering", "Reporting", "Support", "Planning", "Ops Review", "Integration", "Testing", "Deployment", "Refinement"];

function parseArgs(argv: string[]): SeedArgs {
  const defaults: SeedArgs = {
    companyName: "demo",
    year: new Date().getFullYear(),
    users: 12,
    projects: 8,
    tasks: 24,
    seed: "demo-austria",
    adminUsername: "demo-admin",
    adminPassword: "Demo1234!",
    adminFullName: "Demo Admin",
  };

  const result = { ...defaults };
  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [rawKey, rawValue] = rawArg.slice(2).split("=", 2);
    const key = rawKey.trim();
    const value = (rawValue ?? "true").trim();
    if (key === "company") result.companyName = value;
    if (key === "year") result.year = Number(value);
    if (key === "users") result.users = Number(value);
    if (key === "projects") result.projects = Number(value);
    if (key === "tasks") result.tasks = Number(value);
    if (key === "seed") result.seed = value;
    if (key === "admin-username") result.adminUsername = value;
    if (key === "admin-password") result.adminPassword = value;
    if (key === "admin-full-name") result.adminFullName = value;
  }

  if (!Number.isInteger(result.year) || result.year < 2000) throw new Error("year must be a valid integer");
  if (!Number.isInteger(result.users) || result.users < 4) throw new Error("users must be at least 4");
  if (!Number.isInteger(result.projects) || result.projects < 3) throw new Error("projects must be at least 3");
  if (!Number.isInteger(result.tasks) || result.tasks < 6) throw new Error("tasks must be at least 6");
  return result;
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seedValue: string) {
  let state = hashSeed(seedValue) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(rng: Rng, min: number, max: number, digits = 2) {
  return Number((min + rng() * (max - min)).toFixed(digits));
}

function pick<T>(rng: Rng, values: readonly T[]) {
  return values[randInt(rng, 0, values.length - 1)];
}

function shuffle<T>(rng: Rng, values: readonly T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randInt(rng, 0, index);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function formatTime(hours: number, minutes = 0) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function makeIso(day: string, time: string) {
  const value = combineLocalDayAndTimeToIsoInTimeZone(day, time, TIME_ZONE);
  if (!value) throw new Error(`Could not resolve ${day} ${time} in ${TIME_ZONE}`);
  return value;
}

function addDays(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function toUsername(firstName: string, lastName: string) {
  return `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]+/g, "").replace(/\.+/g, ".");
}

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`;
}

function firstDayOfYear(year: number) {
  return `${year}-01-01`;
}

function lastDayOfYear(year: number) {
  return `${year}-12-31`;
}

function isWorkday(day: string) {
  const weekday = getIsoDayOfWeek(day);
  return weekday !== 6 && weekday !== 7;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildAustriaHolidays(year: number) {
  const easterSunday = getEasterSunday(year);
  const specs: Array<{ date?: string; offset?: number; localName: string; name: string }> = [
    { date: `${year}-01-01`, localName: "Neujahr", name: "New Year's Day" },
    { date: `${year}-01-06`, localName: "Heilige Drei Könige", name: "Epiphany" },
    { offset: 1, localName: "Ostermontag", name: "Easter Monday" },
    { date: `${year}-05-01`, localName: "Staatsfeiertag", name: "National Holiday" },
    { offset: 39, localName: "Christi Himmelfahrt", name: "Ascension Day" },
    { offset: 50, localName: "Pfingstmontag", name: "Whit Monday" },
    { offset: 60, localName: "Fronleichnam", name: "Corpus Christi" },
    { date: `${year}-08-15`, localName: "Mariä Himmelfahrt", name: "Assumption Day" },
    { date: `${year}-10-26`, localName: "Nationalfeiertag", name: "National Day" },
    { date: `${year}-11-01`, localName: "Allerheiligen", name: "All Saints' Day" },
    { date: `${year}-12-08`, localName: "Mariä Empfängnis", name: "Immaculate Conception" },
    { date: `${year}-12-25`, localName: "Christtag", name: "Christmas Day" },
    { date: `${year}-12-26`, localName: "Stefanitag", name: "St. Stephen's Day" },
  ];

  return specs.map((spec) => ({
    date: spec.date ?? addDays(easterSunday, spec.offset ?? 0),
    localName: spec.localName,
    name: spec.name,
    countryCode: COUNTRY_CODE,
  }));
}

function buildCustomFields(): CompanyCustomField[] {
  return [
    { id: "user_cost_center", label: "Kostenstelle", type: "select", targets: [{ scope: "user" }], required: true, placeholder: null, options: [
      { id: "engineering", label: "Engineering", value: "engineering" },
      { id: "operations", label: "Operations", value: "operations" },
      { id: "sales", label: "Sales", value: "sales" },
      { id: "admin", label: "Admin", value: "admin" },
    ] },
    { id: "user_work_model", label: "Arbeitsmodell", type: "select", targets: [{ scope: "user" }], required: false, placeholder: null, options: [
      { id: "office", label: "Office", value: "office" },
      { id: "hybrid", label: "Hybrid", value: "hybrid" },
      { id: "remote", label: "Remote", value: "remote" },
    ] },
    { id: "user_home_office", label: "Home Office", type: "boolean", targets: [{ scope: "user" }], required: false, placeholder: null, options: [] },
    { id: "project_client", label: "Kunde", type: "text", targets: [{ scope: "project" }], required: false, placeholder: "ÖBB", options: [] },
    { id: "project_billable", label: "Abrechenbar", type: "boolean", targets: [{ scope: "project" }], required: false, placeholder: null, options: [] },
    { id: "task_category", label: "Kategorie", type: "select", targets: [{ scope: "task" }], required: false, placeholder: null, options: [
      { id: "delivery", label: "Delivery", value: "delivery" },
      { id: "support", label: "Support", value: "support" },
      { id: "internal", label: "Internal", value: "internal" },
      { id: "training", label: "Training", value: "training" },
    ] },
    { id: "task_priority", label: "Priorität", type: "select", targets: [{ scope: "task" }], required: false, placeholder: null, options: [
      { id: "low", label: "Low", value: "low" },
      { id: "medium", label: "Medium", value: "medium" },
      { id: "high", label: "High", value: "high" },
    ] },
    { id: "time_entry_shift_type", label: "Schicht", type: "select", targets: [{ scope: "time_entry", entryTypes: ["work"] }], required: false, placeholder: null, options: [
      { id: "office", label: "Office", value: "office" },
      { id: "remote", label: "Remote", value: "remote" },
      { id: "travel", label: "Travel", value: "travel" },
      { id: "weekend", label: "Weekend", value: "weekend" },
    ] },
    { id: "time_entry_overtime_reason", label: "Überstunden Grund", type: "select", targets: [{ scope: "time_entry", entryTypes: ["work"] }], required: false, placeholder: null, options: [
      { id: "deadline", label: "Deadline", value: "deadline" },
      { id: "peak_load", label: "Peak load", value: "peak_load" },
      { id: "holiday_coverage", label: "Holiday coverage", value: "holiday_coverage" },
      { id: "training", label: "Training", value: "training" },
    ] },
  ];
}

function buildSchedule(hoursPerWeek: number): UserContractScheduleDay[] {
  const day = (weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7, blocks: Array<{ startTime: string; endTime: string; minutes: number }>): UserContractScheduleDay => ({
    weekday,
    isWorkingDay: blocks.length > 0,
    blocks,
    minutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
  });

  const fullDay = [
    { startTime: "08:00", endTime: "12:00", minutes: 240 },
    { startTime: "13:00", endTime: "17:00", minutes: 240 },
  ];
  const longDay = [
    { startTime: "08:00", endTime: "12:00", minutes: 240 },
    { startTime: "13:00", endTime: "16:30", minutes: 210 },
  ];
  const shortDay = [{ startTime: "08:00", endTime: "13:00", minutes: 300 }];

  if (hoursPerWeek === 40) return [day(1, fullDay), day(2, fullDay), day(3, fullDay), day(4, fullDay), day(5, fullDay), day(6, []), day(7, [])];
  if (hoursPerWeek === 37.5) return [day(1, longDay), day(2, longDay), day(3, longDay), day(4, longDay), day(5, longDay), day(6, []), day(7, [])];
  if (hoursPerWeek === 30) return [day(1, longDay), day(2, longDay), day(3, longDay), day(4, longDay), day(5, []), day(6, []), day(7, [])];
  if (hoursPerWeek === 25) return [day(1, shortDay), day(2, shortDay), day(3, shortDay), day(4, shortDay), day(5, shortDay), day(6, []), day(7, [])];
  return [day(1, shortDay), day(2, shortDay), day(3, shortDay), day(4, shortDay), day(5, []), day(6, []), day(7, [])];
}

function buildUsers(year: number, rng: Rng) {
  const rolePlan: UserRole[] = ["admin", "manager", "manager", "employee", "employee", "employee", "employee", "employee", "employee", "employee", "employee", "employee"];
  const users: CompanySnapshot["users"] = [];
  const contracts: CompanySnapshot["userContracts"] = [];
  let contractId = 1;

  for (let index = 0; index < 12; index += 1) {
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(index * 3) % LAST_NAMES.length];
    const role = rolePlan[index];
    const username = toUsername(firstName, lastName);
    const deletedAt = index === 11 ? `${year}-07-15T12:00:00.000Z` : null;
    const isActive = index !== 10;
    const workModel = index % 3 === 0 ? "office" : index % 3 === 1 ? "hybrid" : "remote";
    const hoursPerWeek = role === "admin" || role === "manager" ? (index % 2 === 0 ? 37.5 : 40) : (index % 3 === 0 ? 20 : index % 3 === 1 ? 25 : 30);
    const paymentPerHour = role === "admin" ? 58 : role === "manager" ? 46 : randFloat(rng, 21, 34, 2);

    users.push({
      id: index + 1,
      username,
      fullName: fullName(firstName, lastName),
      passwordHash: bcrypt.hashSync("Demo1234!", 10),
      role,
      isActive,
      deletedAt,
      pinCode: String(randInt(rng, 1000, 9999)).padStart(4, "0"),
      email: `${username}@demo.at`,
      customFieldValues: {
        user_cost_center: index === 0 ? "admin" : index < 3 ? "operations" : index < 7 ? "engineering" : index < 10 ? "sales" : "admin",
        user_work_model: workModel,
        user_home_office: workModel !== "office",
      },
      createdAt: `${year}-01-01T08:00:00.000Z`,
    });

    contracts.push({
      id: contractId,
      userId: index + 1,
      hoursPerWeek,
      startDate: `${year}-01-01`,
      endDate: deletedAt ? `${year}-07-15` : `${year}-12-31`,
      paymentPerHour,
      annualVacationDays: role === "admin" ? 30 : role === "manager" ? 27 : hoursPerWeek >= 30 ? 25 : 22,
      schedule: buildSchedule(hoursPerWeek),
      createdAt: `${year}-01-01T08:30:00.000Z`,
    });
    contractId += 1;

    if (index === 3 || index === 4) {
      const nextHours = index === 3 ? 30 : 25;
      contracts.push({
        id: contractId,
        userId: index + 1,
        hoursPerWeek: nextHours,
        startDate: `${year}-07-01`,
        endDate: `${year}-12-31`,
        paymentPerHour: Number((paymentPerHour + 2.5).toFixed(2)),
        annualVacationDays: 25,
        schedule: buildSchedule(nextHours),
        createdAt: `${year}-07-01T08:30:00.000Z`,
      });
      contractId += 1;
    }
  }

  return { users, contracts };
}

function buildTasks(year: number) {
  const categories = ["delivery", "support", "internal", "training"] as const;
  const priorities = ["low", "medium", "high"] as const;
  return TASK_TITLES.slice(0, 24).map((title, index) => ({
    id: index + 1,
    title,
    isActive: index % 7 !== 6,
    customFieldValues: {
      task_category: categories[index % categories.length],
      task_priority: priorities[index % priorities.length],
    },
    createdAt: `${year}-${String((index % 12) + 1).padStart(2, "0")}-01T08:00:00.000Z`,
  }));
}

function buildProjects(year: number, rng: Rng, users: CompanySnapshot["users"], tasks: ReturnType<typeof buildTasks>) {
  const activeUserIds = users.filter((user) => user.deletedAt === null).map((user) => user.id);
  const activeTaskIds = tasks.filter((task) => task.isActive).map((task) => task.id);
  return PROJECT_NAMES.slice(0, 8).map((name, index) => {
    const allowAllUsers = index % 3 === 1;
    const allowAllTasks = index % 3 === 2;
    return {
      id: index + 1,
      name,
      description: `${name} for ${pick(rng, CLIENTS)}.`,
      budget: randFloat(rng, 15000, 240000, 2),
      isActive: index !== 3,
      allowAllUsers,
      allowAllTasks,
      userIds: allowAllUsers ? [] : shuffle(rng, activeUserIds).slice(0, randInt(rng, 3, 6)),
      taskIds: allowAllTasks ? [] : shuffle(rng, activeTaskIds).slice(0, randInt(rng, 4, 8)),
      customFieldValues: {
        project_client: pick(rng, CLIENTS),
        project_billable: rng() > 0.2,
      },
      createdAt: `${year}-${String((index % 12) + 1).padStart(2, "0")}-05T09:00:00.000Z`,
    };
  });
}

function buildProjectLookup(projects: ReturnType<typeof buildProjects>) {
  return projects.map((project) => ({
    ...project,
    allowedUserIds: project.allowAllUsers ? [] : project.userIds,
    allowedTaskIds: project.allowAllTasks ? [] : project.taskIds,
  }));
}

function buildLeaveRanges(year: number, rng: Rng, holidayDays: Set<string>, contractDays: Set<string>) {
  const workDays = enumerateLocalDays(firstDayOfYear(year), lastDayOfYear(year)).filter((day) => isWorkday(day) && !holidayDays.has(day) && contractDays.has(day));
  const used = new Set<string>();
  const ranges: Array<{ entryType: Exclude<TimeEntryType, "work">; startDate: string; endDate: string }> = [];

  const addRange = (entryType: "vacation" | "sick_leave" | "time_off_in_lieu", lengthDays: number) => {
    const candidates = workDays.filter((day) => !used.has(day));
    if (candidates.length === 0) return;
    const startIndex = randInt(rng, 0, candidates.length - 1);
    const startDate = candidates[startIndex];
    const endDate = candidates[Math.min(candidates.length - 1, startIndex + lengthDays - 1)];
    for (const day of enumerateLocalDays(startDate, endDate)) {
      used.add(day);
    }
    ranges.push({ entryType, startDate, endDate });
  };

  addRange("vacation", randInt(rng, 3, 5));
  addRange("vacation", randInt(rng, 5, 10));
  addRange("sick_leave", 1);
  addRange("sick_leave", 1);
  addRange("time_off_in_lieu", 1);
  addRange("time_off_in_lieu", 1);

  return ranges;
}

function buildWorkEntries(
  year: number,
  rng: Rng,
  users: CompanySnapshot["users"],
  contracts: CompanySnapshot["userContracts"],
  projects: ReturnType<typeof buildProjects>,
  tasks: ReturnType<typeof buildTasks>,
  holidayDays: Set<string>,
) {
  const projectLookup = buildProjectLookup(projects);
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const));
  const contractsByUser = new Map<number, CompanySnapshot["userContracts"]>();
  for (const contract of contracts) {
    const next = contractsByUser.get(contract.userId) ?? [];
    next.push(contract);
    contractsByUser.set(contract.userId, next);
  }

  const leaveRangesByUser = new Map<number, ReturnType<typeof buildLeaveRanges>>();
  const leaveDaysByUser = new Map<number, Set<string>>();
  for (const user of users) {
    const contractDays = new Set<string>();
    for (const contract of contractsByUser.get(user.id) ?? []) {
      for (const day of enumerateLocalDays(contract.startDate, contract.endDate ?? lastDayOfYear(year))) {
        contractDays.add(day);
      }
    }
    const leaveRanges = buildLeaveRanges(year, rng, holidayDays, contractDays);
    leaveRangesByUser.set(user.id, leaveRanges);
    const leaveDays = new Set<string>();
    for (const range of leaveRanges) {
      for (const day of enumerateLocalDays(range.startDate, range.endDate)) {
        leaveDays.add(day);
      }
    }
    leaveDaysByUser.set(user.id, leaveDays);
  }

  const entries: CompanySnapshot["timeEntries"] = [];
  let nextId = 1;
  const yearDays = enumerateLocalDays(firstDayOfYear(year), lastDayOfYear(year));

  for (const user of users) {
    const userContracts = contractsByUser.get(user.id) ?? [];
    const userProjects = projectLookup.filter((project) => project.allowAllUsers || project.userIds.includes(user.id));
    const userLeaveDays = leaveDaysByUser.get(user.id) ?? new Set<string>();
    const weekendWorkCount = user.role === "admin" || user.role === "manager" ? 6 : 2;

    for (const day of yearDays) {
      const contract = userContracts.find((candidate) => candidate.startDate <= day && (candidate.endDate === null || candidate.endDate >= day));
      if (!contract || userLeaveDays.has(day)) continue;
      if (!isWorkday(day) && !(holidayDays.has(day) && (user.role === "admin" || user.role === "manager" && rng() > 0.4))) continue;
      const weekday = getIsoDayOfWeek(day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const scheduleDay = contract.schedule.find((item) => item.weekday === weekday);
      if (!scheduleDay || !scheduleDay.isWorkingDay) continue;
      if (userProjects.length === 0) continue;

      for (let blockIndex = 0; blockIndex < scheduleDay.blocks.length; blockIndex += 1) {
        const block = scheduleDay.blocks[blockIndex];
        const startTime = makeIso(day, block.startTime);
        const isLastBlock = blockIndex === scheduleDay.blocks.length - 1;
        const overtimeMinutes = isLastBlock && rng() > 0.82 ? randInt(rng, 15, 90) : 0;
        const endDate = new Date(makeIso(day, block.endTime));
        endDate.setUTCMinutes(endDate.getUTCMinutes() + overtimeMinutes);
        const project = pick(rng, userProjects);
        const taskId = project.allowAllTasks ? pick(rng, tasks).id : pick(rng, tasks.filter((task) => project.taskIds.includes(task.id))).id;
        entries.push({
          id: nextId++,
          userId: user.id,
          entryType: "work",
          entryDate: day,
          endDate: null,
          startTime,
          endTime: endDate.toISOString(),
          notes: `${project.name} / ${tasksById.get(taskId)?.title ?? "Task"}`,
          projectId: project.id,
          taskId,
          customFieldValues: {
            time_entry_shift_type: isWeekendDay(day) ? "weekend" : blockIndex === 0 ? "office" : "remote",
            ...(overtimeMinutes > 0 ? { time_entry_overtime_reason: pick(rng, ["deadline", "peak_load", "holiday_coverage", "training"]) } : {}),
          },
          createdAt: startTime,
        });
      }
    }

    const weekendCandidates = yearDays.filter((day) => isWeekendDay(day) && !holidayDays.has(day) && !userLeaveDays.has(day));
    for (const day of shuffle(rng, weekendCandidates).slice(0, weekendWorkCount)) {
      if (userProjects.length === 0) continue;
      const project = pick(rng, userProjects);
      const projectTasks = project.allowAllTasks ? tasks : tasks.filter((task) => project.taskIds.includes(task.id));
      if (projectTasks.length === 0) continue;
      const task = pick(rng, projectTasks);
      const startTime = makeIso(day, randInt(rng, 8, 10) === 8 ? "09:00" : "10:00");
      const endTime = new Date(startTime);
      endTime.setUTCMinutes(endTime.getUTCMinutes() + randInt(rng, 180, 300));
      entries.push({
        id: nextId++,
        userId: user.id,
        entryType: "work",
        entryDate: day,
        endDate: null,
        startTime,
        endTime: endTime.toISOString(),
        notes: "Weekend coverage",
        projectId: project.id,
        taskId: task.id,
        customFieldValues: {
          time_entry_shift_type: "weekend",
          time_entry_overtime_reason: "holiday_coverage",
        },
        createdAt: startTime,
      });
    }
  }

  let leaveId = entries.length + 1;
  for (const user of users) {
    for (const range of leaveRangesByUser.get(user.id) ?? []) {
      const startTime = makeIso(range.startDate, "12:00");
      entries.push({
        id: leaveId++,
        userId: user.id,
        entryType: range.entryType,
        entryDate: range.startDate,
        endDate: range.endDate === range.startDate ? null : range.endDate,
        startTime,
        endTime: makeIso(range.endDate, "12:00"),
        notes: range.entryType === "vacation" ? "Urlaub" : range.entryType === "sick_leave" ? "Krankmeldung" : "Zeitausgleich",
        projectId: null,
        taskId: null,
        customFieldValues: {},
        createdAt: startTime,
      });
    }
  }

  const currentYear = new Date().getFullYear();
  if (year === currentYear) {
    const today = new Date().toISOString().slice(0, 10);
    if (isWorkday(today) && !holidayDays.has(today) && users.length > 0) {
      const user = users[0];
      const userProjects = projectLookup.filter((project) => project.allowAllUsers || project.userIds.includes(user.id));
      const project = userProjects.length > 0 ? pick(rng, userProjects) : projectLookup[0];
      const projectTasks = project.allowAllTasks ? tasks : tasks.filter((task) => project.taskIds.includes(task.id));
      if (projectTasks.length > 0) {
        const task = pick(rng, projectTasks);
        const startTime = makeIso(today, "08:00");
        entries.push({
          id: leaveId++,
          userId: user.id,
          entryType: "work",
          entryDate: today,
          endDate: null,
          startTime,
          endTime: null,
          notes: "Open timer for debugging",
          projectId: project.id,
          taskId: task.id,
          customFieldValues: { time_entry_shift_type: "office" },
          createdAt: startTime,
        });
      }
    }
  }

  return entries.sort((left, right) => {
    if (left.entryDate !== right.entryDate) return left.entryDate.localeCompare(right.entryDate);
    if (left.userId !== right.userId) return left.userId - right.userId;
    return left.id - right.id;
  });
}

function buildSnapshot(
  companyName: string,
  year: number,
  users: CompanySnapshot["users"],
  contracts: CompanySnapshot["userContracts"],
  projects: ReturnType<typeof buildProjects>,
  tasks: ReturnType<typeof buildTasks>,
  timeEntries: CompanySnapshot["timeEntries"],
): CompanySnapshot {
  return {
    company: {
      name: companyName,
      encryptionEnabled: false,
      encryptionKdfAlgorithm: null,
      encryptionKdfIterations: null,
      encryptionKdfSalt: null,
      encryptionKeyVerifier: null,
      tabletCodeValue: null,
      tabletCodeHash: null,
      tabletCodeUpdatedAt: null,
      createdAt: `${year}-01-01T00:00:00.000Z`,
    },
    settings: {
      currency: "EUR",
      locale: "de-AT",
      timeZone: TIME_ZONE,
      dateTimeFormat: "g",
      firstDayOfWeek: 1,
      editDaysLimit: 365,
      insertDaysLimit: 365,
      allowOneRecordPerDay: false,
      allowIntersectingRecords: false,
      allowRecordsOnHolidays: true,
      allowFutureRecords: false,
      country: COUNTRY_CODE,
      tabletIdleTimeoutSeconds: 15,
      autoBreakAfterMinutes: 300,
      autoBreakDurationMinutes: 30,
      projectsEnabled: true,
      tasksEnabled: true,
      customFields: buildCustomFields(),
      overtime: createDefaultOvertimeSettings(),
    },
    users,
    userContracts: contracts,
    timeEntries,
    projects,
    tasks,
    publicHolidayCache: [
      {
        countryCode: COUNTRY_CODE,
        year,
        payloadJson: JSON.stringify(buildAustriaHolidays(year)),
        fetchedAt: new Date().toISOString(),
      },
    ],
  };
}

function buildCalculationSql(year: number) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const monthColumns = [
    ["01", "jan"],
    ["02", "feb"],
    ["03", "mar"],
    ["04", "apr"],
    ["05", "may"],
    ["06", "jun"],
    ["07", "jul"],
    ["08", "aug"],
    ["09", "sep"],
    ["10", "oct"],
    ["11", "nov"],
    ["12", "dec"],
  ] as const;

  const overtimeByWorker = `
WITH months(month_index) AS (
  SELECT 1
  UNION ALL SELECT 2
  UNION ALL SELECT 3
  UNION ALL SELECT 4
  UNION ALL SELECT 5
  UNION ALL SELECT 6
  UNION ALL SELECT 7
  UNION ALL SELECT 8
  UNION ALL SELECT 9
  UNION ALL SELECT 10
  UNION ALL SELECT 11
  UNION ALL SELECT 12
),
latest_contracts AS (
  SELECT user_id, MAX(hours_per_week) AS hours_per_week, MAX(payment_per_hour) AS payment_per_hour
  FROM user_contracts
  WHERE start_date <= date('${yearEnd}')
    AND (end_date IS NULL OR end_date >= date('${yearStart}'))
  GROUP BY user_id
),
user_cost_center AS (
  SELECT entity_id AS user_id, MAX(value_text) AS cost_center
  FROM custom_field_values
  WHERE entity_type = 'user' AND field_id = 'user_cost_center'
  GROUP BY entity_id
),
monthly_work AS (
  SELECT te.user_id,
         CAST(strftime('%m', te.entry_date) AS INTEGER) AS month_index,
         SUM(CASE
           WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
           THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0
           ELSE 0
         END) AS worked_hours
  FROM time_entries te
  WHERE te.entry_date >= date('${yearStart}')
    AND te.entry_date <= date('${yearEnd}')
  GROUP BY te.user_id, CAST(strftime('%m', te.entry_date) AS INTEGER)
),
monthly AS (
  SELECT
    u.full_name AS worker,
    COALESCE(ucc.cost_center, 'Unassigned') AS cost_center,
    lc.payment_per_hour,
    m.month_index,
    ROUND(lc.hours_per_week * 52.0 / 12.0, 2) AS expected_hours,
    COALESCE(mw.worked_hours, 0) AS worked_hours,
    COALESCE(mw.worked_hours, 0) - ROUND(lc.hours_per_week * 52.0 / 12.0, 2) AS delta_hours
  FROM users u
  JOIN latest_contracts lc ON lc.user_id = u.id
  CROSS JOIN months m
  LEFT JOIN monthly_work mw ON mw.user_id = u.id AND mw.month_index = m.month_index
  LEFT JOIN user_cost_center ucc ON ucc.user_id = u.id
  WHERE u.deleted_at IS NULL
)
SELECT
  worker,
  cost_center,
  ROUND(MAX(payment_per_hour), 2) AS payment_per_hour,
${monthColumns.map(([month, label]) => `  ROUND(SUM(CASE WHEN month_index = ${Number(month)} THEN expected_hours ELSE 0 END), 2) AS ${label}_expected_hours,`).join("\n")}
${monthColumns.map(([month, label]) => `  ROUND(SUM(CASE WHEN month_index = ${Number(month)} THEN worked_hours ELSE 0 END), 2) AS ${label}_worked_hours,`).join("\n")}
${monthColumns.map(([month, label]) => `  ROUND(SUM(CASE WHEN month_index = ${Number(month)} THEN delta_hours ELSE 0 END), 2) AS ${label}_delta_hours,`).join("\n")}
  ROUND(SUM(worked_hours), 2) AS total_worked_hours,
  ROUND(SUM(delta_hours), 2) AS total_delta_hours,
  ROUND(SUM(worked_hours) * MAX(payment_per_hour), 2) AS estimated_cost
FROM monthly
GROUP BY worker, cost_center
ORDER BY total_worked_hours DESC, worker ASC`.trim();

  const projectBudgetBurn = `
WITH latest_contracts AS (
  SELECT uc.user_id, uc.payment_per_hour
  FROM user_contracts uc
  INNER JOIN (
    SELECT user_id, MAX(start_date) AS start_date
    FROM user_contracts
    GROUP BY user_id
  ) latest ON latest.user_id = uc.user_id AND latest.start_date = uc.start_date
),
project_costs AS (
  SELECT te.project_id,
         SUM(CASE
           WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
           THEN ((julianday(te.end_time) - julianday(te.start_time)) * 24.0) * COALESCE(lc.payment_per_hour, 0)
           ELSE 0
         END) AS cost
  FROM time_entries te
  LEFT JOIN latest_contracts lc ON lc.user_id = te.user_id
  WHERE te.project_id IS NOT NULL
    AND te.entry_date >= date('${yearStart}')
    AND te.entry_date <= date('${yearEnd}')
  GROUP BY te.project_id
),
project_clients AS (
  SELECT entity_id AS project_id, MAX(value_text) AS client
  FROM custom_field_values
  WHERE entity_type = 'project' AND field_id = 'project_client'
  GROUP BY entity_id
),
project_assigned_users AS (
  SELECT project_id, COUNT(*) AS user_count FROM project_users GROUP BY project_id
),
project_assigned_tasks AS (
  SELECT project_id, COUNT(*) AS task_count FROM project_tasks GROUP BY project_id
)
SELECT
  p.name AS project,
  COALESCE(pc.client, '') AS client,
  ROUND(p.budget, 2) AS budget,
  ROUND(COALESCE(costs.cost, 0), 2) AS labor_cost,
  ROUND(ROUND(COALESCE(costs.cost, 0), 2) - ROUND(p.budget, 2), 2) AS variance,
  CASE WHEN p.allow_all_users = 1 THEN 'all' ELSE 'selected' END AS user_scope,
  CASE WHEN p.allow_all_tasks = 1 THEN 'all' ELSE 'selected' END AS task_scope,
  COALESCE(pau.user_count, 0) AS assigned_users,
  COALESCE(pat.task_count, 0) AS assigned_tasks
FROM projects p
LEFT JOIN project_costs costs ON costs.project_id = p.id
LEFT JOIN project_clients pc ON pc.project_id = p.id
LEFT JOIN project_assigned_users pau ON pau.project_id = p.id
LEFT JOIN project_assigned_tasks pat ON pat.project_id = p.id
ORDER BY variance DESC, p.name ASC`.trim();

  const costCenterLoad = `
WITH user_cost_center AS (
  SELECT entity_id AS user_id, MAX(value_text) AS cost_center
  FROM custom_field_values
  WHERE entity_type = 'user' AND field_id = 'user_cost_center'
  GROUP BY entity_id
),
monthly AS (
  SELECT COALESCE(ucc.cost_center, 'Unassigned') AS cost_center,
         CAST(strftime('%m', te.entry_date) AS INTEGER) AS month_index,
         SUM(CASE
           WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
           THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0
           ELSE 0
         END) AS hours
  FROM time_entries te
  JOIN users u ON u.id = te.user_id
  LEFT JOIN user_cost_center ucc ON ucc.user_id = u.id
  WHERE te.entry_type = 'work'
    AND te.entry_date >= date('${yearStart}')
    AND te.entry_date <= date('${yearEnd}')
    AND u.deleted_at IS NULL
  GROUP BY COALESCE(ucc.cost_center, 'Unassigned'), CAST(strftime('%m', te.entry_date) AS INTEGER)
)
SELECT
  cost_center,
${monthColumns.map(([month, label]) => `  ROUND(SUM(CASE WHEN month_index = ${Number(month)} THEN hours ELSE 0 END), 2) AS ${label}_hours,`).join("\n")}
  ROUND(SUM(hours), 2) AS total_hours
FROM monthly
GROUP BY cost_center
ORDER BY total_hours DESC, cost_center ASC`.trim();

  const taskCategoryWorkload = `
WITH task_category AS (
  SELECT entity_id AS task_id, MAX(value_text) AS category
  FROM custom_field_values
  WHERE entity_type = 'task' AND field_id = 'task_category'
  GROUP BY entity_id
)
SELECT
  COALESCE(tc.category, 'Uncategorized') AS category,
  COUNT(*) AS work_entries,
  ROUND(SUM(CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NOT NULL THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 ELSE 0 END), 2) AS hours
FROM time_entries te
LEFT JOIN task_category tc ON tc.task_id = te.task_id
WHERE te.entry_type = 'work'
  AND te.entry_date >= date('${yearStart}')
  AND te.entry_date <= date('${yearEnd}')
GROUP BY COALESCE(tc.category, 'Uncategorized')
ORDER BY hours DESC, category ASC`.trim();

  const shiftTypeWorkload = `
SELECT
  COALESCE(cf.value_text, 'Unknown') AS shift_type,
  COUNT(*) AS work_entries,
  ROUND(SUM(CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NOT NULL THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 ELSE 0 END), 2) AS hours
FROM time_entries te
LEFT JOIN custom_field_values cf
  ON cf.entity_type = 'time_entry'
 AND cf.entity_id = te.id
 AND cf.field_id = 'time_entry_shift_type'
WHERE te.entry_type = 'work'
  AND te.entry_date >= date('${yearStart}')
  AND te.entry_date <= date('${yearEnd}')
GROUP BY COALESCE(cf.value_text, 'Unknown')
ORDER BY hours DESC, shift_type ASC`.trim();

  const workerLoad = `
WITH user_cost_center AS (
  SELECT entity_id AS user_id, MAX(value_text) AS cost_center
  FROM custom_field_values
  WHERE entity_type = 'user' AND field_id = 'user_cost_center'
  GROUP BY entity_id
)
SELECT
  u.full_name AS worker,
  COALESCE(ucc.cost_center, 'Unassigned') AS cost_center,
  COUNT(*) AS work_entries,
  ROUND(SUM(CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NOT NULL THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 ELSE 0 END), 2) AS hours,
  ROUND(SUM(CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NOT NULL THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 ELSE 0 END) * 35, 2) AS estimated_cost
FROM time_entries te
JOIN users u ON u.id = te.user_id
LEFT JOIN user_cost_center ucc ON ucc.user_id = u.id
WHERE te.entry_type = 'work'
  AND te.entry_date >= date('${yearStart}')
  AND te.entry_date <= date('${yearEnd}')
  AND u.deleted_at IS NULL
GROUP BY u.id, u.full_name, COALESCE(ucc.cost_center, 'Unassigned')
ORDER BY hours DESC, worker ASC`.trim();

  return [
    { name: "Demo: Worker workload", description: "Wide worker workload output for the seeded Austrian year.", sqlText: workerLoad },
    { name: "Demo: Project budget burn", description: "Compare project budgets against labor cost, assignments, and client metadata.", sqlText: projectBudgetBurn },
    { name: "Demo: Cost center load", description: "Wide monthly workload by user cost center.", sqlText: costCenterLoad },
    { name: "Demo: Task category workload", description: "Group work entries by task category and total hours.", sqlText: taskCategoryWorkload },
    { name: "Demo: Shift type workload", description: "Summarize work entries by custom shift type from time entries.", sqlText: shiftTypeWorkload },
  ];
}

async function seedCalculations(companyDb: Awaited<ReturnType<typeof createCompanyDatabase>>, companyId: string, year: number) {
  await companyDb.run("DELETE FROM calculations WHERE company_id = ?", [companyId]);
  const createdAt = new Date().toISOString();
  const chartConfig = { type: "bar", categoryColumn: null, valueColumn: null, seriesColumn: null, stacked: false };

  await companyDb.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const calculation of buildCalculationSql(year)) {
      const result = await companyDb.run(
        `INSERT INTO calculations (
           company_id,
           name,
           description,
           sql_text,
           output_mode,
           chart_type,
           chart_category_column,
           chart_value_column,
           chart_series_column,
           chart_config_json,
           chart_stacked,
           is_builtin,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          companyId,
          calculation.name,
          calculation.description,
          calculation.sqlText,
          "table",
          chartConfig.type,
          chartConfig.categoryColumn,
          chartConfig.valueColumn,
          chartConfig.seriesColumn,
          JSON.stringify(chartConfig),
          chartConfig.stacked ? 1 : 0,
          createdAt,
          createdAt,
        ]
      );

      const calculationId = Number(result.lastRowId);
      await companyDb.run(
        `INSERT INTO calculation_versions (
           calculation_id,
           version_number,
           name,
           description,
           sql_text,
           output_mode,
           chart_type,
           chart_category_column,
           chart_value_column,
           chart_series_column,
           chart_config_json,
           chart_stacked,
           created_at
         ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          calculationId,
          calculation.name,
          calculation.description,
          calculation.sqlText,
          "table",
          chartConfig.type,
          chartConfig.categoryColumn,
          chartConfig.valueColumn,
          chartConfig.seriesColumn,
          JSON.stringify(chartConfig),
          chartConfig.stacked ? 1 : 0,
          createdAt,
        ]
      );
      console.log(`Seeded calculation: ${calculation.name}`);
    }
    await companyDb.exec("COMMIT");
  } catch (error) {
    await companyDb.exec("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await resolveRuntimeConfig();
  const rng = createRng(`${args.seed}:${args.companyName}:${args.year}`);
  const systemDb = await createSystemDatabase(config);

  let company = await systemService.getCompanyByName(systemDb, args.companyName);
  if (!company) {
    const companyId = crypto.randomUUID();
    const companyDb = await createCompanyDatabase(config, companyId);
    company = await adminService.createCompany(systemDb, companyDb, {
      name: args.companyName,
      adminUsername: args.adminUsername,
      adminPassword: args.adminPassword,
      adminFullName: args.adminFullName,
    }, companyId);
  }

  if (!company) {
    throw new Error("Company could not be created");
  }

  const companyDb = await createCompanyDatabase(config, company.id);
  const { users, contracts } = buildUsers(args.year, rng);
  const tasks = buildTasks(args.year);
  const projects = buildProjects(args.year, rng, users, tasks);
  const holidayDays = new Set(buildAustriaHolidays(args.year).map((holiday) => holiday.date));
  const timeEntries = buildWorkEntries(args.year, rng, users, contracts, projects, tasks, holidayDays);
  const snapshot = buildSnapshot(args.companyName, args.year, users, contracts, projects, tasks, timeEntries);

  await adminService.replaceCompanySnapshot(systemDb, companyDb, { companyId: company.id, snapshot });
  await seedCalculations(companyDb, company.id, args.year);

  console.log(`Seeded company "${args.companyName}" for ${args.year}.`);
  console.log(JSON.stringify({
    users: users.length,
    contracts: contracts.length,
    projects: projects.length,
    tasks: tasks.length,
    entries: timeEntries.length,
    calculations: 5,
  }, null, 2));
}

await main();
