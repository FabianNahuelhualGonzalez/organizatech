# Fase 2.2B - Diseno de ciclos Training en Supabase

## 1. Contexto

Training ya usa Supabase para autenticacion, rutinas, ejercicios y entrenamientos. Despues de Fase 2, `training_sessions` representa una sesion real diaria y `exercise_entries` representa el detalle de ejercicios. Fase 2.1H completo la consolidacion productiva legacy y el fallback legacy debe mantenerse activo.

El bug actual ocurre en Produccion al ejecutar:

```text
Training -> Ciclo activo -> Crear nuevo ciclo de entrenamiento -> Confirmar "Si"
```

Resultado observado:

- El modal abre correctamente.
- Al confirmar, no se finaliza el ciclo.
- No aparece nada en "Ciclos finalizados".
- El historial queda en 0.

Diagnostico confirmado:

```ts
if (dataMode === "supabase") {
  setStatusMessage("Esta accion estara disponible en el siguiente paso.");
  setIsNewCycleConfirmOpen(false);
  return;
}
```

Ese bloqueo existe en `startNewTrainingCycle()` porque los ciclos aun no tienen persistencia real en Supabase.

Actualmente:

- `training_cycles` no existe.
- `cycleHistory` vive en localStorage.
- `trainingPlan` vive en localStorage.
- En modo Supabase, ciclos e historial no estan persistidos por usuario.

localStorage no es suficiente para ciclos reales porque no sobrevive a limpieza del navegador, no sincroniza dispositivos, no es una fuente multiusuario segura y puede mezclar estado local en navegadores compartidos.

## 2. Decision arquitectonica

- Crear tabla `public.training_cycles`.
- Usar snapshots JSON para MVP.
- No modificar `training_sessions` ni `exercise_entries` en esta fase.
- No agregar `cycle_id` a `training_sessions` todavia.
- Asociar todos los ciclos a `user_id`.
- Mantener RLS estricta.
- Mantener fallback legacy activo.
- Mantener localStorage solo para modo demo y drafts temporales.

Para MVP, el ciclo sera una entidad de historial y planificacion de alto nivel. No intentara reescribir ni reclasificar sesiones ya consolidadas.

## 3. Diseno propuesto de tabla

SQL conceptual, no ejecutar en esta fase:

```sql
create table public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cycle_number integer not null check (cycle_number > 0),
  cycle_type text null,
  goal text null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

Indices recomendados:

```sql
create index training_cycles_user_status_idx
  on public.training_cycles(user_id, status);

create index training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at);

create index training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at);
```

Constraint recomendada para impedir doble ciclo activo por usuario:

```sql
create unique index training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null;
```

Esta constraint es importante porque el flujo "crear nuevo ciclo" debe cerrar el ciclo activo anterior antes de crear el siguiente.

## 4. RLS

RLS debe quedar habilitada:

```sql
alter table public.training_cycles enable row level security;
```

Politicas propuestas:

- Select own cycles: `auth.uid() = user_id`.
- Insert own cycles: `auth.uid() = user_id`.
- Update own cycles: `auth.uid() = user_id`.
- No delete fisico desde frontend.

Conceptualmente:

```sql
create policy "training cycles select own rows"
on public.training_cycles
for select
using (auth.uid() = user_id);

create policy "training cycles insert own rows"
on public.training_cycles
for insert
with check (auth.uid() = user_id);

create policy "training cycles update own rows"
on public.training_cycles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

No se recomienda policy de delete para `authenticated`. Si se requiere eliminar, usar `deleted_at` desde una operacion controlada.

## 5. Repository

Funciones propuestas:

- `fetchTrainingCycles(userId)`
  - Lee ciclos del usuario autenticado.
  - Filtra `deleted_at is null`.
  - Ordena por `cycle_number` o `created_at`.

- `fetchActiveTrainingCycle(userId)`
  - Lee el ciclo `status = 'active'`.
  - Debe retornar 0 o 1 por unique partial index.

- `createActiveTrainingCycle(input)`
  - Crea nuevo ciclo activo.
  - Requiere `user_id` desde auth.
  - Guarda `plan_snapshot`.
  - No crea sesiones.

- `finishActiveTrainingCycle(input)`
  - Marca el ciclo activo como `completed`.
  - Setea `ended_at`.
  - Guarda `summary_snapshot`.
  - No toca `training_sessions` ni `exercise_entries`.

- `startNewTrainingCycle()`
  - En modo demo: conserva comportamiento local actual.
  - En modo Supabase: llama a repository para finalizar ciclo activo y crear nuevo ciclo activo.

- `getCycleHistory()`
  - En modo demo: lee localStorage.
  - En modo Supabase: lee `training_cycles` desde DB.

Convivencia demo/Supabase:

- `RepositoryMode = "demo"` mantiene localStorage.
- `RepositoryMode = "supabase"` usa tabla `training_cycles`.
- No mezclar historial local con historial real.

## 6. UI

Cambios necesarios:

- `startNewTrainingCycle`
  - Quitar bloqueo de Supabase solo despues de tener tabla y repository.
  - Mostrar loading durante cierre/creacion.
  - Cerrar modal solo cuando la operacion termina correctamente.
  - En error, mantener feedback visible.

