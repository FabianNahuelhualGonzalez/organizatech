import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";

/**
 * Fuente pura y tipada del estado de Routine Builder (P3-20, corregida en P3-20B tras
 * auditoría): día seleccionado y borrador por día. Espeja el estado real hoy disperso en
 * `organizatech-app.tsx` — `setupDay`/`setupByDay` (líneas ~430-431), reutilizando
 * `SetupDayState`/`SetupExerciseRow` desde su fuente canónica sin redefinirlos.
 *
 * Esta fase NO integra `useReducer` en el root ni reemplaza los `useState` existentes
 * (P3-26). Es un modelo aislado, verificado por su propio test unitario.
 *
 * ALCANCE — explícitamente EXCLUIDO de este módulo (fases posteriores):
 * - add/remove/update de fila individual, generación de IDs (`createId`) — P3-21.
 * - normalización de drafts legacy / datos desconocidos de storage (`normalizeSetupByDay`) — P3-22.
 * - mapping, dedupe y lineage desde `ExerciseTemplate[]` reales (`createSetupByDayFromExercises`,
 *   `dedupeExercisesByDayAndRoutine`) — P3-23.
 * - draft recovery, cleanup y expiración desde storage — P3-24.
 * - `saveInitialRoutine`, persistencia, confirmaciones y mensajes de éxito/error de guardado — P3-25.
 * - integración de `useReducer` en el root, wiring con los componentes visuales, navegación — P3-26.
 *
 * DECISIÓN P3-20B — `message`/`isBusy` NO forman parte de este estado. `statusMessage`/`isBusy`
 * son hoy canales GLOBALES compartidos por toda la app (auth, logout, gestión de ciclos), no
 * exclusivos de Routine Builder. Incluirlos aquí como slices propios habría creado doble
 * ownership (dos fuentes de verdad para el mismo concepto). Cómo P3-26 coordine este reducer con
 * ese estado global (leerlo, reflejarlo, o mantenerlo fuera del reducer) es una decisión de esa
 * fase de integración; este módulo deliberadamente no la anticipa ni la duplica.
 *
 * DECISIÓN P3-20B — el initializer YA NO acepta `setupByDay` implícito (`{}` por defecto):
 * `setupByDay` es un input OBLIGATORIO. Producción siempre requiere un mapa preparado mediante
 * el `createSetupByDay()` del root (que genera IDs vía `createId()`, responsabilidad de P3-21).
 * Omitir un default silencioso impide que un consumidor futuro olvide accidentalmente entregar
 * el estado real y termine con un mapa vacío sin darse cuenta.
 *
 * DECISIÓN P3-20B — clonado defensivo: `createRoutineBuilderState`, `replace_rows`,
 * `reset_state` y `replace_state` clonan profundamente cualquier `setupByDay`/`SetupDayState`/
 * `rows`/`SetupExerciseRow` que reciben como input externo. Mutar ese input DESPUÉS de invocar
 * el initializer o despachar una acción no debe alterar el estado ya producido. El clonado es
 * manual (spread por nivel), no usa `JSON.stringify/parse` ni `structuredClone`, y preserva
 * todos los campos del tipo canónico (incluyendo `sourceExerciseId`/`exerciseLineageId`
 * opcionales).
 *
 * DECISIÓN P3-20B — ningún día ausente comparte una estructura o un array `rows` singleton:
 * cada lectura de un día no presente en el mapa construye un objeto y un array nuevos,
 * independientes entre sí.
 *
 * Puro: sin React, sin hooks, sin componentes, sin Supabase, sin repositories, sin storage,
 * sin navegación, sin window/document, sin timers, sin Date.now/Math.random.
 */

export interface RoutineBuilderState {
  activeDay: string;
  setupByDay: Record<string, SetupDayState>;
}

export interface RoutineBuilderStateInit {
  setupByDay: Record<string, SetupDayState>;
  activeDay?: string;
}

function cloneRows(rows: readonly SetupExerciseRow[]): SetupExerciseRow[] {
  return rows.map((row) => ({ ...row }));
}

function cloneSetupDayState(dayState: SetupDayState): SetupDayState {
  return { routineName: dayState.routineName, rows: cloneRows(dayState.rows) };
}

