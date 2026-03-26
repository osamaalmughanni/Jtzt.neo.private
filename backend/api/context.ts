import type { SessionTokenPayload } from "../auth/jwt";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";

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
  Variables: AppVariables;
};
