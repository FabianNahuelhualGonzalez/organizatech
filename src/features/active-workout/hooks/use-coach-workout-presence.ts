"use client";

import { useEffect } from "react";
import { getActiveSupabaseAuthIdentityScope, getSupabaseBrowserClient } from "@/lib/supabase/client";

/** A short lease: missed heartbeats expire automatically; leaving the workout clears it. */
export function useCoachWorkoutPresence(enabled: boolean, userId: string | null) {
  useEffect(() => {
    if (!enabled || !userId) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let live = true;
    const stillOwnSession = () => getActiveSupabaseAuthIdentityScope()?.userId === userId;
    const pulse = () => {
      if (!live || document.visibilityState !== "visible" || !stillOwnSession()) return;
      void client.rpc("pulse_own_coach_workout_presence", { p_active: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") pulse();
      else if (stillOwnSession()) void client.rpc("pulse_own_coach_workout_presence", { p_active: false });
    };
    pulse();
    const timer = window.setInterval(pulse, 25_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (stillOwnSession()) void client.rpc("pulse_own_coach_workout_presence", { p_active: false });
    };
  }, [enabled, userId]);
}
