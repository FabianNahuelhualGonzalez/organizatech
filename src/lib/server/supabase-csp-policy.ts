export type SupabaseCspEnvironment = "development" | "preview" | "production";

export interface SupabaseCspOrigins {
  httpOrigin: string;
  websocketOrigin: string;
}

export interface ContentSecurityPolicyInput {
  environment: SupabaseCspEnvironment;
  supabaseUrl?: string;
}

const forbiddenCspInputCharacters = /[\u0000-\u001f\u007f;]/;
const managedSupabaseHostname = /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])\.supabase\.co$/;
const developmentLoopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveSupabaseCspEnvironment(
  nodeEnv: string | undefined,
  vercelEnv: string | undefined,
): SupabaseCspEnvironment {
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "production";
  if (
    nodeEnv === "development" &&
    (vercelEnv === undefined || vercelEnv === "" || vercelEnv === "development")
  ) {
    return "development";
  }
  return "production";
}

export function resolveSupabaseCspOrigins(
  rawUrl: string | undefined,
  environment: SupabaseCspEnvironment,
): SupabaseCspOrigins | null {
  if (!rawUrl || forbiddenCspInputCharacters.test(rawUrl)) return null;

  const candidate = rawUrl.trim();
  if (!candidate) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (
    url.origin === "null" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isAllowedSupabaseBasePath(url.pathname)
  ) {
    return null;
  }

  const isDevelopmentLoopback = developmentLoopbackHosts.has(url.hostname);
  if (isDevelopmentLoopback) {
    if (environment !== "development" || url.protocol !== "http:") return null;
  } else {
    if (url.protocol !== "https:" || url.port || !managedSupabaseHostname.test(url.hostname)) return null;
  }

  const websocketUrl = new URL(url.origin);
  websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return {
    httpOrigin: url.origin,
    websocketOrigin: websocketUrl.origin,
  };
}

export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  const supabaseOrigins = resolveSupabaseCspOrigins(input.supabaseUrl, input.environment);
  const isDevelopment = input.environment === "development";
  const directives = [
    cspDirective("default-src", ["'self'"]),
    cspDirective("base-uri", ["'self'"]),
    cspDirective("object-src", ["'none'"]),
    cspDirective("frame-ancestors", ["'none'"]),
    cspDirective("frame-src", ["'none'"]),
    cspDirective("form-action", ["'self'"]),
    cspDirective("script-src", ["'self'", "'unsafe-inline'", isDevelopment && "'unsafe-eval'"]),
    cspDirective("style-src", ["'self'", "'unsafe-inline'"]),
    cspDirective("img-src", ["'self'", "data:", "blob:", supabaseOrigins?.httpOrigin]),
    cspDirective("font-src", ["'self'", "data:"]),
    cspDirective("connect-src", [
      "'self'",
      supabaseOrigins?.httpOrigin,
      supabaseOrigins?.websocketOrigin,
      isDevelopment && "ws://localhost:*",
      isDevelopment && "ws://127.0.0.1:*",
      isDevelopment && "ws://[::1]:*",
    ]),
    cspDirective("media-src", ["'self'", "blob:", supabaseOrigins?.httpOrigin]),
    cspDirective("worker-src", ["'self'", "blob:"]),
    cspDirective("manifest-src", ["'self'"]),
  ];

  if (!isDevelopment) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function isAllowedSupabaseBasePath(pathname: string): boolean {
  return pathname === "/" || /^\/(?:rest|auth)\/v1\/?$/.test(pathname);
}

function cspDirective(name: string, values: Array<string | null | undefined | false>): string {
  const allowedValues = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return allowedValues.length > 0 ? `${name} ${allowedValues.join(" ")}` : name;
}
