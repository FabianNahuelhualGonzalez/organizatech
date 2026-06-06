# Fase 2.2BC - Consolidacion QA y preparacion de merge/despliegue cycle-scoped

## 1. Resumen ejecutivo

La rama:

```text
feature/training-cycles-controlled-next-cycle
```

contiene el modelo cycle-scoped de Training validado en Preview/QA. El alcance
incluye:

- planificacion operativa por ciclo;
- creacion transaccional de ciclo, rutinas, dias y ejercicios;
- lectura/render exclusivo desde tablas cycle-scoped cuando el repository esta activo;
- persistencia transaccional de sesiones y entries cycle-scoped;
- soporte de `exercise_entries.exercise_id = null` cuando existe
  `training_cycle_exercise_id`;
- dashboard, progreso y post-save alimentados por sesiones cycle-scoped;
- calculo date-only de `planned_date` desde el rango real del ciclo.

QA fue validado funcionalmente. Production permanece bloqueada. Este documento no
autoriza merge, SQL Production, cambios Vercel ni activacion de la feature flag.

## 2. Estado actual de la rama

Estado local al preparar 2.2BC:

```text
branch: feature/training-cycles-controlled-next-cycle
HEAD: cfc311838891a44974785544a83faef113efc0d5
origin/feature/training-cycles-controlled-next-cycle: alineado con HEAD
base local main: 2963487b59e262de2a1161f761eb790ef31d974b
commits sobre main: 13
```

Estado de archivos:

```text
?? supabase/.temp/
```

`supabase/.temp/` es metadata local de Supabase CLI. Sigue untracked y debe
permanecer excluido de cualquier commit, PR o merge.

## 3. Commits relevantes

| Commit | Proposito |
|---|---|
| `5036f5a` | Crear el siguiente ciclo controlado como microciclo. |
| `16e60f3` | Aislar estado visual sin modificar datos legacy. |
| `0c2ab2f` | Preparar modelo SQL cycle-scoped y documento 2.2AN. |
| `d18a3d1` | Endurecer grants de la migracion QA. |
| `c75bd72` | Normalizar grants/policies de `training_cycles`. |
| `e97ada7` | Versionar patch de coherencia y policies 2.2AR. |
| `0f6a77a` | Integrar repository y creacion cycle-scoped desde frontend. |
| `360ca67` | Evitar uso de ciclo activo stale durante setup. |
| `8fdad5c` | Resetear setup stale antes de crear el ciclo. |
| `049ceac` | Renderizar el plan activo desde tablas cycle-scoped. |
| `024db27` | Persistir sesiones/entries cycle-scoped y versionar 2.2AX. |
| `5135df0` | Recargar y renderizar sesiones guardadas cycle-scoped. |
| `cfc3118` | Calcular `planned_date` desde el rango real del ciclo. |

Commits de cierre funcional:

```text
2.2BA: 5135df053ccfa3776565315f0077cdae7f5d04a8
2.2BB: cfc311838891a44974785544a83faef113efc0d5
```

## 4. Archivos incluidos por fase

Delta consolidado contra `main` local:

```text
docs/fase-2-2an-migracion-qa-candidata-cycle-scoped-training.md
docs/fase-2-2ax-aplicacion-controlada-qa-contrato-session-entries-cycle-scoped.md
package.json
src/components/organizatech-app.tsx
src/lib/training/cycle-scoped-planned-date.test.ts
src/lib/training/cycle-scoped-planned-date.ts
src/lib/training/cycle-scoped-training-repository.ts
src/lib/training/training-cycles-repository.ts
supabase/migrations/20260604_training_cycle_scoped_model.sql
supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql
supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql
```

Agrupacion:

- 2.2AN/2.2AP/2.2AP-b: modelo, RLS, policies y grants.
- 2.2AR: constraints compuestas y correccion de coherencia entre ciclos.
- 2.2AT: creacion de ciclo + plan desde frontend.
- 2.2AU: lectura/render cycle-scoped.
- 2.2AX/2.2AZ: contrato SQL y persistencia frontend de sesiones/entries.
- 2.2BA: recarga y render de sesiones guardadas.
- 2.2BB: semantica date-only de `planned_date`.

## 5. SQL aplicado en QA

Segun la evidencia cerrada de las fases anteriores, QA recibio manualmente y en
este orden logico:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

Objetos principales:

- columnas normalizadas en `training_cycles`:
  `duration_weeks`, `planned_start_date`, `planned_end_date`;
- tablas:
  `training_cycle_routines`, `training_cycle_days`,
  `training_cycle_exercises`;
