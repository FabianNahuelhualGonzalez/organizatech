# Fase 2.2BD - Preparacion controlada de PR/merge cycle-scoped

## 1. Resumen ejecutivo

La rama:

```text
feature/training-cycles-controlled-next-cycle
```

consolida el modelo cycle-scoped de Training validado en Preview/QA. Incluye
modelo SQL, constraints, RLS, grants, RPCs, integracion frontend, persistencia,
render post-save y semantica date-only de `planned_date`.

Estado de esta fase:

```text
Preparacion read-only/documental.
PR no creado.
Merge no ejecutado.
Production bloqueada.
SQL Production pendiente.
Feature flag Production OFF/no configurada.
```

Abrir un PR draft no debe modificar `main`, Production, Supabase Production ni
variables Vercel. El efecto esperado de la integracion Git es crear o asociar un
deployment/check Preview para la rama. Ese deployment debe verificarse como
Preview y `READY` antes de aprobar el merge.

## 2. Estado de rama local/remota

Referencias disponibles durante la preparacion:

```text
HEAD:
1349d4c89aa217978da760224c035b25e1ca0f8f

origin/feature/training-cycles-controlled-next-cycle:
1349d4c89aa217978da760224c035b25e1ca0f8f

main:
2963487b59e262de2a1161f761eb790ef31d974b

origin/main:
2963487b59e262de2a1161f761eb790ef31d974b

merge-base origin/main HEAD:
2963487b59e262de2a1161f761eb790ef31d974b
```

Lectura:

- la rama local coincide con su referencia remota disponible;
- `main` local coincide con `origin/main` disponible;
- la feature parte directamente del HEAD disponible de `main`;
- no existe divergencia de base en las referencias inspeccionadas;
- con este estado no se anticipan conflictos de merge.

No se ejecuto `git fetch` en 2.2BD. Antes de abrir el PR se debe actualizar la
lectura remota y repetir esta comparacion para descartar cambios posteriores en
`origin/main`.

Estado del working tree antes de crear este documento:

```text
?? supabase/.temp/
```

## 3. Commits incluidos desde main

La rama contiene 14 commits sobre `main`, en orden:

| Orden | Commit | Descripcion |
|---:|---|---|
| 1 | `5036f5a` | Crear microciclo controlado para la validacion. |
| 2 | `16e60f3` | Aislar estado UI sin modificar legacy. |
| 3 | `0c2ab2f` | Preparar modelo y migracion QA cycle-scoped. |
| 4 | `d18a3d1` | Endurecer grants de la migracion QA. |
| 5 | `c75bd72` | Normalizar grants/policies de `training_cycles`. |
| 6 | `e97ada7` | Versionar patch de constraints y policies QA. |
| 7 | `0f6a77a` | Agregar repository frontend cycle-scoped. |
| 8 | `360ca67` | Evitar ciclo activo stale durante setup. |
| 9 | `8fdad5c` | Resetear setup stale antes de crear ciclo. |
| 10 | `049ceac` | Renderizar plan activo desde tablas scoped. |
| 11 | `024db27` | Persistir sesiones/entries scoped y contrato 2.2AX. |
| 12 | `5135df0` | Renderizar sesiones scoped guardadas. |
| 13 | `cfc3118` | Calcular `planned_date` desde el rango del ciclo. |
| 14 | `1349d4c` | Consolidar evidencia QA y plan de despliegue. |

## 4. Diff final resumido contra main

Diff versionado actual `main...HEAD`:

```text
12 files changed
4383 insertions
76 deletions
```

Distribucion:

```text
Documentacion: 3 archivos nuevos.
Frontend/repositorios/tests: 6 archivos.
Migraciones SQL: 3 archivos nuevos.
```

Cambios funcionales principales:

- repository cycle-scoped para crear y cargar planes;
- persistencia de sesiones y entries mediante RPC;
- render exclusivo scoped cuando hay ciclo scoped activo;
- bloqueo de fallback legacy silencioso;
- recarga post-save no critica;
- `planned_date` date-only dentro del rango del ciclo;
- fallback legacy preservado cuando el repository esta OFF.

Cuando este documento 2.2BD sea versionado, el PR esperado pasara a incluir 13
archivos. Las cifras deben recalcularse justo antes de abrir el PR.

## 5. Archivos de un eventual PR

Archivos ya versionados en la rama:

