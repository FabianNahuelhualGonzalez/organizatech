import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function getOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    return new URL(value.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "")).origin;
  } catch {
    return null;
  }
}

function getWebSocketOrigin(origin: string | null) {
  if (!origin) return null;

  try {
    const url = new URL(origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  } catch {
    return null;
  }
}

function cspDirective(name: string, values: Array<string | null | false>) {
  const allowedValues = values.filter(Boolean);
  return allowedValues.length > 0 ? `${name} ${allowedValues.join(" ")}` : name;
}

function buildContentSecurityPolicy() {
  const supabaseOrigin = getOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseWebSocketOrigin = getWebSocketOrigin(supabaseOrigin);

  const directives = [
    cspDirective("default-src", ["'self'"]),
    cspDirective("base-uri", ["'self'"]),
    cspDirective("object-src", ["'none'"]),
    cspDirective("frame-ancestors", ["'none'"]),
    cspDirective("frame-src", ["'none'"]),
    cspDirective("form-action", ["'self'"]),
    cspDirective("script-src", ["'self'", "'unsafe-inline'", !isProduction && "'unsafe-eval'"]),
    cspDirective("style-src", ["'self'", "'unsafe-inline'"]),
    cspDirective("img-src", ["'self'", "data:", "blob:", supabaseOrigin]),
    cspDirective("font-src", ["'self'", "data:"]),
    cspDirective("connect-src", [
      "'self'",
      supabaseOrigin,
      supabaseWebSocketOrigin,
      !isProduction && "ws:",
      !isProduction && "http://localhost:*",
      !isProduction && "http://127.0.0.1:*",
    ]),
    cspDirective("media-src", ["'self'", "blob:", supabaseOrigin]),
    cspDirective("worker-src", ["'self'", "blob:"]),
    cspDirective("manifest-src", ["'self'"]),
  ];

  if (isProduction) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(),
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
