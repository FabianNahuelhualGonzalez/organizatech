# Fase 2.2R - Preparacion de habilitacion UI Training Cycles

## 1. Contexto

La Fase 2.2P fue ejecutada correctamente mediante el script aislado aprobado:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

La Fase 2.2Q fue cerrada y aprobada por Arquitectura como reconciliacion post-ejecucion del historial de migraciones.

Estado actual confirmado:

- `public.training_cycles` existe en Produccion.
- `public.training_cycles` esta vacia.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF / no activa.
- Vercel no fue tocado.
- UI productiva sigue bloqueada.
- Fallback legacy sigue activo.
- Helper QA sigue disponible y no fue eliminado.
- `training_sessions` permanece intacta.
- `exercise_entries` permanece intacta.

Esta fase es solo preparacion. No habilita la UI productiva y no autoriza cambios remotos.

## 2. Objetivo de 2.2R

Preparar la habilitacion controlada de la UI Training Cycles en Produccion, sin ejecutarla todavia.

El objetivo es dejar definido el plan tecnico, operativo, UX, rollback y evidencia requerida para solicitar una fase posterior:

```text
Fase 2.2S - Habilitacion controlada de UI Training Cycles en Produccion
```

## 3. Alcance autorizado

Alcance permitido en esta fase:

- Revision local de codigo.
- Revision de gating y feature flag.
- Identificacion de variables necesarias.
- Plan de habilitacion.
- Plan de rollback.
- Plan de postchecks.
- Criterios de aborto.
- Evidencia requerida.
- Documentacion del estado actual.

## 4. No autorizado

Acciones no autorizadas:

- Activar feature flag.
- Cambiar variables en Vercel.
- Hacer redeploy.
- Ejecutar SQL.
- Tocar Supabase remoto.
- Ejecutar `supabase db push`.
- Ejecutar `supabase migration repair`.
- Crear ciclos productivos.
- Exponer funcionalidad a usuarios productivos.
- Modificar base de datos.
- Modificar `training_sessions`.
- Modificar `exercise_entries`.
- Modificar codigo funcional en esta fase.

## 5. Revision tecnica local

Archivos revisados en modo lectura local:

- `src/app/page.tsx`
- `src/components/organizatech-app.tsx`
- `src/lib/training/training-cycles-repository.ts`
- `src/app/qa/training-cycles/page.tsx`
- `src/app/qa/training-cycles/training-cycles-qa-client.tsx`

### 5.1 Gating actual en `src/app/page.tsx`

El flag que recibe `OrganizatechApp` se calcula del lado servidor:

```ts
const trainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";
```

Luego se pasa como prop booleana:

```tsx
<OrganizatechApp trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled} />
```

Hallazgo:

- Produccion permanece bloqueada porque `VERCEL_ENV === "preview"` es obligatorio.
- `OrganizatechApp` no lee `VERCEL_ENV` directamente.
- El gating productivo separado `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` no esta conectado todavia en `src/app/page.tsx`.
- Para una futura 2.2S se requiere un cambio de codigo aprobado que agregue gating productivo separado, sin reutilizar `NEXT_PUBLIC_ENABLE_QA_TOOLS`.

### 5.2 Activacion interna en `OrganizatechApp`

`OrganizatechApp` recibe:

```ts
trainingCyclesRepositoryEnabled?: boolean
```

La activacion real del repository depende de tres condiciones:

```ts
const isTrainingCyclesRepositoryActive =
  trainingCyclesRepositoryEnabled &&
  dataMode === "supabase" &&
  hasSupabaseSession;
```

Hallazgo:

- Aunque el flag servidor estuviera activo, el repository solo opera en modo Supabase y con sesion valida.
- En demo/local sigue funcionando el fallback legacy.
- En Produccion actual, el flag servidor llega `false`, por lo tanto el repository no se activa.

### 5.3 Comportamiento de `startNewTrainingCycle()`

Cuando `dataMode === "supabase"` y el repository no esta activo:

```text
Esta accion estara disponible en el siguiente paso.
```

El flujo se cierra sin crear ciclo.

Cuando el repository esta activo:

