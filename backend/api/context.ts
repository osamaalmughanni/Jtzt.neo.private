import type { SessionTokenPayload } from "../auth/jwt";

export interface AppVariables {
  session: SessionTokenPayload;
}
