export interface QaToolsAccessInput {
  vercelEnv?: string;
  nodeEnv?: string;
  qaToolsEnabled?: string;
  requestHost?: string;
  productionHosts?: string;
  expectedQaSupabaseProjectRef?: string;
  actualSupabaseUrl?: string;
}

export function evaluateQaToolsAccess(input: QaToolsAccessInput): boolean {
  if (input.qaToolsEnabled !== "true") return false;

  const requestHost = normalizeRequestHost(input.requestHost);
  const productionHosts = parseProductionHosts(input.productionHosts);
  if (!requestHost || productionHosts.size === 0) return false;
  if (productionHosts.has(requestHost)) return false;

  if (!matchesExpectedQaSupabaseProject(
    input.actualSupabaseUrl,
    input.expectedQaSupabaseProjectRef,
  )) {
    return false;
  }

  if (input.vercelEnv === "production") return false;
  if (input.vercelEnv === "preview") return true;

  const isLocalDevelopment =
    input.nodeEnv === "development" &&
    (input.vercelEnv === undefined || input.vercelEnv === "" || input.vercelEnv === "development");

  return isLocalDevelopment;
}

export function collectProductionHosts(
  configuredHosts: string | undefined,
  vercelProductionUrl: string | undefined,
): string {
  return [configuredHosts, vercelProductionUrl]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(",");
}

function normalizeRequestHost(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeHost(value.split(",", 1)[0]);
}

function parseProductionHosts(value: string | undefined): Set<string> {
  const hosts = new Set<string>();
  if (!value) return hosts;

  for (const entry of value.split(",")) {
    const host = normalizeHost(entry);
    if (host) hosts.add(host);
  }

  return hosts;
}

function normalizeHost(value: string | undefined): string | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || /[\s/@?#\\]/.test(candidate)) return null;

  try {
    const url = new URL(`http://${candidate}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;

    const hostname = url.hostname.replace(/\.$/, "");
    return isValidHostname(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  if (hostname === "localhost") return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(hostname)) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return hostname.split(".").every((part) => Number(part) <= 255);
  }

  return hostname.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}

function matchesExpectedQaSupabaseProject(
  actualSupabaseUrl: string | undefined,
  expectedProjectRef: string | undefined,
): boolean {
  const projectRef = extractSupabaseProjectRef(actualSupabaseUrl);
  if (!projectRef || !expectedProjectRef) return false;
  if (expectedProjectRef !== expectedProjectRef.trim()) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(expectedProjectRef)) return false;
  return projectRef === expectedProjectRef;
}

function extractSupabaseProjectRef(value: string | undefined): string | null {
  if (!value || value !== value.trim()) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;

    const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.supabase\.co$/.exec(url.hostname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