```text
docs/fase-2-2an-migracion-qa-candidata-cycle-scoped-training.md
docs/fase-2-2ax-aplicacion-controlada-qa-contrato-session-entries-cycle-scoped.md
docs/fase-2-2bc-consolidacion-qa-preparacion-merge-despliegue-cycle-scoped.md
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

Documento que se agregaria al versionar 2.2BD:

```text
docs/fase-2-2bd-preparacion-controlada-pr-merge-cycle-scoped.md
```

## 6. Archivos excluidos

Debe permanecer excluido:

```text
supabase/.temp/
```

Es metadata local de Supabase CLI, no una migracion ni un artefacto de producto.
No debe stagearse, commitearse ni aparecer en el PR.

Tambien deben quedar fuera:

- `.env.local`;
- claves o tokens;
- archivos generados no relacionados;
- datos exportados desde QA o Production;
- cualquier cambio posterior no auditado.

## 7. Migraciones SQL incluidas

El eventual PR incluiria:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

Responsabilidades:

- modelo base `training_cycle_*`, columnas, indices, triggers, RLS, grants y RPCs;
- constraints compuestas y policies que impiden mezclar ciclos;
- contrato de entries scoped puras con `exercise_id = null`.

Las migraciones fueron aplicadas manualmente y validadas en Supabase QA. Su
presencia en Git no implica aplicacion automatica ni autorizacion productiva.

## 8. Migraciones pendientes para Production

Las tres migraciones siguen pendientes de precheck, autorizacion y aplicacion
controlada en Production.

Orden candidato:

```text
1. 20260604_training_cycle_scoped_model.sql
2. 20260604_training_cycle_scoped_policy_fix.sql
3. 20260605_training_cycle_scoped_session_entries_contract.sql
```

No deben aplicarse durante la apertura del PR ni durante el merge. El merge de
archivos SQL solo versiona el contrato.

Antes de SQL Production se requiere una fase separada para:

- confirmar project ref y ambiente;
- levantar schema, constraints, grants, policies y RPCs actuales;
- capturar conteos legacy;
- revisar compatibilidad con datos existentes;
- confirmar rollback;
- aplicar manualmente y ejecutar postchecks.

No usar `supabase db push` ni `migration repair` sin una autorizacion especifica.

## 9. Diferencias QA vs Production conocidas

| Area | QA validado | Production conocida |
|---|---|---|
| Codigo | Preview de la rama feature validado. | `main` disponible sigue en `2963487`; feature no mergeada. |
| Schema | Tres migraciones cycle-scoped aplicadas manualmente. | Migraciones cycle-scoped pendientes; requiere precheck directo. |
| Feature flag | Repository habilitado por gating Preview/QA. | `ENABLE_TRAINING_CYCLES_REPOSITORY` debe seguir OFF/no configurada. |
| Supabase | Preview usa Supabase QA. | Production debe usar Supabase Production; revalidar variables antes del merge/despliegue. |
| Datos | Ciclo 6 y sesiones QA controladas. | No crear ni modificar ciclos productivos durante PR/merge. |
| Entries | `exercise_id` nullable cuando existe `training_cycle_exercise_id`. | Contrato productivo exacto debe confirmarse antes de SQL. |
| RLS/grants | Normalizados y postcheckeados. | Deben auditarse antes de aplicar migraciones. |

## 10. Variables y feature flags

Gating QA:

```text
VERCEL_ENV = preview
NEXT_PUBLIC_ENABLE_QA_TOOLS = true
NEXT_PUBLIC_SUPABASE_ENV = qa
```

Estado actual Production:

```text
VERCEL_ENV = production
ENABLE_TRAINING_CYCLES_REPOSITORY = OFF/no configurada
```

Configuracion objetivo eventual Production, solo con autorizacion separada:

```text
VERCEL_ENV = production
ENABLE_TRAINING_CYCLES_REPOSITORY = true
```

Reglas:

- `ENABLE_TRAINING_CYCLES_REPOSITORY` es server-side;
- debe permanecer OFF/no configurada antes, durante y despues del PR/merge;
- Preview y Production deben usar URLs/anon keys Supabase de sus ambientes;
- no configurar variables como `All Environments` si mezcla QA y Production;
- abrir un PR no autoriza cambiar variables ni redeployar Production.

## 11. Riesgo de abrir PR

Riesgo directo esperado:

```text
Bajo, si el PR se abre como draft y no se mergea.
```

Abrir un PR:

- no cambia `main`;
- no ejecuta las migraciones por si mismo;
- no activa la feature flag;
- no modifica Supabase;
- no debe crear un deployment Production.

Efectos esperados:

- GitHub calcula el diff y mergeability;
- Vercel crea o asocia un deployment/check Preview para la rama/commit;
- revisores acceden al diff y checks.

Riesgos residuales:

- una integracion Vercel mal configurada podria clasificar incorrectamente un
  deployment;
- un workflow CI no auditado podria ejecutar acciones adicionales;
- `origin/main` podria avanzar y generar conflictos;
- el PR podria incluir archivos no autorizados si no se revisa el diff;
- un merge accidental desplegaria codigo antes de la ventana SQL.

Merge a `main` genera un deployment Vercel Production; por eso la flag debe
seguir OFF antes y durante el merge.

## 12. Confirmacion esperada de Vercel Preview

Para el commit que sea HEAD al abrir el PR se debe confirmar:

```text
Project: organizatech
Git branch: feature/training-cycles-controlled-next-cycle
Git commit SHA: HEAD exacto del PR
State/readyState: READY
Target: Preview / no production
VERCEL_ENV: preview
QA tools: enabled
Supabase env: qa
```

Si abrir el PR no agrega commits, Vercel puede asociar al PR el deployment ya
generado por el ultimo push. Si se agrega el documento 2.2BD mediante un commit,
se espera un nuevo Preview para ese commit documental.

No promover, redeployar ni tocar Production durante esta confirmacion.

## 13. Checklist antes de abrir PR

1. Obtener autorizacion explicita para abrir PR draft.
2. Ejecutar `git fetch` read-only/autorizado y actualizar referencias.
3. Confirmar rama y HEAD exactos.
4. Confirmar feature alineada con su remoto.
5. Confirmar base real `origin/main`.
6. Recalcular commits, archivos y diff.
7. Confirmar ausencia de conflictos.
8. Confirmar que solo entran los 13 archivos esperados.
9. Confirmar `supabase/.temp/` y `.env.local` fuera del versionado.
10. Ejecutar:
    - `npm run typecheck`;
    - `npm test`;
    - `npm run build`;
    - `git diff --check`;
    - busquedas de mojibake.
11. Auditar las tres migraciones en orden.
12. Confirmar Preview final `READY`.
13. Confirmar target Preview y Supabase QA.
14. Confirmar Production flag OFF/no configurada.
15. Preparar titulo, descripcion, riesgos, rollback y evidencia QA.
16. Abrir PR como draft, sin marcar Ready y sin merge.

## 14. Checklist antes de merge

1. PR aprobado por TI, Claude y Arquitectura.
2. Diff final sin archivos inesperados.
3. Checks obligatorios exitosos y sin pendientes.
4. Preview QA funcional sobre HEAD exacto.
5. Sin conflictos con `main`.
6. Production estable antes del merge.
7. `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF/no configurada.
8. Confirmar que merge no ejecuta SQL automaticamente.
9. Confirmar que deployment Production del merge tendra repository OFF.
10. Rollback frontend documentado y disponible.
11. Ventana SQL Production aun separada y no iniciada.
12. Autorizacion explicita de merge en una fase distinta.