- columnas:
  `training_sessions.cycle_id`, `training_sessions.cycle_day_id`,
  `exercise_entries.training_cycle_exercise_id`;
- constraints de coherencia entre routine/day/exercise/session y `cycle_id`;
- RLS y policies `to authenticated`;
- normalizacion de grants: `anon` sin permisos y `authenticated` solo con
  `SELECT`, `INSERT`, `UPDATE`;
- RPCs `SECURITY INVOKER`:
  `create_training_cycle_with_plan` y
  `create_training_session_with_cycle_entries`;
- `exercise_entries.exercise_id` nullable;
- constraint:
  `exercise_id is not null or training_cycle_exercise_id is not null`.

No se uso `supabase db push` ni `migration repair`; la aplicacion QA fue manual.

## 6. SQL pendiente para Production

Los tres archivos anteriores siguen pendientes de autorizacion y aplicacion en
Production. No deben aplicarse parcialmente ni fuera de una ventana separada.

Orden candidato:

1. `20260604_training_cycle_scoped_model.sql`
2. `20260604_training_cycle_scoped_policy_fix.sql`
3. `20260605_training_cycle_scoped_session_entries_contract.sql`

Antes de ejecutarlos se debe confirmar mediante prechecks read-only:

- ambiente y project ref de Production;
- objetos existentes y posible colision de nombres;
- estado real de columnas, constraints, policies, grants y RPCs;
- conteos baseline de `training_cycles`, `training_sessions`,
  `exercise_entries` y `exercises`;
- ausencia de datos incompatibles;
- metodo de registro del SQL manual en el historial operativo.

No ejecutar `migration repair` para reconciliar ejecuciones manuales sin una fase
y autorizacion especificas.

## 7. Diferencias QA vs Production conocidas

