# Fase 2.2CC - Preparacion merge controlado fixes scoped QA

## 1. Resumen ejecutivo

2.2CC consolida la preparacion previa a un eventual merge controlado desde `validation/2-2bx-preview-qa` hacia `main`.

La validacion QA scoped posterior a 2.2CB fue aprobada por Arquitectura:

- Ciclo 7 existente: OK.
- Ejercicio `prueba 07-06`: OK.
- Guardado scoped: OK.
- Render/dashboard scoped: OK.
- Estado `Registrado` / `Completado`: OK.
- Legacy artificial: NO.
- Duplicados inesperados: NO.
- Production: intacta.

Esta fase no ejecuta merge, no aplica SQL, no toca Supabase remoto, no modifica Vercel y no activa Training Cycles Production. El objetivo es dejar claro que entra al eventual merge y que gates deben cumplirse antes y despues.

## 2. Estado aprobado de QA

Arquitectura aprobo el cierre funcional del flujo scoped QA con una sesion real sobre Ciclo 7.

Fases relacionadas:

- 2.2CB: cerrada con resultado C - datos incompletos. El estado `Pendiente` era coherente porque no existia sesion/entry asociada al ejercicio visible.
- Prueba controlada posterior: aprobada. La sesion/entry scoped creada pertenece exactamente al dia y ejercicio visible.
- 2.2CA / flujo scoped QA: validado funcionalmente con sesion real.

## 3. Evidencia de Ciclo 7 y guardado scoped

Evidencia aceptada:

```text
training_session_id: ac90fa35-56ba-4135-9953-0276026dd8ff
cycle_id: d37eb019-4b52-44d8-b951-1c83c382f7bf
cycle_day_id: 9d3630ad-eb30-4e81-b0a5-1f7c2e5a531f
training_cycle_exercise_id: 2029d7af-7481-4391-990f-1171ec1fdead
exercise_id: null
```

Cadena funcional aprobada:

```text
Ciclo 7
-> dia visible
-> ejercicio visible
-> training_session completed
-> exercise_entry scoped
-> dashboard/progreso
-> estado Registrado/Completado
```

## 4. Rama origen y rama destino

Rama origen:

```text
validation/2-2bx-preview-qa
```

Rama destino eventual:

```text
main
```

HEAD local origen:

```text
ebdcababce8f3fac1e48cb5d671d654adce12c05
```

HEAD local main al momento de la revision:

```text
28fba178439becf027bfa541b5365acd6c0b57df
```

## 5. Commits pendientes

Commits en `validation/2-2bx-preview-qa` pendientes respecto de `main`:

```text
ebdcaba fix: prevent legacy refresh from overwriting scoped display state
5fd1410 fix: map cycle-scoped identities for dashboard session/entry matching
95a9acc chore: trigger preview validation for 2.2bx
```

Nota: `95a9acc` es un commit vacio para gatillar Preview QA y no aporta diff de archivos.

## 6. Archivos modificados contra main

Diff final contra `main`:

```text
A docs/fase-2-2bz-correccion-mapping-sesiones-entries-scoped-dashboard.md
A docs/fase-2-2ca-diagnostico-trazabilidad-estado-visual-scoped-ciclo-7.md
M src/components/organizatech-app.tsx
M src/lib/progress/types.ts
M src/lib/training/cycle-scoped-training-repository.ts
```

Resumen de diff:

```text
5 files changed, 629 insertions(+), 17 deletions(-)
```

Contenido funcional esperado:

- 2.2BZ: mapeo de identidades scoped para sesiones/entries/dashboard.
- 2.2CA: proteccion de estado visual scoped frente a refrescos legacy tardios.
- Documentacion de diagnostico y validacion.

## 7. Confirmacion supabase/.temp

`supabase/.temp/` no aparece en el diff contra `main`.

Estado local actual:

```text
?? supabase/.temp/
```

Debe permanecer untracked y no incluido en ningun commit/merge.

## 8. Confirmacion SQL nuevo/no SQL nuevo

Comando local:

```text
git diff --name-only main...validation/2-2bx-preview-qa | rg -n "^supabase/migrations|\.sql$"
```

Resultado:

```text
sin coincidencias
```

Conclusion:

- No hay migraciones nuevas en esta rama de validacion.
- No hay SQL nuevo pendiente de aplicar por 2.2CC.
- No se debe ejecutar SQL QA ni SQL Production en esta fase.

## 9. Confirmacion Vercel/no cambios Vercel

Comando local:

```text
git diff --name-only main...validation/2-2bx-preview-qa | rg -n "vercel|\.vercel|Vercel"
```

Resultado:

```text
sin coincidencias
```

Consulta read-only Vercel:

Preview de la rama `validation/2-2bx-preview-qa`:

```text
deployment_id: dpl_7SVhGpsx5skBbnZmqrC4NAsJtfBm
url: https://organizatech-qoiif4mhl-fanahuelhualg-8514s-projects.vercel.app
state: READY
target: null / Preview
commit: ebdcababce8f3fac1e48cb5d671d654adce12c05
```

