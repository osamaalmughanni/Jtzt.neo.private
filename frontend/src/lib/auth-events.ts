export const AUTH_INVALID_EVENT = "jtzt:auth-invalid";

export interface AuthInvalidEventDetail {
  token: string;
  status: number;
  path: string;
  method: string;
}

export function emitAuthInvalid(detail: AuthInvalidEventDetail) {
  window.dispatchEvent(new CustomEvent<AuthInvalidEventDetail>(AUTH_INVALID_EVENT, { detail }));
}