## 15. Criterios de aborto

Abortar apertura o merge si:

- rama, SHA o base no coinciden;
- `origin/main` avanzo sin reauditoria;
- aparece un archivo no esperado;
- `supabase/.temp/` o secretos aparecen en el diff;
- hay conflictos;
- falla typecheck, tests, build o `git diff --check`;
- Preview no queda `READY`;
- el deployment tiene target Production;
- Preview no apunta a Supabase QA;
- QA tools no estan habilitadas en Preview;
- Production flag aparece activa;
- el PR o workflow intenta aplicar SQL;
- una migracion difiere de la version auditada;
- RLS/grants/RPCs no estan claros;
- falta rollback;
- se requiere tocar Supabase, Vercel o Production sin autorizacion.

## 16. Riesgos pendientes

- SQL QA fue aplicado manualmente; debe preservarse trazabilidad con Git.
- Cierre de ciclo y creacion del siguiente no son una transaccion unica.
- Falta idempotencia explicita contra doble submit inmediato.
- `exercise_id NOT NULL` no puede restaurarse con entries scoped null existentes.
- Recarga no critica post-save puede dejar `cycleScopedLoadError` hasta page reload.
- Sesiones QA antiguas conservan `planned_date = 2026-06-02`.
- Multi-week, multiples rutinas por dia y templates siguen fuera del MVP.
- Falta una fase productiva separada para schema, activacion y prueba controlada.

## 17. Recomendacion de siguiente fase

Siguiente fase recomendada:

```text
Fase 2.2BE - Apertura controlada de PR draft cycle-scoped
```

Alcance sugerido:

1. actualizar referencias remotas;
2. repetir diff/checks sobre HEAD final;
3. confirmar Preview final;
4. crear PR draft hacia `main`;
5. registrar URL y numero;
6. no marcar Ready;
7. no mergear;
8. mantener SQL, Vercel Production y feature flag bloqueados.

La revision del PR y la autorizacion de merge deben ocurrir en fases posteriores
separadas.

## 18. Confirmaciones de alcance 2.2BD

- No se abrio PR.
- No se hizo merge.
- No se toco Production.
- No se ejecuto SQL remoto.
- No se toco Supabase remoto.
- No se toco Vercel.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se hizo backfill.
- No se cambiaron feature flags productivas.
- No se editaron ni borraron datos QA.
- No se crearon ciclos QA.
- No se creo legacy artificial.
- `supabase/.temp/` permanece untracked y excluido.
- No se hizo commit.
- No se hizo push.
