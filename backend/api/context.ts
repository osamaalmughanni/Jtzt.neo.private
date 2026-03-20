import type { SessionTokenPayload } from "../auth/jwt";
import type { AppDatabase, RuntimeBindings, RuntimeConfig } from "../runtime/types";

export interface AppVariables {
  session: SessionTokenPayload;
  systemDb: AppDatabase;
  db: AppDatabase;
  config: RuntimeConfig;
  externalCompany: {
    id: string;
    name: string;
  };
}

export type AppRouteConfig = {
  Bindings: RuntimeBindings;
  Variables: AppVariables;
};
