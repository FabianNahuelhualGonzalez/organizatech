export type AuthMode = "login" | "registro";
export type AuthAccountType = "usuario" | "coach";

export interface AuthRouteState {
  mode: AuthMode;
  accountType: AuthAccountType;
}

export type AuthRouteSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_AUTH_ROUTE: AuthRouteState = {
  mode: "login",
  accountType: "usuario",
};

export function resolveAuthRouteState(searchParams: AuthRouteSearchParams): AuthRouteState {
  return {
    mode: readFirst(searchParams.mode) === "registro" ? "registro" : "login",
    accountType: readFirst(searchParams.tipo) === "coach" ? "coach" : "usuario",
  };
}

export function createAuthHref(route: AuthRouteState): string {
  if (route.mode === "login" && route.accountType === "usuario") return "/login";

  const params = new URLSearchParams({
    mode: route.mode,
    tipo: route.accountType,
  });
  return `/login?${params.toString()}`;
}

function readFirst(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
