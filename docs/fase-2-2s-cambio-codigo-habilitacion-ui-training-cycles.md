# Fase 2.2S - Cambio de codigo para habilitacion UI Training Cycles

## 1. Contexto

Arquitectura aprobo el cierre formal de Fase 2.2R.

Estado confirmado antes de esta fase:

- Produccion sigue bloqueada.
- Feature flag productiva sigue OFF.
- Vercel no fue tocado.
- `public.training_cycles` existe en Produccion y esta vacia.
- `training_sessions` permanece intacta.
- `exercise_entries` permanece intacta.
- Fallback legacy sigue activo.
- Helper QA sigue preservado.

La Fase 2.2S prepara un cambio de codigo controlado para que una futura habilitacion productiva sea posible, segura y auditable. Esta fase no activa la funcionalidad en Produccion.

## 2. Alcance autorizado

Alcance autorizado:

- Conectar gating productivo a feature flag.
- Evaluar `NEXT_PUBLIC_` vs variable server-side.
- Eliminar textos visibles con etiqueta "en QA" en flujo principal.
- Reemplazar `ui-main-qa-preview` como source de ciclos reales.
- Mantener fallback legacy.
- Mantener helper QA.
- Ejecutar validaciones locales.
- Preparar evidencia para auditoria Claude.

## 3. No autorizado

No autorizado en esta fase:

- Activar feature flag en Produccion.
- Tocar Vercel.
- Hacer redeploy productivo.
- Crear ciclos productivos.
- Exponer Training Cycles a usuarios finales.
- Ejecutar SQL.
- Tocar Supabase remoto.
- Ejecutar `supabase db push`.
- Ejecutar `supabase migration repair`.
- Modificar base de datos.
- Modificar `training_sessions`.
- Modificar `exercise_entries`.
- Hacer commit.
- Hacer push.
- Versionar `supabase/.temp/`.

## 4. Decision sobre feature flag

Decision tecnica:

```text
Usar variable server-side: ENABLE_TRAINING_CYCLES_REPOSITORY
```

Justificacion:

- El gating se calcula en `src/app/page.tsx`, que es Server Component.
- El cliente solo necesita recibir el boolean ya resuelto mediante `trainingCyclesRepositoryEnabled`.
- No es necesario exponer la feature flag en el bundle publico.
- Evita usar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` innecesariamente.
- Mantiene `OrganizatechApp` sin lectura directa de `VERCEL_ENV` ni variables de entorno.

Gating productivo conectado:

```text
VERCEL_ENV === "production"
ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

Gating QA/Preview preservado:

```text
VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Resultado:

- Produccion sigue bloqueada mientras `ENABLE_TRAINING_CYCLES_REPOSITORY` no exista o no sea `"true"`.
- QA/Preview mantiene su gating existente.
- No se mezcla QA con Produccion.

## 5. Cambios de codigo realizados

### `src/app/page.tsx`

Cambios:

- Se separo el gating QA/Preview en `qaTrainingCyclesRepositoryEnabled`.
- Se agrego gating productivo server-side en `productionTrainingCyclesRepositoryEnabled`.
- Se compone `trainingCyclesRepositoryEnabled` como QA o Produccion.
- Se calcula `trainingCyclesSnapshotSource` del lado servidor.
- Se pasa a `OrganizatechApp` solo el boolean de habilitacion y el source ya resuelto.

Sources definidos:

```text
Produccion habilitada: ui-main-production
QA/Preview: ui-main-qa
```

### `src/components/organizatech-app.tsx`

Cambios:

- Se agrego `OrganizatechAppProps`.
- Se agrego prop `trainingCyclesSnapshotSource`.
- Se tipo `trainingCyclesSnapshotSource` como `"ui-main-production" | "ui-main-qa"` segun recomendacion opcional Claude RO-01.
- `planSnapshot` usa el source recibido en vez de `ui-main-qa-preview`.
- `summarySnapshot` usa el source recibido en vez de `ui-main-qa-preview`.
- Se eliminaron mensajes visibles con "en QA".
- Se neutralizo el texto de historial persistido que mencionaba QA.

## 6. Archivos modificados

Archivos modificados:

```text
src/app/page.tsx
src/components/organizatech-app.tsx
docs/fase-2-2s-cambio-codigo-habilitacion-ui-training-cycles.md
```

Archivos revisados sin modificar:

```text
src/lib/training/training-cycles-repository.ts
src/app/qa/training-cycles/page.tsx
src/app/qa/training-cycles/training-cycles-qa-client.tsx
```

## 7. Artefactos QA corregidos

Mensajes corregidos:

```text
Ciclo actual finalizado y nuevo ciclo creado correctamente.
Nuevo ciclo creado correctamente. No existia un ciclo activo previo.
Ciclo cancelado. Ya puedes configurar un nuevo ciclo de entrenamiento.
```

Source corregido:

```text
Antes: ui-main-qa-preview
Ahora Produccion: ui-main-production
Ahora QA/Preview: ui-main-qa
```

Nota:

- `ui-main-qa-preview` ya no queda en `src/app/page.tsx` ni en `src/components/organizatech-app.tsx`.
- Si una futura fase requiere otro source, debe pasar por auditoria antes de activar Produccion.

## 8. Fallback legacy preservado

Fallback preservado:

- `trainingCyclesRepositoryEnabled=false` mantiene repository desactivado.
- Modo demo/local sigue usando `cycleHistory` local.
- Modo Supabase con repository desactivado mantiene bloqueo controlado.
- No se modifico la rama legacy de `startNewTrainingCycle()`.
- No se modifico `replaceLocalData`.
- No se modificaron `training_sessions` ni `exercise_entries`.

## 9. Helper QA preservado

Helper QA preservado:

- No se eliminaron archivos QA.
- No se modifico el helper QA.
- El gating QA/Preview sigue separado.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` sigue siendo exclusivo del flujo QA/Preview.
- Produccion no depende de `NEXT_PUBLIC_ENABLE_QA_TOOLS`.

