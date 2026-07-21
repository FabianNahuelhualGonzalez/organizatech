import type { NextConfig } from "next";

import {
  buildContentSecurityPolicy,
  resolveSupabaseCspEnvironment,
} from "./src/lib/server/supabase-csp-policy";

const cspEnvironment = resolveSupabaseCspEnvironment(
  process.env.NODE_ENV,
  process.env.VERCEL_ENV,
);

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy({
      environment: cspEnvironment,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
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
