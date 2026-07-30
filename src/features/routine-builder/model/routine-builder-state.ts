import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";

/**
 * Fuente pura y tipada del estado de Routine Builder: día seleccionado, borrador por día y
 * operaciones de fila. El root la integra mediante `useReducer` y conserva la generación externa
 * de IDs, persistencia, mensajes, confirmaciones y navegación.
 *
 * La normalización, el mapping y la recuperación viven en módulos especializados de esta feature;
 * este reducer no los duplica ni accede a storage.
 *
 * DECISIÓN P3-21B (corrige P3-21 tras auditoría, hallazgo MEDIUM M1) — `remove_row` exige
 * `allowEmptyRows: boolean` como campo OBLIGATORIO de la acción (sin `?`, sin valor por
 * defecto): el reducer ya no decide en silencio si permite `rows: []`, y tampoco lo infiere de
 * ningún estado externo — el compilador obliga a cada caller a declarar la política en el sitio
 * de despacho. Producción (`removeSetupRow`) aplica hoy un guard distinto según
 * `isCycleScopedEdit` (booleano derivado de `isTrainingCyclesRepositoryActive`/
 * `persistedActiveCycle`/Supabase — el flujo cycle-scoped SÍ permite `rows: []`, el flujo legacy
 * nunca lo permite). Ese booleano es infraestructura productiva que este módulo puro no conoce
 * ni debe importar, así que NO se lee aquí: en su lugar, `allowEmptyRows` es el parámetro puro
 * que el caller debe resolver antes de despachar, mapeando:
 *   - flujo legacy  → despachar `allowEmptyRows: false`;
 *   - flujo cycle-scoped → despachar `allowEmptyRows: true` (después de resolver la
 *     confirmación de UI por `sourceExerciseId`, que sigue sin modelarse aquí).
 * Semántica exacta: (1) `rowId` inexistente → misma referencia, sin crear el día, sin siquiera
 * consultar `allowEmptyRows`; (2) si queda al menos una fila tras eliminar → se elimina siempre,
 * sin importar `allowEmptyRows`; (3) eliminar la única fila con `allowEmptyRows: false` → no-op,
 * misma referencia, ningún nivel se muta (política legacy); (4) eliminar la única fila con
 * `allowEmptyRows: true` → se permite `rows: []` (política cycle-scoped). El reducer nunca abre
 * `window.confirm`.
 *
 * `add_row` sobre un día aún no presente crea el día con únicamente la fila entregada. El root
 * genera el ID y despacha esa fila; el reducer no fabrica placeholders adicionales.
 *
 * `message`/`isBusy` no forman parte de este estado. `statusMessage`/`isBusy` son canales globales
 * compartidos por toda la app, y el root los mantiene fuera del reducer para evitar doble
 * ownership.
 *
 * DECISIÓN P3-20B — el initializer YA NO acepta `setupByDay` implícito (`{}` por defecto):
 * `setupByDay` es un input OBLIGATORIO. Producción siempre requiere un mapa preparado mediante
 * el `createSetupByDay()` del root (que genera IDs vía `createId()`).
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

/**
 * Construye una fila vacía con un ID YA GENERADO externamente (nunca lo genera este módulo).
 * Preserva exactamente los defaults de `createSetupRow()` en el root: `name: ""`, `sets: 0`,
 * `reps: 0`, `weight: ""`. Rechaza un id vacío (el contrato de `SetupExerciseRow.id: string`
 * exige un identificador real, no una cadena vacía). Cada llamada retorna una referencia nueva
 * e independiente.
 */
export function createRoutineBuilderRow(id: string): SetupExerciseRow {
  if (!id) {
    throw new Error("createRoutineBuilderRow requiere un id no vacio");
  }
  return { id, name: "", sets: 0, reps: 0, weight: "" };
}

/**
 * Payload seguro de actualización de un campo de fila: refleja exactamente los tipos de
 * `SetupExerciseRow` (name/weight: string, sets/reps: number) — sin `Record<string, unknown>`,
 * sin `any`, sin casts. La capa de dominio no coacciona strings crudos de un input HTML: quien
 * despacha esta acción ya debe entregar el valor en el tipo correcto (esa coerción —
 * `readSetupNumber`/`readWeightInput`— sigue viviendo en el root, fuera de este módulo).
 */
