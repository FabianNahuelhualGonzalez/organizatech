# Fase 2.2D - QA RLS de training_cycles desde cliente autenticado

## Objetivo

Validar en Supabase QA que `public.training_cycles` funciona desde cliente autenticado, respeta RLS y no mezcla ciclos entre usuarios.

Esta guia no autoriza ejecucion en Produccion.

## Alcance

- QA solamente.
- Cliente autenticado con anon key y sesion real.
- Sin service role.
- Sin SQL manual.
- Sin IDs, emails ni usuarios hardcodeados.
- Sin tocar `training_sessions`.
- Sin tocar `exercise_entries`.
- Sin conectar todavia la UI principal.

## Precondiciones

- Preview o Development apuntan a Supabase QA.
- `public.training_cycles` existe en QA.
- RLS esta habilitada.
- Policies select/insert/update estan activas.
- No existe policy de delete para `authenticated`.
- El unique partial index permite solo un ciclo `active` por usuario.
- Hay dos usuarios QA disponibles creados desde Auth normal.

## Checklist Usuario A

1. Iniciar sesion como Usuario A.
2. Crear un ciclo activo usando el repository de ciclos desde un flujo autenticado controlado.
3. Confirmar que `getActiveTrainingCycle()` retorna 1 ciclo.
4. Confirmar que `getTrainingCycleHistory()` no muestra ciclos activos.
5. Intentar crear un segundo ciclo activo para Usuario A.
6. Confirmar error claro: ya existe un ciclo activo para este usuario.
7. Completar el ciclo activo con `completeTrainingCycle()`.
8. Confirmar que `getActiveTrainingCycle()` retorna `null`.
9. Confirmar que `getTrainingCycleHistory()` muestra el ciclo completado.
10. Confirmar que `updated_at` cambio despues del update.

## Checklist Usuario B

1. Cerrar sesion de Usuario A.
2. Iniciar sesion como Usuario B.
3. Confirmar que `getActiveTrainingCycle()` no muestra ciclos de Usuario A.
4. Confirmar que `getTrainingCycleHistory()` no muestra ciclos de Usuario A.
5. Crear un ciclo activo de Usuario B.
6. Confirmar que Usuario B ve solo su ciclo.
7. Confirmar que Usuario A no ve ciclos de Usuario B al volver a iniciar sesion.

## Validaciones RLS esperadas

- Usuario autenticado ve solo filas donde `user_id = auth.uid()`.
- Usuario autenticado inserta solo filas propias.
- Usuario autenticado actualiza solo filas propias.
- Usuario autenticado no puede hacer delete fisico desde frontend.
- Usuario sin sesion recibe error de sesion requerida.
- Usuario con sesion expirada recibe error de sesion expirada.

## Validaciones de integridad

- No se permiten dos ciclos `active` para el mismo usuario.
- Completar ciclo setea `status = completed`.
- Cancelar ciclo setea `status = cancelled`.
- Completar o cancelar ciclo setea `ended_at`.
- Completar o cancelar ciclo conserva `plan_snapshot`.
- Completar ciclo guarda `summary_snapshot`.
- Las operaciones no escriben en `training_sessions`.
- Las operaciones no escriben en `exercise_entries`.

## Evidencia a guardar

- Usuario A: ciclo activo creado, intento duplicado rechazado, ciclo completado visible en historial.
- Usuario B: ciclo propio creado, ciclos de Usuario A no visibles.
- Confirmacion de que no existe delete fisico desde frontend.
- Confirmacion de que `updated_at` cambia al actualizar.
- Capturas o logs anonimizados sin emails, user_id ni UUIDs reales.

## Criterios de aprobacion

- Usuario A y Usuario B no comparten datos.
- El unique partial index bloquea el segundo ciclo activo.
- RLS bloquea acceso cruzado.
- Historial completed/cancelled persiste tras logout/login.
- No se tocaron tablas de entrenamientos ni detalle de ejercicios.

## Criterios de rechazo

- Usuario B puede ver ciclos de Usuario A.
- Se crea mas de un ciclo activo para el mismo usuario.
- Se puede eliminar fisicamente desde frontend.
- Un usuario sin sesion puede leer o crear ciclos.
- Se modifica `training_sessions` o `exercise_entries`.
