import jwt from "jsonwebtoken";
import { appConfig } from "../config";

export interface AdminTokenPayload {
  actorType: "admin";
  adminId: number;
  username: string;
}

export interface CompanyTokenPayload {
  actorType: "company_user";
  accessMode: "full" | "tablet";
  companyId: number;
  companyName: string;
  databasePath: string;
  userId: number;
  role: "employee" | "manager" | "admin";
}

export type SessionTokenPayload = AdminTokenPayload | CompanyTokenPayload;

export function signSessionToken(
  payload: SessionTokenPayload
): ({ token: string; expiresAt: string } & Pick<AdminTokenPayload, "actorType">) | ({ token: string; expiresAt: string } & Pick<CompanyTokenPayload, "actorType" | "accessMode">) {
  const expiresInSeconds = appConfig.sessionTtlHours * 60 * 60;
  const token = jwt.sign(payload, appConfig.jwtSecret, { expiresIn: expiresInSeconds });
  const expiresAt = new Date(Date.now() + appConfig.sessionTtlHours * 60 * 60 * 1000).toISOString();
  if (payload.actorType === "admin") {
    return { token, expiresAt, actorType: "admin" };
  }

  return { token, expiresAt, actorType: "company_user", accessMode: payload.accessMode };
}

export function verifySessionToken(token: string): SessionTokenPayload {
  return jwt.verify(token, appConfig.jwtSecret) as SessionTokenPayload;
}