| Area | QA | Production |
|---|---|---|
| Frontend | Preview del commit `cfc3118`, cycle-scoped habilitado por gating QA. | Rama feature no mergeada; codigo cycle-scoped consolidado aun no desplegado desde `main`. |
| Gating | `VERCEL_ENV=preview`, QA tools habilitadas, `NEXT_PUBLIC_SUPABASE_ENV=qa`. | Debe permanecer con `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF/no configurada. |
| Supabase | Tres patches cycle-scoped aplicados manualmente. | Patches cycle-scoped pendientes. Requiere precheck directo antes de afirmar el schema exacto. |
| Modelo | Tablas `training_cycle_*`, relaciones compuestas y RPCs disponibles. | Solo se considera confirmado el baseline productivo previo; no asumir objetos cycle-scoped nuevos. |
| Entries | `exercise_id` nullable con constraint alternativa. | Se espera contrato legacy anterior hasta validar directamente. |
| Datos | Ciclo 6 y sesiones QA controladas. | Existe evidencia historica de un ciclo tecnico desviado que debe permanecer congelado y sin uso funcional. |
| Grants/policies | Normalizados y postcheckeados en QA. | Deben auditarse read-only antes de aplicar cualquier cambio. |

Las variables sensibles no se documentan por valor. Antes de Production se debe
confirmar en Vercel, por ambiente, que Preview apunta a Supabase QA y Production
apunta a Supabase Production.

## 8. Evidencia funcional QA

Estado de ambiente confirmado:

```text
VERCEL_ENV = preview
QA tools = enabled
Supabase env = qa
Sesion activa = si
Ciclo 6 active = si
```

Validaciones cerradas:

- creacion transaccional de ciclo y plan;
- rutina/dia/ejercicio leidos desde tablas cycle-scoped;
- ausencia de arrastre visual legacy;
- guardado real mediante RPC;
- `training_sessions.cycle_id` y `cycle_day_id` poblados;
- `exercise_entries.training_cycle_exercise_id` poblado;
- `exercise_entries.exercise_id = null` sin crear legacy artificial;
- recarga post-save no critica y sin reintento duplicado por fallo de reload;
- dashboard y progreso alimentados por datos scoped;
- `planned_date` derivado del rango real del ciclo.

Ultima sesion 2.2BB:

```text
session_id = 33ac7a6a-734c-4728-bcb5-afa10f3da630
cycle_id = 2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a
cycle_day_id = 2c8ecbc3-29ee-403a-9b5d-d88449b2cfa1
planned_day = tuesday
planned_date = 2026-06-09
trained_date = 2026-06-05
status = completed
week_number = 1
```

Ultima entry:

```text
entry_id = 57461fc8-d9d0-4442-a85a-a1258d737ca4
training_cycle_exercise_id = fd50eb8b-5b60-48c7-bb9f-b9654737bb2d
exercise_id = null
weight = 21
previous_weight = 20
reps = [12,12,12]
```

Conteos observados:

```text
training_sessions: 7 -> 8
exercise_entries: 8 -> 9
legacy_exercises: 11 -> 11
```

La estabilidad de `legacy_exercises` confirma que no se creo un ejercicio legacy
artificial para completar el flujo scoped.

## 9. Riesgos restantes

1. Las tres migraciones fueron aplicadas manualmente en QA. Debe evitarse deriva
   entre archivos Git, schema remoto e historial operativo.
2. El cierre de un ciclo activo y la creacion del siguiente no forman una unica
   transaccion frontend.
3. No existe una clave de idempotencia explicita para impedir dos submits casi
   simultaneos antes de que React deshabilite el boton.
4. Restaurar `exercise_id NOT NULL` no es posible mientras existan entries scoped
   con `exercise_id = null`.
5. Las policies y grants de tablas legacy existentes cambian como parte del modelo;
   requieren baseline y postcheck productivo estrictos.
6. El registro productivo tecnico desviado no debe editarse, borrarse ni asociarse
   a sesiones sin una fase separada.
7. La activacion de la flag antes de completar schema y RPCs produciria fallos de
   escritura.
8. Una configuracion Vercel cruzada podria apuntar Preview a Production o
   Production a QA.
9. Existen sesiones QA previas a 2.2BB con `planned_date = 2026-06-02`.
   Estas sesiones no fueron modificadas y no deben modificarse. Su aparicion en
   el dashboard queda determinada por su `calendar_week_start`; si apunta a la
   semana de junio 1, no colisionan con semanas posteriores.

## 10. Deudas tecnicas

- selector definitivo de tipo, objetivo y duracion del ciclo;
- soporte futuro de multiples rutinas por dia mediante `session_slot`;
- templates reutilizables y clonacion controlada de ciclos;
- idempotencia explicita para guardar sesiones;
- cierre/creacion de ciclo en una operacion transaccional unica;
- tratamiento UX de sesion Supabase expirada;
- recarga no critica post-save puede bloquear el training screen con
  `cycleScopedLoadError` hasta page reload si la red falla despues de un guardado
  exitoso;
- robustecer seleccion de semanas y dias para planes multi-week;
- ordenar y paginar historial de sesiones de forma explicita;
- prueba RLS end-to-end con segundo usuario QA, si no existe evidencia separada;
- estrategia formal para clasificar el ciclo productivo tecnico como cancelled,
  technical test o evidencia congelada.

## 11. Checklist PR/merge

1. Confirmar rama y HEAD exactos.
2. Confirmar `supabase/.temp/` fuera del versionado.
3. Confirmar diff contra `origin/main` actualizado, no solo `main` local.
4. Revisar que el PR incluya exclusivamente los archivos consolidados.
5. Ejecutar:
   - `npm run typecheck`;
   - `npm test`;
   - `npm run build`;
   - `git diff --check`;
   - busqueda de mojibake.
6. Revisar SQL estaticamente por operaciones destructivas o grants amplios.
7. Confirmar checks Vercel Preview `READY`.
8. Repetir smoke QA sin crear datos adicionales salvo autorizacion.
9. Confirmar que Production feature flag sigue OFF/no configurada.
10. Obtener auditoria TI/Claude/Arquitectura.
11. Crear PR draft.
12. Revisar diff, checks y conflictos.
13. Autorizar merge en fase separada.
14. No interpretar merge como autorizacion de SQL o activacion productiva.

## 12. Estrategia futura de despliegue productivo

Orden recomendado:

1. Merge controlado a `main`, manteniendo
   `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF.
2. Confirmar deployment Production `READY` del commit mergeado.
3. Ejecutar smoke test legacy con repository OFF.
4. Abrir ventana SQL Production separada.
5. Ejecutar prechecks read-only y capturar baseline.
6. Aplicar los tres archivos SQL en orden.
7. Ejecutar postchecks de schema, RLS, grants, RPCs y conteos legacy.
8. Mantener feature flag OFF durante un periodo de observacion.
9. Abrir fase separada de activacion.
10. Configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true`.
11. Redeploy controlado y confirmar commit/target Production.
12. Ejecutar una prueba productiva minima con usuario y datos autorizados.
13. Confirmar persistencia, dashboard, historial y ausencia de legacy artificial.

Cada bloque requiere autorizacion independiente. SQL y activacion no deben
combinarse en una sola accion irreversible.

## 13. Rollback frontend

Rollback funcional preferido:

1. Remover o setear `ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
2. Redeploy controlado.
3. Confirmar `trainingCyclesRepositoryEnabled=false`.
4. Confirmar regreso al fallback legacy.
5. Preservar datos cycle-scoped; no borrar ciclos, sesiones ni entries.