- Pantalla Ciclo activo
  - Mostrar ciclo activo desde DB en modo Supabase.
  - Mantener estado local solo como fallback demo.

- Pantalla Ciclos finalizados
  - En modo Supabase, renderizar ciclos `completed` desde DB.
  - En modo demo, renderizar `cycleHistory` local.

- Modal de confirmacion
  - Confirmar que cerrar ciclo actual crea snapshot.
  - Indicar que no se borran entrenamientos.

- Mensajes de error/loading
  - "Finalizando ciclo..."
  - "Nuevo ciclo creado."
  - "No pudimos finalizar el ciclo. Intenta nuevamente."

- Refresh
  - Despues de guardar, refrescar ciclos y datos visibles.
  - No depender de reload.

## 7. Summary snapshot

Al cerrar un ciclo, `summary_snapshot` debe guardar un resumen estable para historial:

- Volumen registrado.
- Reps registradas.
- Cantidad de semanas.
- Dias entrenados.
- Ejercicios registrados.
- Sesiones registradas.
- Fecha inicio.
- Fecha termino.
- Objetivo del ciclo.
- Tipo de ciclo.
- Estado de animo/motivacion si existe en el flujo.
- Puntos a mejorar futuro.

Ejemplo conceptual:

```json
{
  "volumeTotal": 42941,
  "totalReps": 1157,
  "weekCount": 4,
  "trainingDays": ["Lunes", "Miercoles"],
  "exerciseCount": 12,
  "sessionCount": 5,
  "startedAt": "2026-05-01T00:00:00.000Z",
  "endedAt": "2026-05-31T00:00:00.000Z",
  "goal": "Hipertrofia",
  "notes": []
}
```

El snapshot evita recalcular historiales antiguos si luego cambia la logica de calculo.

## 8. Migracion desde localStorage

Estrategia recomendada:

- No migrar automaticamente historial local a Supabase en esta fase.
- Mantener localStorage solo para modo demo.
- En modo Supabase, leer ciclos desde DB.
- Si un usuario tenia historial local, no asumir que pertenece al usuario autenticado.
- Opcional futuro: importacion manual con confirmacion explicita del usuario.

Esto evita mezclar datos locales ambiguos con datos reales multiusuario.

## 9. Seguridad multiusuario

Reglas:

- Todos los ciclos deben tener `user_id`.
- RLS obligatoria.
- `auth.uid()` debe controlar select/insert/update.
- No usar localStorage global para historial real.
- No hardcodear usuarios, emails ni IDs.
- Usuario A no puede ver ni modificar ciclos de usuario B.
- El frontend no debe recibir ni enviar `user_id` confiable como fuente de seguridad; la DB/RLS debe validarlo.

QA multiusuario obligatorio:

- Usuario A crea y finaliza ciclo.
- Usuario B no ve ciclos de A.
- Usuario B no puede modificar ciclos de A.
- Navegador compartido no mezcla historial real.

## 10. QA

Plan de pruebas:

- Usuario A crea ciclo activo.
- Usuario A finaliza ciclo.
- Usuario A ve ciclo en "Ciclos finalizados".
- Usuario A conserva historial tras reload.
- Usuario A conserva historial tras logout/login.
- Usuario A conserva historial en otro dispositivo.
- Usuario B no ve ciclos de A.
- Finalizar ciclo crea `summary_snapshot`.
- Crear nuevo ciclo deja exactamente un ciclo `active`.
- No se crean dos ciclos activos para el mismo usuario.
- Intentar doble click en confirmacion no duplica ciclos.
- Modo demo conserva comportamiento local.
- Produccion con usuario real mantiene entrenamientos existentes.
- Fallback legacy de Training sigue activo.

Rollback de migracion, cuando exista:

- La migracion debe ser aditiva.
- Si falla QA, se puede dejar la tabla sin uso.
- No tocar `training_sessions` ni `exercise_entries`.

## 11. Plan por fases

- 2.2B: diseno tecnico.
- 2.2C: migracion QA para `training_cycles`.
- 2.2D: repository de ciclos.
- 2.2E: UI de cerrar/crear ciclo en modo Supabase.
- 2.2F: QA multiusuario y regresion Training.
- 2.2G: produccion con ventana controlada.

## 12. Riesgos

- Snapshots pueden quedar desactualizados si cambia la logica de resumen.
- Riesgo de doble ciclo activo si no existe unique partial index.
- Historial local legacy puede confundirse con historial real si se migra automaticamente.
- RLS mal configurada puede exponer ciclos entre usuarios.
- Diferencias demo vs Supabase pueden generar bugs si el flujo diverge demasiado.
- No tener relacion directa con `training_sessions` limita analisis por ciclo.
- Cierre de ciclo incompleto puede dejar UI en estado inconsistente.
- Doble click o reintentos pueden duplicar operaciones si no se bloquea loading.

## 13. Recomendacion final

Se recomienda avanzar a una migracion QA aditiva para crear `public.training_cycles` con RLS, indices y unique partial index de un ciclo activo por usuario.

No se recomienda quitar el bloqueo de `startNewTrainingCycle()` hasta tener:

- Tabla creada en QA.
- Repository implementado.
- QA multiusuario aprobado.
- Validacion de que no se toca `training_sessions` ni `exercise_entries`.
- Plan de produccion aprobado.