Deployment Production visible:

```text
deployment_id: dpl_E73Lz6XBjRTmWeHU6ovrR21Nv6Zu
state: READY
target: production
branch: main
commit: 28fba178439becf027bfa541b5365acd6c0b57df
```

Conclusion:

- No hay archivos Vercel modificados en el diff.
- No se modificaron variables Vercel.
- No hubo redeploy Production manual en esta fase.
- El eventual merge a `main` puede gatillar deployment Production automatico y debe tratarse como gate de riesgo.

## 10. Production y Training Cycles Production

Estado documental:

- Production se mantiene estable segun smoke test previo y consulta read-only de deployments.
- Training Cycles Production debe seguir apagado.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` Production debe seguir OFF/no configurada.
- No se debe activar feature flag productiva durante merge.

Antes de cualquier merge se debe confirmar visualmente/read-only:

- No existe `ENABLE_TRAINING_CYCLES_REPOSITORY` en Production.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta disponible para Production ni All Environments.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta disponible para Production ni All Environments.

## 11. Riesgos

- Merge a `main` puede generar deployment automatico Production.
- Feature flag Production debe seguir OFF/no activada.
- Training Cycles Production no debe quedar expuesto tras merge.
- El patch SQL Production `plan_snapshot.source` debe tratarse en fase separada si aun no esta aplicado.
- Activacion funcional productiva debe quedar en fase posterior separada.
- Production debe validarse con smoke test post-merge.
- La rama incluye commits de validacion Preview QA; el commit vacio no cambia codigo, pero aparecera en historial si se mergea por merge commit.

## 12. Checklist previo al merge

Antes de autorizar merge:

1. Confirmar rama origen `validation/2-2bx-preview-qa`.
2. Confirmar base `main`.
3. Confirmar diff esperado:
   - `src/components/organizatech-app.tsx`.
   - `src/lib/progress/types.ts`.
   - `src/lib/training/cycle-scoped-training-repository.ts`.
   - documentos 2.2BZ y 2.2CA.
4. Confirmar que `supabase/.temp/` no aparece.
5. Confirmar que no hay `.env`, `.local`, `.secret`.
6. Confirmar que no hay SQL/migraciones nuevas.
7. Confirmar que no hay cambios Vercel.
8. Confirmar Preview QA READY del commit `ebdcababce8f3fac1e48cb5d671d654adce12c05`.
9. Confirmar validacion manual Ciclo 7 aprobada.
10. Confirmar Production estable antes de merge.
11. Confirmar feature flag Production OFF/no configurada.
12. Confirmar que Training Cycles Production sigue apagado.
13. Confirmar autorizacion explicita de Arquitectura para merge.

## 13. Checklist post-merge

Despues de un merge autorizado:

1. Confirmar commit de merge en `main`.
2. Confirmar deployment Vercel Production automatico esperado.
3. Confirmar deployment Production READY.
4. Ejecutar smoke test Production.
5. Confirmar app productiva carga.
6. Confirmar login productivo.
7. Confirmar Training legacy operativo.
8. Confirmar `/qa/training-cycles` bloqueado en Production.
9. Confirmar Training Cycles Production no expuesto.
10. Confirmar cero llamadas cycle-scoped productivas si flag sigue OFF.
11. Confirmar que no se crearon ciclos productivos.
12. Confirmar que no se toco Ciclo 1.
13. Confirmar que no hubo SQL Production.
14. Confirmar que no hubo `db push` ni `migration repair`.

## 14. Rollback

Rollback frontend si merge genera regresion:

- Revertir el merge commit o revertir los commits:
  - `ebdcaba`.
  - `5fd1410`.
- Mantener feature flag Production OFF durante rollback.
- No tocar SQL ni datos.

Rollback operacional:

- Si Production deployment falla, usar rollback Vercel autorizado en fase separada.
- Si Training legacy se afecta, bloquear activacion Training Cycles y ejecutar diagnostico inmediato.
- No editar/borrar datos productivos manualmente.

## 15. Restricciones vigentes

No autorizado en 2.2CC:

- Merge a `main`.
- SQL QA.
- SQL Production.
- Activar Training Cycles Production.
- Activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Crear/modificar variables Vercel.
- Redeploy Production manual.
- Crear ciclos productivos.
- Crear mas ciclos QA.
- Backfill.
- Tocar Ciclo 1.
- Tocar datos productivos.
- `db push`.
- `migration repair`.

## 16. Decision solicitada a Arquitectura

Solicitar a Arquitectura decidir:

```text
A) Autorizar merge controlado de validation/2-2bx-preview-qa hacia main.
B) Solicitar auditoria adicional antes del merge.
C) Mantener rama validation pendiente.
```

Recomendacion tecnica: opcion A es viable solo si se confirma nuevamente feature flag Production OFF/no configurada y se aprueba smoke test Production post-merge. La activacion funcional productiva y cualquier SQL adicional deben permanecer en fases separadas.
