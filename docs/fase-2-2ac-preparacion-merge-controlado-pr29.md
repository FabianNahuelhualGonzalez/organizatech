# Fase 2.2AC - Preparacion de merge controlado PR #29

## 1. Contexto

La Fase 2.2AB quedo aprobada por Claude y lista para Arquitectura. El PR draft #29 fue revisado como gate previo al merge:

- PR: https://github.com/FabianNahuelhualGonzalez/organizatech/pull/29
- Base: `main`
- Head: `feature/training-sessions-fuente-verdad`
- Estado: abierto, Draft, no mergeado.
- Diff revisado: documentacion 2.2H a 2.2AB, cambio de codigo 2.2S, artefacto SQL aislado y migracion `20260531_training_cycles.sql`.
- Checks visibles: Vercel en `success`.
- Preview QA confirmado.
- Production intacta.

La ejecucion productiva de `public.training_cycles` ya fue realizada y cerrada en 2.2P, pero la UI productiva sigue bloqueada. La feature flag `ENABLE_TRAINING_CYCLES_REPOSITORY` debe permanecer OFF/no configurada en Production hasta autorizacion separada. Vercel Production no debe tocarse en esta fase.

## 2. Objetivo de 2.2AC

Preparar el checklist y el plan operativo para un merge controlado futuro del PR #29 hacia `main`, sin ejecutar el merge y sin cambiar el estado Draft del PR.

Esta fase no autoriza:

- Cambiar el PR a Ready for review.
- Mergear a `main`.
- Activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Cambiar variables Vercel.
- Hacer redeploy productivo manual.
- Ejecutar SQL.
- Ejecutar `supabase db push`.
- Ejecutar `supabase migration repair`.
- Tocar Supabase remoto.
- Crear ciclos productivos.

## 3. Estado actual del PR #29

Evidencia read-only tomada para esta fase:

| Campo | Resultado |
| --- | --- |
| URL | `https://github.com/FabianNahuelhualGonzalez/organizatech/pull/29` |
| Numero | `29` |
| Estado | `open` |
| Draft | `true` |
| Merged | `false` |
| Mergeable | `true` |
| Base | `main` |
| Base SHA | `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610` |
| Head | `feature/training-sessions-fuente-verdad` |
| Head SHA | `d174376c9f92cb6f6faa017212de9cdcf1e40195` |
| Merge commit SHA calculado | `d2d08b04f1c109d0e73496850dfbd2eb06cb44d4` |
| Commits incluidos | `19` |
| Archivos cambiados | `24` |
| Additions / deletions | `7475 / 12` |

Nota sobre el merge commit SHA calculado: este SHA es valido en el estado actual. Si se agregan commits a `main` antes del merge, el SHA real del merge commit sera diferente.

Commits incluidos contra `origin/main`:

```text
d174376 docs: document fase 2.2AB PR review gate
e98dda6 docs: document fase 2.2AA draft PR attempt
39cb6e0 docs: prepare fase 2.2Z vercel manual checklist
38ab98e docs: document fase 2.2Y vercel read-only check
08f7dc7 docs: prepare fase 2.2X controlled PR opening
578f09f docs: document fase 2.2W read-only main check
65964fb docs: document fase 2.2V final code deployment gate
b6e1fc9 docs: prepare fase 2.2U controlled vercel activation
f132ad6 docs: plan fase 2.2T vercel training cycles activation
20a6765 feat: prepare controlled production training cycles UI gating
208c21d docs: prepare fase 2.2R controlled UI enablement
a95837e docs: document fase 2.2Q migration history reconciliation
bfa29d9 docs: close fase 2.2P production training cycles execution
7cc6f88 docs: prepare fase 2.2P controlled training cycles execution request
eb5cfb1 docs: reconcile training cycles production execution method
4cfd2a5 docs: document fase 2.2M read-only migration validation
01c9c3d docs: prepare fase 2.2L migration history audit
1f327de docs: prepare fase 2.2J controlled production migration for training cycles
490dec9 docs: prepare fase 2.2H controlled production window for training cycles
```

Archivos incluidos actualmente en el PR:

```text
docs/fase-2-2aa-apertura-pr-draft-training-cycles.md
docs/fase-2-2ab-revision-pr-draft-checks-diff.md
docs/fase-2-2h-ventana-productiva-controlada-training-cycles.md
docs/fase-2-2j-aplicacion-controlada-migracion-productiva-training-cycles.md
docs/fase-2-2l-auditoria-regularizacion-historial-migraciones.md
docs/fase-2-2m-validacion-read-only-migraciones-antiguas.md
docs/fase-2-2n-reconciliacion-metodo-ejecucion-training-cycles.md
docs/fase-2-2n-script-aislado-training-cycles.md
docs/fase-2-2p-cierre-ejecucion-productiva-training-cycles.md
docs/fase-2-2p-solicitud-ejecucion-controlada-training-cycles.md
docs/fase-2-2q-reconciliacion-post-ejecucion-historial-migraciones.md
docs/fase-2-2r-preparacion-habilitacion-ui-training-cycles.md
docs/fase-2-2s-cambio-codigo-habilitacion-ui-training-cycles.md
docs/fase-2-2t-plan-despliegue-activacion-vercel-training-cycles.md
docs/fase-2-2u-preparacion-ejecucion-controlada-vercel-training-cycles.md
docs/fase-2-2v-gate-final-codigo-deployment-training-cycles.md
docs/fase-2-2w-consulta-read-only-main-remoto-github.md
docs/fase-2-2x-apertura-controlada-pr-training-cycles.md
docs/fase-2-2y-consulta-read-only-vercel-preview-pr.md
docs/fase-2-2z-revision-manual-read-only-vercel.md
src/app/page.tsx
src/components/organizatech-app.tsx
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
supabase/migrations/20260531_training_cycles.sql
```