- Busca ciclo activo con `getActiveTrainingCycle()`.
- Completa ciclo activo con `completeTrainingCycle()` si existe.
- Crea nuevo ciclo con `createTrainingCycle()`.
- Refresca estado con `refreshPersistedTrainingCycles()`.
- No pasa `user_id` desde UI.
- Usa el repository como fuente de verdad de ciclos.

Hallazgo:

- El bloqueo productivo actual depende de `trainingCyclesRepositoryEnabled=false`.
- El fallback legacy local permanece disponible cuando no se usa Supabase.
- El modo Supabase no habilitado mantiene bloqueo controlado, no fallback silencioso a escritura local.

### 5.4 UI conectada al repository

Cuando `isTrainingCyclesRepositoryActive` esta activo:

- El ciclo activo visible proviene del repository.
- El historial visible proviene de `getTrainingCycleHistory()`.
- `deleteCurrentTrainingCycle()` usa `cancelTrainingCycle()`.
- `startNewTrainingCycle()` usa `completeTrainingCycle()` y `createTrainingCycle()`.

Cuando no esta activo:

- Se mantiene el historial legacy/local.
- Se mantiene el fallback existente fuera de Supabase.
- Produccion actual sigue bloqueada en modo Supabase.

### 5.5 Artefactos QA que deben corregirse antes de 2.2S

La revision local detecta artefactos de QA dentro del flujo real del repository que hoy no se exponen en Produccion porque `isTrainingCyclesRepositoryActive` permanece bloqueado.

Requisitos obligatorios para 2.2S:

1. Corregir mensajes visibles al usuario que hoy contienen etiqueta QA en `startNewTrainingCycle()` y `deleteCurrentTrainingCycle()`.

   Mensajes a revisar antes de habilitar Produccion:

   ```text
   Ciclo actual finalizado y nuevo ciclo creado en QA.
   Nuevo ciclo creado en QA. No existia un ciclo activo previo.
   Ciclo cancelado en QA. Ya puedes configurar un nuevo ciclo de entrenamiento.
   ```

   Estos mensajes deben reemplazarse por textos aptos para usuarios productivos antes de activar la UI productiva.

2. Reemplazar el `source` hardcodeado:

   ```text
   ui-main-qa-preview
   ```

   Este valor se usa al crear `plan_snapshot` mediante `createPersistedCyclePlanSnapshot(nextPlan, [], "ui-main-qa-preview")`. Si se habilita Produccion sin corregirlo, ciclos productivos reales podrian persistir metadata incorrecta en `public.training_cycles.plan_snapshot`.

   Para 2.2S se debe definir una etiqueta apta para Produccion o una fuente dinamica segun ambiente, por ejemplo separando claramente QA/Preview de Produccion.

Condicion de bloqueo:

```text
No activar NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY hasta que estos artefactos QA esten corregidos, auditados y aprobados.
```

Esta fase 2.2R solo documenta el hallazgo. No modifica codigo funcional.

### 5.6 Helper QA

El helper QA sigue separado en:

- `src/app/qa/training-cycles/page.tsx`
- `src/app/qa/training-cycles/training-cycles-qa-client.tsx`

Su gating mantiene el patron Preview/QA:

```text
VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Hallazgo:

- El helper QA no fue eliminado.
- No debe quedar accesible en Produccion.
- No debe reutilizarse `NEXT_PUBLIC_ENABLE_QA_TOOLS` como flag productiva.

## 6. Feature flag productiva

Variable productiva propuesta:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY
```

Estado actual esperado:

```text
false / no definida / no activa
```

Valor requerido para habilitar en una futura 2.2S:

```text
true
```

Hallazgo importante:

- La variable productiva propuesta aun no esta conectada al codigo actual.
- La UI productiva sigue bloqueada por el gating actual Preview/QA.
- La futura habilitacion productiva requiere una fase separada que modifique el gating en `src/app/page.tsx`.
- Antes de activar Produccion, 2.2S debe corregir los mensajes con etiqueta QA y el `source` `ui-main-qa-preview`.

Condicion segura propuesta para 2.2S:

```text
VERCEL_ENV === "production"
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

Esta condicion debe convivir con el gating QA actual sin mezclar:

```text
VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Decision pendiente para 2.2S:

