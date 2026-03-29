import type { SessionTokenPayload } from "../auth/jwt";
import type { NodeDatabase, RuntimeConfig } from "../runtime/types";

export interface AppVariables {
  session: SessionTokenPayload;
  systemDb: NodeDatabase;
  db: NodeDatabase;
  config: RuntimeConfig;
  externalCompany: {
    id: string;
    name: string;
  };
}

export type AppRouteConfig = {
  Variables: AppVariables;
};
