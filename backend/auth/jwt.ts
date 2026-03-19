import jwt from "jsonwebtoken";
import type { RuntimeConfig } from "../runtime/types";

export interface AdminTokenPayload {
  actorType: "admin";
  adminId: number;
  username: string;
}

export interface CompanyTokenPayload {
  actorType: "company_user";
  accessMode: "full" | "tablet";
  companyId: string;
  companyName: string;
  userId: number;
  role: "employee" | "manager" | "admin";
}

export type SessionTokenPayload = AdminTokenPayload | CompanyTokenPayload;

const LONG_LIVED_SESSION_HOURS = 24 * 365 * 100;

export function signSessionToken(
  config: RuntimeConfig,
  payload: SessionTokenPayload
): ({ token: string; expiresAt: string } & Pick<AdminTokenPayload, "actorType">) | ({ token: string; expiresAt: string } & Pick<CompanyTokenPayload, "actorType" | "accessMode">) {
  const expiresInHours = Math.max(config.sessionTtlHours, LONG_LIVED_SESSION_HOURS);
  const expiresInSeconds = expiresInHours * 60 * 60;
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: expiresInSeconds });
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  if (payload.actorType === "admin") {
    return { token, expiresAt, actorType: "admin" };
  }

  return { token, expiresAt, actorType: "company_user", accessMode: payload.accessMode };
}

export function verifySessionToken(config: RuntimeConfig, token: string): SessionTokenPayload {
  return jwt.verify(token, config.jwtSecret) as SessionTokenPayload;
}
