import type { WorkoutShareTextPayload } from "@/lib/training/workout-share-model";

export interface WorkoutShareData {
  readonly title: string;
  readonly text: string;
}

export interface WorkoutShareActionPorts {
  readonly share?: (data: WorkoutShareData) => Promise<void>;
  readonly copyText?: (text: string) => Promise<void>;
}

export type WorkoutShareActionResult =
  | { readonly kind: "shared" }
  | { readonly kind: "copied" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

export async function executeWorkoutShareAction(
  payload: Readonly<WorkoutShareTextPayload>,
  ports: Readonly<WorkoutShareActionPorts>,
): Promise<WorkoutShareActionResult> {
  if (ports.share) {
    try {
      await ports.share({
        title: payload.title,
        text: payload.text,
      });
      return { kind: "shared" };
    } catch (error) {
      if (isAbortError(error)) return { kind: "cancelled" };
      if (!ports.copyText) return { kind: "failed" };
      return copyWorkoutShareText(payload.text, ports.copyText);
    }
  }

  if (!ports.copyText) return { kind: "unavailable" };
  return copyWorkoutShareText(payload.text, ports.copyText);
}

async function copyWorkoutShareText(
  text: string,
  copyText: (text: string) => Promise<void>,
): Promise<WorkoutShareActionResult> {
  try {
    await copyText(text);
    return { kind: "copied" };
  } catch {
    return { kind: "failed" };
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}
