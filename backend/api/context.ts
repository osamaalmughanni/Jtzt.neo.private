import type { SessionTokenPayload } from "../auth/jwt";
import type { AppDatabase, RuntimeBindings, RuntimeConfig } from "../runtime/types";

export interface AppVariables {
  session: SessionTokenPayload;
  db: AppDatabase;
  config: RuntimeConfig;
}

export type AppRouteConfig = {
  Bindings: RuntimeBindings;
  Variables: AppVariables;
};
