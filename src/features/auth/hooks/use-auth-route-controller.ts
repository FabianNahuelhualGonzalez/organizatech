"use client";

import { useCallback, useState } from "react";

import {
  createAuthHref,
  type AuthRouteState,
} from "@/features/auth/model/auth-route";

export function useAuthRouteController(initialRoute: AuthRouteState) {
  const [route, setRoute] = useState(initialRoute);

  const replace = useCallback((nextRoute: AuthRouteState) => {
    setRoute(nextRoute);
    if (typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", createAuthHref(nextRoute));
  }, []);

  return { route, replace };
}
