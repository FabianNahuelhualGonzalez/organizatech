import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  type ExerciseSource,
  type LoadBasis,
  type MuscleGroup,
  type TrainingCycleBuilderLimits,
  isMuscleGroup,
} from "./types";

export interface CatalogExercise {
  readonly id: string;
  readonly canonicalName: string;
  readonly primaryMuscleGroup: MuscleGroup;
  readonly loadBasis: LoadBasis;
  readonly aliases: readonly string[];
  readonly source: "curated" | "custom";
  readonly videoUrl: string | null;
}

export interface ExerciseCatalog {
  readonly entries: readonly CatalogExercise[];
  readonly byId: Readonly<Record<string, CatalogExercise>>;
  readonly termOwnerByNormalizedTerm: Readonly<Record<string, string>>;
}

export type CatalogIssue =
  | { readonly code: "empty_id"; readonly index: number }
  | { readonly code: "duplicate_id"; readonly index: number; readonly id: string }
  | { readonly code: "empty_name"; readonly index: number; readonly id: string }
  | { readonly code: "name_too_long"; readonly index: number; readonly id: string }
  | { readonly code: "invalid_muscle_group"; readonly index: number; readonly id: string }
  | { readonly code: "invalid_load_basis"; readonly index: number; readonly id: string }
  | { readonly code: "too_many_aliases"; readonly index: number; readonly id: string }
  | { readonly code: "invalid_video_url"; readonly index: number; readonly id: string }
  | {
    readonly code: "term_collision";
    readonly index: number;
    readonly id: string;
    readonly term: string;
    readonly existingId: string;
  };

export interface ExerciseCatalogBuildResult {
  readonly valid: boolean;
  readonly catalog: ExerciseCatalog;
  readonly issues: readonly CatalogIssue[];
}

export interface CustomExerciseInput {
  readonly customExerciseId: string;
  readonly name: string;
  readonly primaryMuscleGroup: MuscleGroup;
  readonly loadBasis?: LoadBasis;
  readonly aliases?: readonly string[];
  readonly videoUrl?: string | null;
}

export type CustomExerciseResult =
  | { readonly ok: true; readonly exercise: CatalogExercise }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

export function normalizeCatalogTerm(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isSupportedYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.length > 1;
    if (host === "youtube.com" || host === "m.youtube.com") {
      return (url.pathname === "/watch" && Boolean(url.searchParams.get("v")))
        || url.pathname.startsWith("/shorts/")
        || url.pathname.startsWith("/embed/");
    }
    return false;
  } catch {
    return false;
  }
}

export function buildExerciseCatalog(
  inputs: readonly CatalogExercise[],
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): ExerciseCatalogBuildResult {
  const issues: CatalogIssue[] = [];
  const entries: CatalogExercise[] = [];
  const byId: Record<string, CatalogExercise> = Object.create(null) as Record<string, CatalogExercise>;
  const termOwner: Record<string, string> = Object.create(null) as Record<string, string>;

  inputs.forEach((input, index) => {
    const id = input.id.trim();
    const canonicalName = normalizeDisplayName(input.canonicalName);
    if (!id) {
      issues.push({ code: "empty_id", index });
      return;
    }
    if (byId[id]) {
      issues.push({ code: "duplicate_id", index, id });
      return;
    }
    if (!canonicalName) issues.push({ code: "empty_name", index, id });
    if (canonicalName.length > limits.maxExerciseNameLength) {
      issues.push({ code: "name_too_long", index, id });
    }
    if (!isMuscleGroup(input.primaryMuscleGroup)) {
      issues.push({ code: "invalid_muscle_group", index, id });
    }
    if (input.loadBasis !== "external" && input.loadBasis !== "bodyweight") {
      issues.push({ code: "invalid_load_basis", index, id });
    }
    if (input.aliases.length > limits.maxAliasesPerExercise) {
      issues.push({ code: "too_many_aliases", index, id });
    }
    if (input.videoUrl !== null && !isSupportedYouTubeUrl(input.videoUrl)) {
      issues.push({ code: "invalid_video_url", index, id });
    }

    const aliasesByNormalizedTerm = new Map<string, string>();
    for (const rawAlias of input.aliases) {
      const alias = normalizeDisplayName(rawAlias);
      const normalizedAlias = normalizeCatalogTerm(alias);
      if (
        normalizedAlias
        && normalizedAlias !== normalizeCatalogTerm(canonicalName)
        && !aliasesByNormalizedTerm.has(normalizedAlias)
      ) aliasesByNormalizedTerm.set(normalizedAlias, alias);
    }
    const aliases = [...aliasesByNormalizedTerm.values()];
    const normalized: CatalogExercise = Object.freeze({
      id,
      canonicalName,
      primaryMuscleGroup: input.primaryMuscleGroup,
      loadBasis: input.loadBasis,
      aliases: Object.freeze(aliases),
      source: input.source,
      videoUrl: input.videoUrl,
    });

    const terms = [canonicalName, ...aliases];
    for (const term of terms) {
      const normalizedTerm = normalizeCatalogTerm(term);
      if (!normalizedTerm) continue;
      const existingId = termOwner[normalizedTerm];
      if (existingId && existingId !== id) {
        issues.push({ code: "term_collision", index, id, term, existingId });
      } else {
        termOwner[normalizedTerm] = id;
      }
    }
    entries.push(normalized);
    byId[id] = normalized;
  });

  return {
    valid: issues.length === 0,
    catalog: Object.freeze({
      entries: Object.freeze(entries),
      byId: Object.freeze(byId),
      termOwnerByNormalizedTerm: Object.freeze(termOwner),
    }),
    issues: Object.freeze(issues),
  };
}