Si el problema es del deployment, revertir al ultimo commit Production aprobado
manteniendo la flag OFF.

## 14. Rollback SQL

Rollback SQL solo con autorizacion y despues de inspeccionar datos:

1. Apagar la feature flag antes de cualquier reversa.
2. Preservar evidencia y conteos.
3. Restaurar la RPC anterior de
   `create_training_session_with_cycle_entries`.
4. Restaurar policies/grants anteriores solo desde una version aprobada.
5. Dropear, si corresponde:

```sql
alter table public.exercise_entries
  drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
```

6. Restaurar `exercise_id NOT NULL` solo si:

```sql
select count(*)
from public.exercise_entries
where exercise_id is null;
```

devuelve `0`.

7. Las FKs compuestas, columnas y tablas cycle-scoped solo pueden retirarse si no
   existen dependencias ni datos que deban preservarse.
8. Preferir un patch forward-fix sobre un rollback destructivo.
9. No ejecutar `DROP TABLE`, limpieza o backfill sin fase separada.

## 15. Postchecks QA/Production

Postchecks de base de datos:

- tablas y columnas esperadas;
- constraints de fechas, coherencia de ciclo y entry alternativa;
- RLS habilitada;
- policies exactas `to authenticated`;
- `anon` sin grants;
- `authenticated` sin `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`;
- RPCs presentes como `SECURITY INVOKER`;
- conteos legacy sin cambios inesperados;
- `exercise_id` legacy sigue consultable;
- entries scoped aceptan `exercise_id = null`.

Postchecks de deployment:

- target y ambiente exactos;
- commit desplegado exacto;
- variables Supabase separadas por ambiente;
- QA tools deshabilitadas en Production;
- flag productiva en el estado autorizado.

Postchecks funcionales con flag ON:

- ciclo y plan creados atomicamente;
- rutina/dia/ejercicio pertenecen al mismo `cycle_id`;
- session y entries quedan asociadas a los IDs scoped;
- `planned_date` cae dentro del rango del ciclo;
- `trained_date` conserva la fecha real;
- dashboard/progreso reflejan el guardado;
- no hay fallback legacy silencioso;
- no se crean ejercicios legacy artificiales;
- usuario A no accede a datos del usuario B.

## 16. Criterios de aborto

Abortar si:

- hay duda de ambiente o project ref;
- el commit desplegado no es el autorizado;
- la flag productiva esta activa antes de tiempo;
- Production apunta a Supabase QA o Preview a Supabase Production;
- el baseline de schema no coincide con lo esperado;
- existen policies/grants no inventariados;
- un archivo SQL falla o queda parcialmente aplicado;
- cambian conteos legacy sin explicacion;
- RLS multiusuario falla;
- una RPC crea datos para otro usuario/ciclo/dia;
- se requiere `db push`, `migration repair`, backfill o SQL adicional no autorizado;
- el rollback no es viable por entries con `exercise_id = null`;
- aparece legacy artificial o mezcla de ciclos;
- Preview/Production no queda `READY`.

## 17. Recomendacion de siguiente fase

Siguiente fase recomendada:

```text
Fase 2.2BD - Auditoria final de rama y apertura controlada de PR draft
```

Alcance sugerido:

1. actualizar referencias remotas read-only;
2. revisar diff final contra `origin/main`;
3. ejecutar validaciones completas;
4. auditar las tres migraciones como conjunto ordenado;
5. confirmar Preview final;
6. crear PR draft sin merge;
7. mantener Production, SQL y feature flag bloqueados.

Despues del merge, preparar una fase distinta para el precheck SQL Production.
La activacion de `ENABLE_TRAINING_CYCLES_REPOSITORY` debe permanecer como una fase
posterior e independiente.

## 18. Confirmaciones de alcance 2.2BC

- No se aplico SQL.
- No se toco Supabase remoto.
- No se toco Vercel.
- No se toco Production.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se creo PR.
- No se hizo merge.
- No se hizo backfill.
- No se edito ni borro Ciclo 6.
- No se editaron ni borraron sesiones anteriores.
- No se crearon ciclos QA.
- No se creo legacy artificial.
- No se versiono `supabase/.temp/`.
- No se hizo commit.
- No se hizo push.