- Evaluar si la feature flag productiva debe mantener el prefijo `NEXT_PUBLIC_` o si conviene usar una variable solo server-side, dado que el gating se calcula en `src/app/page.tsx`.
- Esta no es una decision tomada en 2.2R.
- Si se mantiene `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`, documentar por que es aceptable exponer solo el boolean publico.
- Si se cambia a una variable server-side, definir nombre final, impacto en Vercel y evidencia requerida.

Apagado:

- Cambiar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Redeploy si corresponde.
- Confirmar que `trainingCyclesRepositoryEnabled=false` en Produccion.

Impacto esperado al activarla en una fase futura:

- UI productiva Supabase podra usar `training_cycles`.
- Crear/finalizar/cancelar ciclos reales escribira en `public.training_cycles`.
- `training_sessions` y `exercise_entries` no deberian modificarse por el flujo de ciclos.
- El fallback legacy debe seguir disponible si el flag se apaga.

## 7. Vercel

Estado actual:

- Vercel no fue tocado.
- No se modificaron variables.
- No hubo redeploy.
- Feature flag productiva sigue OFF / no activa.

Para una futura 2.2S se debe documentar y confirmar:

- Variable exacta en Vercel Production:
  `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Valor previo:
  `false` / no definida / no activa.
- Valor de habilitacion:
  `true`.
- Si el cambio requiere redeploy para que Next.js incorpore la variable.
- Evidencia visual previa y posterior de variables, sin exponer secretos.

Rollback en Vercel:

- Volver la variable a `false`.
- Redeploy si aplica.
- Confirmar UI productiva bloqueada.
- Confirmar fallback legacy operativo.
- Si ya existieran ciclos productivos en `public.training_cycles`, quedarian inaccesibles desde la UI mientras la flag este OFF, pero no se borrarian ni se modificarian en base de datos.

## 8. UX y producto

Flujo esperado en habilitacion productiva futura:

1. Usuario productivo autenticado entra en modo Supabase.
2. Usuario ve ciclo activo desde `training_cycles`.
3. Usuario cierra ciclo actual o microciclo de descarga desde UI real.
4. UI finaliza el ciclo activo con snapshot.
5. UI crea nuevo microciclo/ciclo.
6. Usuario registra la semana siguiente normalmente.
7. Historial se mantiene desde `training_cycles`.
8. Reload mantiene estado.
9. Usuario solo ve sus propios ciclos por RLS.

Fallback y errores esperados:

- Si falla creacion de ciclo, mostrar mensaje claro en espanol.
- Si hay `active_cycle_exists`, no crear segundo ciclo activo.
- Si hay `active_cycle_missing`, indicar que no existe ciclo activo para completar/cancelar.
- Si hay `session_required` o `session_expired`, pedir iniciar sesion nuevamente.
- Si hay `permission_denied`, bloquear accion e informar.
- Si hay error inesperado, mantener estado previo y pedir reintento.

Protecciones de producto:

- No perder sesiones existentes.
- No escribir en `training_sessions`.
- No escribir en `exercise_entries`.
- No borrar datos de ciclos ante rollback.
- Mantener UI mobile compacta y sin saturacion.

## 9. Validacion funcional real propuesta para 2.2S

Postchecks funcionales propuestos:

- Confirmar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo en Production y solo durante la ventana aprobada.
- Confirmar que el usuario productivo correcto puede iniciar nuevo ciclo.
- Confirmar que el ciclo se registra en `public.training_cycles`.
- Confirmar que `public.training_cycles` mantiene RLS.
- Confirmar que usuario B no ve ciclos de usuario A.
- Confirmar que no se alteran `training_sessions` ni `exercise_entries`.
- Confirmar que historial de ciclos se mantiene tras reload.
- Confirmar que el ciclo activo se mantiene tras reload.
- Confirmar comportamiento mobile.
- Confirmar que helper QA no queda accesible en Produccion.
- Confirmar logs sin errores RLS inesperados.

Baselines a capturar antes y despues:

```text
training_sessions total / active / soft_deleted
exercise_entries total / distinct_session_count
training_cycles total / por usuario validado
```

## 10. Rollback

Rollback funcional/UI:

1. Apagar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`.
2. Redeploy si aplica.
3. Confirmar que `trainingCyclesRepositoryEnabled=false` en Produccion.
4. Volver a fallback legacy / bloqueo productivo anterior.
5. No eliminar `public.training_cycles`.
6. No borrar datos de ciclos generados.
7. No tocar `training_sessions`.
8. No tocar `exercise_entries`.
9. No tocar historial CLI.
10. Asumir que los ciclos productivos existentes no seran visibles desde la UI mientras la flag este OFF, pero permaneceran intactos en base de datos.