function cloneSetupByDay(setupByDay: Record<string, SetupDayState>): Record<string, SetupDayState> {
  const cloned: Record<string, SetupDayState> = {};
  for (const day of Object.keys(setupByDay)) {
    cloned[day] = cloneSetupDayState(setupByDay[day]);
  }
  return cloned;
}

function cloneRoutineBuilderState(state: RoutineBuilderState): RoutineBuilderState {
  return { activeDay: state.activeDay, setupByDay: cloneSetupByDay(state.setupByDay) };
}

/**
 * Construye un `RoutineBuilderState` a partir de un `setupByDay` YA PREPARADO (obligatorio,
 * clonado defensivamente), sin inventar días, ejercicios ni generar IDs. `activeDay` por
 * defecto es el primer día del catálogo canónico (`TRAINING_DAY_LABELS[0]`, hoy "Lunes" — el
 * mismo valor que el root usa como literal).
 */
export function createRoutineBuilderState(init: RoutineBuilderStateInit): RoutineBuilderState {
  return {
    activeDay: init.activeDay ?? TRAINING_DAY_LABELS[0],
    setupByDay: cloneSetupByDay(init.setupByDay),
  };
}

export type RoutineBuilderAction =
  | { type: "select_day"; day: string }
  | { type: "set_routine_name"; routineName: string }
  | { type: "replace_rows"; rows: SetupExerciseRow[] }
  | { type: "reset_state"; setupByDay: Record<string, SetupDayState>; activeDay?: string }
  | { type: "replace_state"; state: RoutineBuilderState };

/**
 * Igual al patrón `current[day] ?? createSetupDayState()` del root (`updateSetupDay`,
 * organizatech-app.tsx), pero sin generar filas en blanco (sin `createId()`): el fallback para
 * un día aún no presente en el mapa es un `{ routineName: "", rows: [] }` construido de cero en
 * cada llamada — nunca una estructura ni un array compartidos entre días distintos.
 */
function readDayState(state: RoutineBuilderState, day: string): SetupDayState {
  const existing = state.setupByDay[day];
  if (existing) return existing;
  return { routineName: "", rows: [] };
}

/**
 * Reducer puro y exhaustivo: no muta `state` ni `rows`, no ejecuta efectos, no valida
 * ejercicios, no lee storage, no navega. Preserva la referencia de `state` cuando la acción no
 * cambia ningún valor (`select_day` al mismo día, `set_routine_name` al mismo nombre); produce
 * una referencia nueva cuando algo cambia. `replace_rows`/`reset_state`/`replace_state` clonan
 * defensivamente cualquier dato externo que reciben, para que una mutación posterior del input
 * original no afecte el estado ya producido.
 */
export function routineBuilderReducer(
  state: RoutineBuilderState,
  action: RoutineBuilderAction,
): RoutineBuilderState {
  switch (action.type) {
    case "select_day": {
      if (action.day === state.activeDay) return state;
      return { ...state, activeDay: action.day };
    }
    case "set_routine_name": {
      const currentDayState = readDayState(state, state.activeDay);
      if (currentDayState.routineName === action.routineName) return state;
      return {
        ...state,
        setupByDay: {
          ...state.setupByDay,
          [state.activeDay]: { routineName: action.routineName, rows: currentDayState.rows },
        },
      };
    }
    case "replace_rows": {
      const currentDayState = readDayState(state, state.activeDay);
      return {
        ...state,
        setupByDay: {
          ...state.setupByDay,
          [state.activeDay]: { routineName: currentDayState.routineName, rows: cloneRows(action.rows) },
        },
      };
    }
    case "reset_state":
      // No corresponde a cancelRoutineUpdate (que reconstruye setupByDay desde ejercicios
      // reales vía createSetupByDayFromExercises — P3-23/P3-26). reset_state solo modela el
      // reset "en blanco" de startNewTrainingCycle/deleteCurrentTrainingCycle: un setupByDay ya
      // preparado externamente, sin tocar mensajes ni busy globales (que ya no viven aquí).
      return createRoutineBuilderState({ setupByDay: action.setupByDay, activeDay: action.activeDay });
    case "replace_state":
      return cloneRoutineBuilderState(action.state);
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Accion de Routine Builder no reconocida: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