export function createCustomExercise(
  input: CustomExerciseInput,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): CustomExerciseResult {
  const candidate: CatalogExercise = {
    id: input.customExerciseId,
    canonicalName: input.name,
    primaryMuscleGroup: input.primaryMuscleGroup,
    loadBasis: input.loadBasis ?? "external",
    aliases: input.aliases ?? [],
    source: "custom",
    videoUrl: input.videoUrl ?? null,
  };
  const result = buildExerciseCatalog([candidate], limits);
  if (!result.valid) return { ok: false, issues: result.issues };
  const exercise = result.catalog.entries[0];
  if (!exercise) return { ok: false, issues: result.issues };
  return { ok: true, exercise };
}

export function addExerciseToCatalog(
  catalog: ExerciseCatalog,
  exercise: CatalogExercise,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): ExerciseCatalogBuildResult {
  return buildExerciseCatalog([...catalog.entries, exercise], limits);
}

export function findCatalogExerciseByTerm(
  catalog: ExerciseCatalog,
  term: string,
): CatalogExercise | null {
  const id = catalog.termOwnerByNormalizedTerm[normalizeCatalogTerm(term)];
  return id ? catalog.byId[id] ?? null : null;
}

export function searchExerciseCatalog(
  catalog: ExerciseCatalog,
  query: string,
  maxResults = 25,
): readonly CatalogExercise[] {
  const normalizedQuery = normalizeCatalogTerm(query);
  const boundedMax = Number.isSafeInteger(maxResults) && maxResults > 0 ? maxResults : 25;
  const ranked = catalog.entries.flatMap((entry) => {
    const terms = [entry.canonicalName, ...entry.aliases].map(normalizeCatalogTerm);
    if (!normalizedQuery) return [{ entry, score: 4 }];
    let score = Number.POSITIVE_INFINITY;
    for (const term of terms) {
      if (term === normalizedQuery) score = Math.min(score, 0);
      else if (term.startsWith(normalizedQuery)) score = Math.min(score, 1);
      else if (term.split(" ").some((word) => word.startsWith(normalizedQuery))) score = Math.min(score, 2);
      else if (term.includes(normalizedQuery)) score = Math.min(score, 3);
    }
    return Number.isFinite(score) ? [{ entry, score }] : [];
  });

  return ranked
    .sort((left, right) => left.score - right.score || compareStable(
      normalizeCatalogTerm(left.entry.canonicalName),
      normalizeCatalogTerm(right.entry.canonicalName),
    ))
    .slice(0, boundedMax)
    .map(({ entry }) => entry);
}

export function exerciseSourceForCatalogEntry(entry: CatalogExercise): ExerciseSource {
  return entry.source === "custom"
    ? { kind: "custom", customExerciseId: entry.id }
    : { kind: "catalog", catalogExerciseId: entry.id };
}

function compareStable(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

const CURATED_CATALOG_INPUT: readonly CatalogExercise[] = [
  curated("press-flat-barbell", "Press plano con barra", "chest", ["Press banca", "Bench press"]),
  curated("press-incline-dumbbell", "Press inclinado con mancuernas", "chest", ["Press inclinado"]),
  curated("cable-fly", "Aperturas en polea", "chest", ["Cruce de poleas"]),
  curated("overhead-press", "Press militar", "shoulders", ["Press sobre cabeza", "Overhead press"]),
  curated("lateral-raise", "Elevaciones laterales", "shoulders", ["Vuelos laterales"]),
  curated("parallel-dips", "Fondos en paralelas", "triceps", ["Fondos", "Dips"], "bodyweight"),
  curated("triceps-pushdown", "Extensión de tríceps en polea", "triceps", ["Jalón de tríceps"]),
  curated("lat-pulldown", "Jalón al pecho", "back", ["Polea al pecho", "Lat pulldown"]),
  curated("barbell-row", "Remo con barra", "back", ["Barbell row"]),
  curated("barbell-curl", "Curl bíceps con barra", "biceps", ["Curl con barra"]),
  curated("dumbbell-shrug", "Encogimientos con mancuernas", "trapezius", ["Encogimientos"]),
  curated("back-squat", "Sentadilla libre", "quadriceps", ["Sentadilla con barra", "Back squat"]),
  curated("bulgarian-split-squat", "Estocadas búlgaras", "full_leg", ["Sentadilla búlgara"]),
  curated("leg-extension", "Extensión de cuádriceps", "quadriceps", ["Máquina de cuádriceps"]),
  curated("romanian-deadlift", "Peso muerto rumano", "hamstrings", ["RDL"]),
  curated("hip-thrust", "Hip thrust", "glutes", ["Empuje de cadera"]),
  curated("cable-glute-kickback", "Patada de glúteo en polea", "glutes", ["Patada de glúteo"]),
  curated("seated-calf-raise", "Elevación de talones sentado", "calves", ["Gemelos sentado"]),
  curated("plank", "Plancha", "core", ["Plancha abdominal"], "bodyweight"),
];

function curated(
  id: string,
  canonicalName: string,
  primaryMuscleGroup: MuscleGroup,
  aliases: readonly string[],
  loadBasis: LoadBasis = "external",
): CatalogExercise {
  return {
    id,
    canonicalName,
    primaryMuscleGroup,
    loadBasis,
    aliases,
    source: "curated",
    videoUrl: null,
  };
}

const defaultCatalogResult = buildExerciseCatalog(CURATED_CATALOG_INPUT);
if (!defaultCatalogResult.valid) {
  throw new Error("El catalogo curado del constructor contiene colisiones o entradas invalidas");
}

export const DEFAULT_EXERCISE_CATALOG = defaultCatalogResult.catalog;
