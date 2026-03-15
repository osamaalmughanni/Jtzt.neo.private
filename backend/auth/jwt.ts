import jwt from "jsonwebtoken";
import { appConfig } from "../config";

export interface AdminTokenPayload {
  actorType: "admin";
  adminId: number;
  username: string;
}

export interface CompanyTokenPayload {
  actorType: "company_user";
  companyId: number;
  companyName: string;
  databasePath: string;
  userId: number;
  role: "employee" | "company_admin";
}

export type SessionTokenPayload = AdminTokenPayload | CompanyTokenPayload;

export function signSessionToken(payload: SessionTokenPayload): { token: string; expiresAt: string } {
  const expiresIn = `${appConfig.sessionTtlHours}h`;
  const token = jwt.sign(payload, appConfig.jwtSecret, { expiresIn });
  const expiresAt = new Date(Date.now() + appConfig.sessionTtlHours * 60 * 60 * 1000).toISOString();
  return { token, expiresAt };
}

export function verifySessionToken(token: string): SessionTokenPayload {
  return jwt.verify(token, appConfig.jwtSecret) as SessionTokenPayload;
}