Nota de conteo: al versionar este documento 2.2AC antes del merge, el diff esperado del PR contra `main` pasara a 25 archivos, incluyendo `docs/fase-2-2ac-preparacion-merge-controlado-pr29.md`.

## 4. Gate pre-merge obligatorio

Antes de cualquier merge futuro, Arquitectura debe confirmar de nuevo:

1. PR #29 sigue apuntando a `main` desde `feature/training-sessions-fuente-verdad`.
2. PR #29 sigue sin conflictos (`mergeable=true` o equivalente visible).
3. El head del PR contiene `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26` o un commit posterior que lo contiene.
4. Checks visibles siguen en success.
5. No hay checks fallidos ni pendientes.
6. Preview del PR sigue apuntando a Supabase QA.
7. Production sigue intacta.
8. `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF/no configurada en Production.
9. El PR no incluye `supabase/.temp/`.
10. El PR no incluye archivos `.env`.
11. No se ejecuta `supabase db push`.
12. No se ejecuta `supabase migration repair`.
13. No se ejecuta SQL.
14. No se toca Supabase remoto.

## 5. Estado Draft y requisito Ready for review

El PR #29 esta actualmente en estado Draft:

```text
draft=true
merged=false
mergeable=true
```

Lectura TI preliminar: aunque GitHub informa `mergeable=true`, un PR en Draft normalmente no puede completarse como merge desde la UI hasta pasar a Ready for review. Por lo tanto, la futura fase de merge debe contemplar un paso controlado para cambiar el PR a Ready si GitHub lo exige.

Importante:

- Cambiar el PR a Ready for review no esta autorizado en 2.2AC.
- El cambio a Ready debe requerir aprobacion explicita de Arquitectura.
- Si Arquitectura desea mantener el PR en Draft hasta el ultimo momento, el paso Ready debe quedar inmediatamente antes del merge y dentro de la ventana controlada.
- Si GitHub permite alguna ruta de merge sin cambiar Ready, se debe validar visualmente y documentar antes de ejecutar.

## 6. Checks y Preview actuales

Check visible sobre el head `d174376c9f92cb6f6faa017212de9cdcf1e40195`:

```text
Vercel: success
```

Deployment Preview asociado:

| Campo | Resultado |
| --- | --- |
| Deployment ID | `dpl_ZcXXcxhkSy2z3mZtrjjKr4u3j5Zv` |
| URL | `organizatech-ht9674wp7-fanahuelhualg-8514s-projects.vercel.app` |
| State | `READY` |
| Target | `null` |
| Branch | `feature/training-sessions-fuente-verdad` |
| GitHub PR | `29` |
| Commit | `d174376c9f92cb6f6faa017212de9cdcf1e40195` |

Resultado de `/qa/training-cycles` en Preview:

```text
HTTP 200 OK
VERCEL_ENV=preview
QA tools=enabled
Supabase env=qa
Acceso=permitido
```

Este resultado confirma que el Preview del PR #29 mantiene el helper QA operativo y separado de Production.

## 7. Production intacta

Ultimo deployment Production observado en la lista de Vercel:

| Campo | Resultado |
| --- | --- |
| Deployment ID | `dpl_8gWk9GkYQL61WmrLawus3bGB7dvc` |
| Target | `production` |
| Branch | `main` |
| Commit | `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610` |
| Commit message | `Merge pull request #28 from FabianNahuelhualGonzalez/feature/training-sessions-fuente-verdad` |
| State | `READY` |

No se observo deployment Production generado por PR #29. Los deployments asociados a PR #29 aparecen con `target=null`, por lo tanto corresponden a Preview.

## 8. Plan futuro de merge controlado

Secuencia recomendada para una fase separada de ejecucion de merge:

1. Revalidar el gate pre-merge de la seccion 4.
2. Confirmar visualmente en GitHub que PR #29 sigue en Draft, sin conflictos y con checks success.
3. Si GitHub exige Ready for review para mergear, solicitar autorizacion explicita para cambiar el PR a Ready.
4. Cambiar el PR a Ready solo dentro de la ventana controlada y solo si esta autorizado.
5. Ejecutar merge hacia `main` solo con autorizacion explicita de Arquitectura.
6. No activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
7. No cambiar variables Vercel.
8. No ejecutar redeploy manual salvo instruccion separada.
9. Observar el autodeployment Production generado por Vercel desde `main`, si ocurre.
10. Ejecutar postchecks de Vercel y UI sin crear ciclos productivos.