export type RoutineBuilderRowFieldUpdate =
  | { field: "name"; value: string }
  | { field: "sets"; value: number }
  | { field: "reps"; value: number }
  | { field: "weight"; value: string };

export type RoutineBuilderAction =
  | { type: "select_day"; day: string }
  | { type: "set_routine_name"; routineName: string }
  | { type: "replace_rows"; rows: SetupExerciseRow[] }
  | { type: "reset_state"; setupByDay: Record<string, SetupDayState>; activeDay?: string }
  | { type: "replace_state"; state: RoutineBuilderState }
  | { type: "add_row"; row: SetupExerciseRow }
  | { type: "remove_row"; rowId: string; allowEmptyRows: boolean }
  | { type: "update_row_field"; rowId: string; update: RoutineBuilderRowFieldUpdate };

/**
 * Aplica un `RoutineBuilderRowFieldUpdate` a una fila, preservando `id`/`sourceExerciseId`/
 * `exerciseLineageId` y los demás campos no editados. Preserva la referencia de la fila cuando
 * el valor asignado es exactamente igual al actual (no-op).
 */
function applyRowFieldUpdate(row: SetupExerciseRow, update: RoutineBuilderRowFieldUpdate): SetupExerciseRow {
  switch (update.field) {
    case "name":
      return row.name === update.value ? row : { ...row, name: update.value };
    case "sets":
      return row.sets === update.value ? row : { ...row, sets: update.value };
    case "reps":
      return row.reps === update.value ? row : { ...row, reps: update.value };
    case "weight":
      return row.weight === update.value ? row : { ...row, weight: update.value };
    default: {
      const exhaustiveCheck: never = update;
      throw new Error(`Campo de fila no reconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

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
      // Modela el reset con un setupByDay preparado externamente, sin tocar mensajes ni busy.
      return createRoutineBuilderState({ setupByDay: action.setupByDay, activeDay: action.activeDay });
    case "replace_state":
      return cloneRoutineBuilderState(action.state);
    case "add_row": {
      // Día ausente => se crea con SOLO la fila entregada (cero filas en blanco adicionales).
      // Ver DECISIÓN P3-21 arriba: diverge deliberadamente de addSetupRow() del root.
      const currentDayState = readDayState(state, state.activeDay);
      return {
        ...state,
        setupByDay: {
          ...state.setupByDay,
          [state.activeDay]: {
            routineName: currentDayState.routineName,
            rows: [...currentDayState.rows, { ...action.row }],
          },
        },
      };
    }
    case "remove_row": {
      // allowEmptyRows es obligatorio en el tipo: ver DECISIÓN P3-21B. Sin window.confirm.
      const currentDayState = readDayState(state, state.activeDay);
      const rowExists = currentDayState.rows.some((row) => row.id === action.rowId);
      if (!rowExists) return state; // id inexistente: no-op, no crea el dia, no consulta allowEmptyRows

      const wouldRemoveLastRow = currentDayState.rows.length === 1;
      if (wouldRemoveLastRow && !action.allowEmptyRows) return state; // politica legacy: no-op, sin mutar nada

      const nextRows = currentDayState.rows.filter((row) => row.id !== action.rowId);
      return {
        ...state,
        setupByDay: {
          ...state.setupByDay,
          [state.activeDay]: { routineName: currentDayState.routineName, rows: nextRows },
        },
      };
    }
    case "update_row_field": {
      const currentDayState = readDayState(state, state.activeDay);
      const rowIndex = currentDayState.rows.findIndex((row) => row.id === action.rowId);
      if (rowIndex === -1) return state;

      const targetRow = currentDayState.rows[rowIndex];
      const updatedRow = applyRowFieldUpdate(targetRow, action.update);
      if (updatedRow === targetRow) return state;

      const nextRows = currentDayState.rows.map((row, index) => (index === rowIndex ? updatedRow : row));
      return {
        ...state,
        setupByDay: {
          ...state.setupByDay,
          [state.activeDay]: { routineName: currentDayState.routineName, rows: nextRows },
        },
      };
    }
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Accion de Routine Builder no reconocida: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