## 10. Riesgos

Riesgos remanentes:

- Produccion seguira bloqueada hasta configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` y redeploy en una fase separada.
- Si se activa la flag sin ventana controlada, usuarios productivos podrian crear ciclos reales.
- El rollback UI ocultaria ciclos productivos desde la UI mientras la flag este OFF, pero no borraria datos.
- Se requiere auditoria Claude antes de solicitar activacion productiva.

## 11. Rollback

Rollback de codigo:

- Revertir cambios de `src/app/page.tsx`.
- Revertir cambios de `src/components/organizatech-app.tsx`.
- Mantener feature flag OFF.

Rollback funcional futuro:

- Apagar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Redeploy si aplica.
- Confirmar `trainingCyclesRepositoryEnabled=false`.
- Mantener `public.training_cycles`.
- No borrar datos de ciclos.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.

## 12. Validaciones ejecutadas

Validaciones requeridas para esta fase:

```text
npm run typecheck
npm test -- --run
npm run build
git diff --check
rg de mojibake sobre docs/fase-2-2s-cambio-codigo-habilitacion-ui-training-cycles.md src/app/page.tsx src/components/organizatech-app.tsx
rg -n "en QA|ui-main-qa-preview" src/components/organizatech-app.tsx src/app/page.tsx
```

Resultado:

```text
npm run typecheck: OK
npm test -- --run: OK
npm run build: OK en reintento fuera del sandbox. Primer intento local fallo con spawn EPERM durante next build.
git diff --check: OK
rg de mojibake en documento 2.2S, page.tsx y organizatech-app.tsx: sin coincidencias
rg "en QA|ui-main-qa-preview" en organizatech-app.tsx y page.tsx: sin coincidencias
```

## 13. Criterios de aborto para futura activacion productiva

Abortar futura activacion si:

- `ENABLE_TRAINING_CYCLES_REPOSITORY` no esta claramente configurada.
- Vercel Production no es confirmable.
- No hay aprobacion explicita de Arquitectura.
- No hay auditoria Claude aprobada.
- Aparecen textos "en QA" en flujo productivo.
- Aparece `ui-main-qa-preview` en flujo productivo.
- Helper QA queda accesible en Produccion.
- Fallback legacy no esta confirmado.
- RLS falla.
- El usuario productivo ve datos de otro usuario.
- Hay escritura inesperada en `training_sessions`.
- Hay escritura inesperada en `exercise_entries`.
- Hay duda de ambiente.

## 14. Proximo paso recomendado

Enviar este cambio a auditoria Claude.

Luego, si Claude aprueba, solicitar aprobacion de Arquitectura para una fase posterior que separe:

- Commit del cambio de codigo.
- Configuracion de Vercel.
- Redeploy.
- Activacion de feature flag.
- Postchecks productivos.
- Rollback funcional.

Este documento no autoriza activar feature flag, tocar Vercel, ejecutar SQL, tocar Supabase remoto ni exponer Training Cycles a usuarios productivos.
