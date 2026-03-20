import { HTTPException } from "hono/http-exception";
import type { AppDatabase, DurableObjectStubLike, RunResult, SqlStatement, SqlValue } from "../runtime/types";

type SqlBridgeResponse =
  | { ok: true; rows?: unknown[]; row?: unknown | null; result?: RunResult; results?: RunResult[] }
  | { ok: false; error: string; status?: number };

function normalizeParams(params?: SqlValue[]) {
  return params ?? [];
}

async function callSqlBridge<T>(stub: DurableObjectStubLike, body: Record<string, unknown>): Promise<T> {
  const response = await stub.fetch("https://internal-jtzt/sql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as SqlBridgeResponse;
  if (!response.ok || !payload.ok) {
    throw new HTTPException(500, {
      message: payload.ok ? "Durable Object SQL bridge error" : payload.error,
    });
  }
  return payload as T;
}

export function createDurableObjectDatabase(stub: DurableObjectStubLike): AppDatabase {
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      const payload = await callSqlBridge<{ ok: true; rows: T[] }>(stub, {
        op: "all",
        sql,
        params: normalizeParams(params),
      });
      return payload.rows ?? [];
    },

    async first<T>(sql: string, params?: SqlValue[]) {
      const payload = await callSqlBridge<{ ok: true; row: T | null }>(stub, {
        op: "first",
        sql,
        params: normalizeParams(params),
      });
      return payload.row ?? null;
    },

    async run(sql: string, params?: SqlValue[]) {
      const payload = await callSqlBridge<{ ok: true; result: RunResult }>(stub, {
        op: "run",
        sql,
        params: normalizeParams(params),
      });
      return payload.result;
    },

    async batch(statements: SqlStatement[]) {
      const payload = await callSqlBridge<{ ok: true; results: RunResult[] }>(stub, {
        op: "batch",
        statements,
      });
      return payload.results;
    },

    async exec(sql: string) {
      await callSqlBridge<{ ok: true }>(stub, {
        op: "exec",
        sql,
      });
    },
  };
}