Rollback DB:

- No esta autorizado en 2.2R.
- No ejecutar `DROP`.
- No eliminar datos.
- Si se requiere reversa DB, debe prepararse en una fase separada con aprobacion explicita.

## 11. Criterios de aborto

Abortar habilitacion futura si:

- Feature flag productiva no esta identificada con claridad.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` no esta conectada al codigo.
- No se corrigieron los mensajes visibles con etiqueta QA.
- No se reemplazo el `source` hardcodeado `ui-main-qa-preview`.
- Vercel env no es confirmable.
- Fallback legacy no esta confirmado.
- UI productiva depende de `NEXT_PUBLIC_ENABLE_QA_TOOLS`.
- Produccion no puede aislarse de QA/Preview.
- Hay riesgo de mezclar usuarios.
- Aparece error de RLS.
- Aparece error en creacion de ciclo.
- Aparece error en finalizacion/cancelacion de ciclo.
- Hay duda de ambiente.
- Helper QA queda accesible en Produccion.
- Se detecta escritura inesperada en `training_sessions`.
- Se detecta escritura inesperada en `exercise_entries`.

## 12. Evidencia requerida antes de solicitar ejecucion 2.2S

Evidencia requerida:

- Codigo revisado.
- Gating confirmado.
- Variable exacta confirmada.
- Mensajes visibles con etiqueta QA corregidos y auditados.
- `source` de `plan_snapshot` apto para Produccion o dinamico por ambiente.
- Fallback legacy confirmado.
- Plan de Vercel confirmado.
- Plan de redeploy confirmado si aplica.
- Rollback confirmado.
- Postchecks definidos.
- Impacto de usuario entendido.
- Baseline de `training_sessions`.
- Baseline de `exercise_entries`.
- Estado de `training_cycles`.
- Confirmacion de `public.training_cycles` vacia o filas documentadas.
- Confirmacion de RLS y policies.
- Confirmacion de helper QA bloqueado en Produccion.
- Aprobacion explicita de Arquitectura para ejecutar 2.2S.

## 13. Recomendacion TI preliminar

Recomendacion:

```text
No solicitar ejecucion 2.2S hasta preparar un cambio de codigo especifico que conecte NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY en page.tsx con gating productivo separado.
```

Propuesta tecnica para fase futura:

- Mantener gating QA/Preview existente sin cambios.
- Agregar gating productivo separado.
- Evaluar si la feature flag productiva debe ser publica (`NEXT_PUBLIC_`) o server-side.
- No reutilizar `NEXT_PUBLIC_ENABLE_QA_TOOLS` para Produccion.
- Mantener `trainingCyclesRepositoryEnabled` como prop booleana hacia `OrganizatechApp`.
- Mantener `OrganizatechApp` sin lectura directa de `VERCEL_ENV`.
- Corregir mensajes de status que hoy dicen "en QA" antes de exponerlos a usuarios productivos.
- Reemplazar `ui-main-qa-preview` por un `source` apto para Produccion o dinamico por ambiente antes de persistir ciclos reales.
- Mantener fallback legacy.
- Mantener helper QA bloqueado en Produccion.
- Ejecutar habilitacion productiva solo con aprobacion explicita de Arquitectura.

## 14. Proximo paso sugerido

Solicitar a Arquitectura aprobacion para una fase posterior:

```text
Fase 2.2S - Habilitacion controlada de UI Training Cycles en Produccion
```

La solicitud 2.2S debe separar claramente:

- Cambio de codigo para gating productivo.
- Configuracion Vercel.
- Redeploy.
- Ventana funcional productiva.
- Postchecks.
- Rollback.

Este documento no autoriza activar feature flag, tocar Vercel, hacer redeploy, ejecutar SQL, tocar Supabase remoto ni exponer Training Cycles a usuarios productivos.