## 9. Postchecks Vercel despues de merge

Postchecks esperados despues de un merge autorizado:

1. Vercel genera deployment Production desde `main` o se confirma deployment Production equivalente.
2. Deployment Production queda en `READY`/success.
3. Commit desplegado en Production corresponde al merge de PR #29 o contiene `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
4. No se modificaron variables Vercel.
5. `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF/no configurada.
6. No hubo redeploy manual salvo autorizacion separada.
7. `/qa/training-cycles` en Production sigue bloqueado.
8. La UI productiva no expone Training Cycles a usuarios finales.
9. Fallback legacy sigue operativo.
10. No se crearon ciclos productivos.
11. No se ejecuto SQL.
12. No se ejecuto `supabase db push`.
13. No se ejecuto `supabase migration repair`.
14. Verificacion git-level opcional: ejecutar `git fetch` y `git log origin/main --oneline -3` para confirmar via git, independiente de Vercel, que el merge commit es visible en el historial de `main` con el contenido esperado. Esta verificacion es read-only y complementaria a los postchecks Vercel.

## 10. Rollback y contingencia

Si falla el merge, el deployment o cualquier postcheck:

- Mantener `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF/no configurada.
- No ejecutar SQL.
- No tocar Supabase remoto.
- No ejecutar `supabase db push`.
- No ejecutar `supabase migration repair`.
- No activar Training Cycles en UI productiva.
- Reportar evidencia y detener la fase.

Si el merge ya fue completado y se detecta un problema en Production:

- Preferir rollback UI/configuracional manteniendo la feature flag OFF.
- Si se requiere revertir el merge, solicitar autorizacion separada para revert commit o PR de reversa.
- No asumir rollback de base de datos, porque esta fase no modifica datos ni ejecuta migraciones.
- No borrar `public.training_cycles`.

## 11. Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| El merge a `main` puede disparar autodeployment Production | Ejecutar solo en ventana autorizada y monitorear Vercel inmediatamente. |
| PR en Draft puede requerir Ready for review antes del merge | Solicitar autorizacion separada para Ready si GitHub lo exige. |
| Feature flag accidentalmente activa en Production | Reconfirmar OFF/no configurada antes y despues del merge. |
| Codigo 2.2S queda desplegado pero UI debe seguir bloqueada | Mantener gating server-side OFF. |
| Archivos SQL versionados podrian confundirse con ejecucion de migraciones | Reiterar que merge no ejecuta SQL ni autoriza `supabase db push`. |
| Historial de migraciones sigue pendiente de reconciliacion total | Mantener bloqueo de `supabase db push` y no usar `migration repair` sin fase separada. |
| Preview QA y Production podrian confundirse durante validacion | Validar `VERCEL_ENV`, branch, target y Supabase env antes de cada lectura. |

## 12. Criterios de aborto

Abortar y reportar si ocurre cualquiera de estos casos:

- PR #29 deja de apuntar a `main` desde `feature/training-sessions-fuente-verdad`.
- PR #29 muestra conflictos o deja de ser mergeable.
- Checks fallan o quedan pendientes sin explicacion.
- Preview no usa Supabase QA.
- Production cambia antes del merge autorizado.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` aparece activa/configurada en Production antes de la autorizacion.
- El PR incluye `supabase/.temp/`.
- El PR incluye archivos `.env`.
- Se detecta cualquier intento de ejecutar SQL, `supabase db push` o `supabase migration repair`.
- Vercel muestra comportamiento distinto al documentado.
- Hay duda de ambiente.

## 13. Recomendacion TI preliminar

TI puede recomendar a Arquitectura solicitar una fase separada para ejecutar el merge controlado de PR #29 solo si se mantienen estas condiciones:

- PR #29 sigue Draft hasta autorizacion explicita.
- Checks siguen en success.
- Preview sigue usando Supabase QA.
- Production sigue intacta.
- Feature flag Production sigue OFF/no configurada.
- Arquitectura autoriza explicitamente cualquier cambio a Ready for review.
- Arquitectura autoriza explicitamente el merge.

La activacion de `ENABLE_TRAINING_CYCLES_REPOSITORY` debe seguir separada del merge y requerir una fase posterior. El merge de PR #29 no debe interpretarse como autorizacion para activar Training Cycles en Production.

## 14. Confirmaciones de 2.2AC

- No se cambio el PR a Ready for review.
- No se hizo merge.
- No se activo feature flag.
- No se cambiaron variables Vercel.
- No se hizo redeploy manual.
- No se toco Production Deployment.
- No se ejecuto SQL.
- No se toco Supabase remoto.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se modifico base de datos.
- No se crearon ciclos productivos.
- No se hizo commit ni push.
- `supabase/.temp/` debe seguir fuera del versionado.
