import type { RuntimeConfig } from "../runtime/types";

export interface AdminTokenPayload {
  actorType: "admin";
  adminId: number;
  username: string;
  adminAuthFingerprint: string;
}

export interface CompanyTokenPayload {
  actorType: "company_user";
  accessMode: "full" | "tablet";
  companyId: string;
  companyName: string;
  userId: number;
  role: "employee" | "manager" | "admin";
}

export interface WorkspaceSessionPayload {
  actorType: "workspace";
  accessMode: "full";
  companyId: string;
  companyName: string;
  workspaceAuthVersion: number;
  userId: number;
  role: "admin";
}

export interface WorkspaceKeyPayload {
  tokenType: "workspace_key";
  companyId: string;
  companyName: string;
  issuedAt: string;
}

export type SessionTokenPayload = AdminTokenPayload | CompanyTokenPayload | WorkspaceSessionPayload;

type JwtPayload = SessionTokenPayload & {
  exp: number;
  iat: number;
};

const LONG_LIVED_SESSION_HOURS = 24 * 365 * 100;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64Url(input: Uint8Array) {
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function importHmacKey(secret: string, usage: KeyUsage) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function signHs256(secret: string, value: string) {
  const key = await importHmacKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

async function verifyHs256(secret: string, value: string, signature: string) {
  const key = await importHmacKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, fromBase64Url(signature), textEncoder.encode(value));
}

function decodePayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(textDecoder.decode(fromBase64Url(encodedHeader))) as { alg?: string; typ?: string };
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Unsupported JWT header");
  }

  const payload = JSON.parse(textDecoder.decode(fromBase64Url(encodedPayload))) as JwtPayload;
  return {
    payload,
    signedValue: `${encodedHeader}.${encodedPayload}`,
    signature: encodedSignature,
  };
}

export async function signSessionToken(
  config: RuntimeConfig,
  payload: SessionTokenPayload,
): Promise<
  | ({ token: string; expiresAt: string } & Pick<AdminTokenPayload, "actorType">)
  | ({ token: string; expiresAt: string } & Pick<CompanyTokenPayload, "actorType" | "accessMode">)
  | ({ token: string; expiresAt: string } & Pick<WorkspaceSessionPayload, "actorType" | "accessMode">)
> {
  const expiresInHours = Math.max(config.sessionTtlHours, LONG_LIVED_SESSION_HOURS);
  const expiresInSeconds = expiresInHours * 60 * 60;
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;

  const encodedHeader = toBase64Url(textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify({ ...payload, iat, exp })));
  const signedValue = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHs256(config.jwtSecret, signedValue);
  const token = `${signedValue}.${signature}`;
  const expiresAt = new Date(exp * 1000).toISOString();

  if (payload.actorType === "admin") {
    return { token, expiresAt, actorType: "admin" };
  }

  if (payload.actorType === "workspace") {
    return { token, expiresAt, actorType: "workspace", accessMode: payload.accessMode };
  }

  return { token, expiresAt, actorType: "company_user", accessMode: payload.accessMode };
}

export async function verifySessionToken(config: RuntimeConfig, token: string): Promise<SessionTokenPayload> {
  const { payload, signedValue, signature } = decodePayload(token);
  const valid = await verifyHs256(config.jwtSecret, signedValue, signature);
  if (!valid) {
    throw new Error("Invalid JWT signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    throw new Error("JWT expired");
  }

  const { exp: _exp, iat: _iat, ...sessionPayload } = payload;
  return sessionPayload;
}

export async function signWorkspaceKeyToken(config: RuntimeConfig, payload: WorkspaceKeyPayload): Promise<string> {
  const encodedHeader = toBase64Url(textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signedValue = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHs256(config.jwtSecret, signedValue);
  return `${signedValue}.${signature}`;
}

export async function verifyWorkspaceKeyToken(config: RuntimeConfig, token: string): Promise<WorkspaceKeyPayload> {
  const { payload, signedValue, signature } = decodePayload(token);
  const valid = await verifyHs256(config.jwtSecret, signedValue, signature);
  if (!valid) {
    throw new Error("Invalid JWT signature");
  }

  const workspacePayload = payload as unknown as WorkspaceKeyPayload;
  if (workspacePayload.tokenType !== "workspace_key") {
    throw new Error("Unsupported workspace key");
  }

  return workspacePayload;
}
