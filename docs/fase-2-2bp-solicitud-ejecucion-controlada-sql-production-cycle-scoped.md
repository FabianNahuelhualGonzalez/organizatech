# Fase 2.2BP - Solicitud de ejecucion controlada SQL Production cycle-scoped

## 1. Resumen ejecutivo

La Fase 2.2BO fue cerrada y aprobada con la clasificacion:

```text
APTO PARA VENTANA SQL PRODUCTION
```

2.2BP prepara la solicitud formal para una futura ejecucion manual y
controlada del schema cycle-scoped en Supabase Production.

Esta fase es exclusivamente documental. No autoriza ni ejecuta SQL,
migraciones, cambios de datos, cambios Vercel, activacion de feature flags,
`db push`, `migration repair` o backfill.

Objetivo futuro de la ventana:

1. aplicar los tres archivos SQL exactos y en el orden aprobado;
2. incorporar el schema cycle-scoped sin crear datos cycle-scoped;
3. preservar el ciclo productivo existente;
4. normalizar grants y validar RLS/policies;
5. mantener Training Cycles apagado;
6. demostrar que Training legacy sigue funcionando.

## 2. Estado aprobado tras 2.2BO

Los prechecks read-only de Supabase Production confirmaron:

```text
Project ref Production: lzycxltqbrtsnwfdotqw
Clasificacion 2.2BO: APTO PARA VENTANA SQL PRODUCTION
Migracion cycle-scoped parcial: no detectada
training_cycle_routines: no existe
training_cycle_days: no existe
training_cycle_exercises: no existe
Columnas cycle-scoped en training_sessions: no existen
Columna cycle-scoped en exercise_entries: no existe
RPCs cycle-scoped: no existen
Constraints/indices/triggers cycle-scoped parciales: no detectados
Integridad legacy: OK
pgcrypto: disponible
gen_random_uuid(): disponible
public.set_updated_at(): disponible
training_cycles: 1 fila activa conocida
```

No se detectaron colisiones que requieran un patch previo.

## 3. SQL aun no autorizado

El cierre de 2.2BO confirma aptitud tecnica, pero no concede permiso de
escritura.

Estado de control:

```text
SQL Production: BLOQUEADO
Aplicar migraciones: BLOQUEADO
Supabase Production write: BLOQUEADO
Feature flag Production: OFF/no configurada
Training Cycles Production: apagado
```

La ejecucion solo podra comenzar despues de una autorizacion explicita y
separada de Arquitectura para la ventana 2.2BP.

## 4. Migraciones exactas y orden obligatorio

Ejecutar en el orden siguiente, sin omitir, combinar, reordenar o editar:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

Hashes SHA-256 aprobados:

```text
4721A69F57289221C50AE7A08D6E199A1699152C2961D5D40B9514380F7C7AC5
  20260604_training_cycle_scoped_model.sql

28FCB2DC90DF469D2D829377471939F2E0119BE81AC51E7ADA45E2930CFFD8D1
  20260604_training_cycle_scoped_policy_fix.sql

94FD3CB3D8DF1166CB7C17ADB6E5122D58A62387AED61122E7E7C336DF82AFD5
  20260605_training_cycle_scoped_session_entries_contract.sql
```

Responsabilidad de cada archivo:

- archivo 1: modelo base, tablas, columnas, indices, triggers, RLS, grants y
  primeras versiones de las RPCs;
- archivo 2: coherencia compuesta y policies sin comparaciones tautologicas;
- archivo 3: contrato final de `exercise_entries` y session entries puramente
  cycle-scoped.

El estado tras aplicar solo el archivo 1 o los archivos 1 y 2 es intermedio.
No debe considerarse cierre exitoso de la ventana.

## 5. Metodo recomendado

Metodo propuesto:

```text
Supabase Dashboard
-> proyecto Production lzycxltqbrtsnwfdotqw
-> SQL Editor
-> ejecucion manual controlada
```

Controles:

- confirmar visualmente nombre y project ref antes de cada ejecucion;
- usar solo el contenido exacto de los archivos versionados;
- capturar hora, operador, archivo, hash y resultado;
- no agregar SQL improvisado;
- no ejecutar pruebas de escritura ni invocar RPCs;
- mantener la feature flag OFF durante toda la ventana.

No usar:

```text
supabase db push
supabase migration repair
```

## 6. Feature flag y aislamiento funcional

Antes, durante y despues de la ventana:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/OFF en Production
```

Tambien deben permanecer fuera de Production:

```text
NEXT_PUBLIC_ENABLE_QA_TOOLS
NEXT_PUBLIC_SUPABASE_ENV=qa
```

La ventana no autoriza crear o modificar variables Vercel ni hacer redeploy.
El codigo cycle-scoped debe permanecer inaccesible mientras se modifica el
schema.

## 7. Prechecks finales inmediatamente antes de ejecutar

Todos estos gates deben confirmarse nuevamente dentro de la ventana:

- [ ] Proyecto Supabase Production correcto.
- [ ] Project ref `lzycxltqbrtsnwfdotqw`.
- [ ] Autorizacion escrita de Arquitectura vigente.
- [ ] Los tres archivos y hashes coinciden.
- [ ] Orden obligatorio confirmado.
- [ ] `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente/OFF.
- [ ] Variables QA no disponibles en Production.
- [ ] App Production estable.
- [ ] Login Production estable.
- [ ] Training legacy estable.
- [ ] No hubo cambios no planificados desde 2.2BO.
- [ ] `training_cycles` conserva la unica fila activa conocida.
- [ ] Esa fila no fue editada, cerrada ni eliminada.
- [ ] `training_cycle_routines` sigue sin existir.
- [ ] `training_cycle_days` sigue sin existir.
- [ ] `training_cycle_exercises` sigue sin existir.
- [ ] `training_sessions.cycle_id` sigue sin existir.
- [ ] `training_sessions.cycle_day_id` sigue sin existir.
- [ ] `exercise_entries.training_cycle_exercise_id` sigue sin existir.
- [ ] Las RPCs cycle-scoped siguen sin existir.
- [ ] Integridad y conteos legacy coinciden con 2.2BO.
- [ ] No existe estado parcial inesperado.
- [ ] Operador, observador y canal de aborto definidos.
- [ ] Estrategia de forward-fix/rollback disponible.

Si cualquiera de estos puntos no coincide, no ejecutar el primer archivo.

## 8. Secuencia propuesta de ejecucion

### 8.1 Apertura

1. Registrar fecha, hora, operador y observador.
2. Confirmar proyecto/ref por dos senales.
3. Repetir los prechecks finales read-only.
4. Confirmar frontend estable y repository OFF.
5. Registrar baseline de conteos, grants, policies y ciclo existente.

### 8.2 Aplicacion

1. Ejecutar
   `supabase/migrations/20260604_training_cycle_scoped_model.sql`.
2. Confirmar `Success`; ante error, detener.
3. Ejecutar inmediatamente
   `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`.
4. Confirmar `Success`; ante error, detener.
5. Ejecutar inmediatamente
   `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`.
6. Confirmar `Success`; ante error, detener.

No ejecutar entre archivos:

- pruebas funcionales;
- inserts de prueba;
- RPCs;
- cambios de flag;
- cambios Vercel;
- backfill.

### 8.3 Cierre

1. Ejecutar todos los postchecks read-only.
2. Comparar conteos legacy con el baseline.
3. Confirmar tablas nuevas vacias.
4. Confirmar ciclo productivo intacto.
5. Validar app, login y Training legacy.
6. Confirmar runtime cycle-scoped OFF.
7. Registrar evidencia y veredicto de ventana.

## 9. Control del registro existente en training_cycles

Production contiene una fila activa conocida, referida operacionalmente como
`Ciclo 1`.

Reglas obligatorias:

```text
No borrar.
No cerrar.
No cancelar.
No editar.
No usar como dato de prueba.
No asociar sesiones o entries nuevas.
No exigir que tenga training_cycle_* asociados.
No hacer backfill.
```

La migracion agrega columnas nullable a `training_cycles`; por tanto, la fila
existente debe permanecer valida aunque sus nuevos campos queden `null` y no
tenga plan operativo cycle-scoped.

Postcheck:

- misma cantidad de filas en `training_cycles`;
- mismo `id`, `user_id`, `status` y datos preexistentes;
- nuevas columnas sin modificaciones inesperadas;
- cero filas asociadas en las tablas `training_cycle_*`.

## 10. Postchecks de schema

Confirmar existencia de:

```text
public.training_cycle_routines
public.training_cycle_days
public.training_cycle_exercises
```

Confirmar columnas:

```text
training_cycles.duration_weeks
training_cycles.planned_start_date
training_cycles.planned_end_date
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
```

Confirmar contrato final:

```text
exercise_entries.exercise_id: nullable
exercise_entries.training_cycle_exercise_id: nullable a nivel de columna
exercise_entries_exercise_or_cycle_exercise_check: presente y validada
```

La constraint debe exigir:

```sql
exercise_id is not null
or training_cycle_exercise_id is not null
```

## 11. Postchecks de constraints, indices y triggers

Constraints minimas:

```text
training_cycles_duration_weeks_check
training_cycles_planned_dates_check
training_cycles_id_user_id_unique
training_cycle_routines_cycle_user_fk
training_cycle_days_cycle_user_fk
training_cycle_exercises_cycle_user_fk
training_sessions_cycle_day_required_check
training_cycle_routines_id_cycle_id_unique
training_cycle_days_id_cycle_id_unique
training_cycle_days_routine_cycle_fk
training_cycle_exercises_day_cycle_fk
training_sessions_cycle_day_cycle_fk
exercise_entries_exercise_or_cycle_exercise_check
```

Indices minimos:

```text
training_cycle_routines_user_cycle_idx
training_cycle_routines_user_cycle_name_idx
training_cycle_days_one_routine_per_day_idx
training_cycle_days_user_cycle_week_day_idx
training_cycle_exercises_user_cycle_day_idx
training_sessions_user_cycle_idx
exercise_entries_user_cycle_exercise_idx
```

Triggers:

```text
training_cycle_routines_set_updated_at
training_cycle_days_set_updated_at
training_cycle_exercises_set_updated_at
```

Todas las constraints deben quedar validadas. No aceptar objetos duplicados,
definiciones incompatibles o FKs sin respaldo unique.

## 12. Postchecks de RLS y policies

RLS debe estar activo en:

```text
training_cycles
training_cycle_routines
training_cycle_days
training_cycle_exercises
training_sessions
exercise_entries
```

Policies:

- dirigidas a `authenticated`;
- basadas en `auth.uid() = user_id`;
- sin expresiones abiertas con `true`;
- sin coexistencia accidental de policies antiguas;
- sin comparaciones tautologicas;
- rutina, dia, ejercicio y sesion deben pertenecer al mismo `cycle_id`;
- `exercise_entries` debe separar correctamente flujo legacy y cycle-scoped.

Buscar expresamente y rechazar condiciones equivalentes a:

```text
r.cycle_id = r.cycle_id
d.cycle_id = d.cycle_id
cycle_id = cycle_id
```

## 13. Postchecks de grants

Para las seis tablas:

```text
anon: sin permisos
authenticated: SELECT, INSERT, UPDATE
```

`authenticated` debe quedar sin:

```text
DELETE
TRUNCATE
REFERENCES
TRIGGER
```

No debe existir:

```text
GRANT ALL
GRANT DELETE
GRANT a anon
```

Este cambio normaliza grants amplios detectados en 2.2BO. Como modifica
privilegios de tablas legacy, Training legacy debe validarse inmediatamente
despues de los postchecks de catalogo.

## 14. Postchecks de RPCs

Deben existir:

```text
public.create_training_cycle_with_plan
public.create_training_session_with_cycle_entries
```

Confirmar:

- `SECURITY INVOKER`;
- `search_path = public, pg_temp`;
- `EXECUTE` para `authenticated`;
- sin `EXECUTE` para `anon`;
- uso de `auth.uid()` interno;
- sin parametro `user_id`;
- plan minimo obligatorio en create cycle;
- coherencia `cycle_id`/`cycle_day_id`/`training_cycle_exercise_id`;
- `exercise_id` opcional solo bajo el contrato cycle-scoped final.

No invocar las RPCs en Production durante esta ventana.

## 15. Postchecks de datos y aplicacion

Esperado inmediatamente despues:

```text
training_cycle_routines: 0 filas
training_cycle_days: 0 filas
training_cycle_exercises: 0 filas
training_sessions: conteo legacy sin cambios
exercise_entries: conteo legacy sin cambios
exercises: conteo legacy sin cambios
training_cycles: 1 fila activa conocida, sin cambios
```

Confirmar:

- cero backfill;
- cero ciclos nuevos;
- cero sesiones nuevas;
- cero entries nuevas;
- cero ejercicios legacy artificiales;
- columnas cycle-scoped nulas en sesiones/entries legacy;
- ninguna entry con ambos identificadores de ejercicio nulos.

Postchecks funcionales con flag OFF:

- app Production carga;
- login funciona;
- Training legacy carga y conserva sus datos;
- flujo legacy no presenta errores por grants o policies;
- `/qa/training-cycles` sigue bloqueado;
- Training Cycles sigue apagado;
- no aparecen requests cycle-scoped;
- no se hace redeploy.

## 16. Hallazgo pendiente: plan_snapshot.source

La RPC `create_training_cycle_with_plan` actualmente persiste:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

Este marcador no bloquea la ventana SQL porque:

- la feature flag Production permanece OFF;
- no se invocara la RPC;
- no se crearan ciclos productivos.

Antes de autorizar la activacion funcional en Production debe ocurrir una de
estas decisiones:

1. cambiar el marcador por un valor neutral/productivo y auditar el cambio; o
2. aceptar explicitamente el valor actual y documentar su semantica.

No resolver este punto dentro de la ventana SQL sin una fase separada.

## 17. Rollback y forward-fix

No improvisar rollback. Toda accion correctiva requiere autorizacion
especifica.

Principios:

1. mantener la feature flag OFF;
2. preservar errores, resultados y baseline;
3. detener la secuencia ante el primer fallo;
4. determinar si el SQL Editor revirtio la ejecucion fallida;
5. inventariar el estado parcial con consultas read-only;
6. preferir forward-fix auditado cuando ya existan objetos aplicados;
7. no borrar datos ni hacer backfill para facilitar una reversa;
8. no usar `db push` ni `migration repair`.

Reversa del archivo 3:

- restaurar RPC y policy anteriores solo con script auditado;
- retirar `exercise_entries_exercise_or_cycle_exercise_check`;
- restaurar `exercise_id NOT NULL` unicamente si no existen entries con
  `exercise_id is null`.

Reversa del archivo 2:

- restaurar policies capturadas en baseline;
- retirar FKs compuestas antes de sus unique auxiliares;
- no dejar policies tautologicas como estado operativo.

Reversa del archivo 1:

- solo considerar retirar objetos si las tablas nuevas estan vacias;
- confirmar que columnas nuevas contienen solo `null`;
- retirar dependencias en orden inverso;
- `DROP TABLE` y `DROP COLUMN` requieren autorizacion destructiva separada.

Si el archivo 1 se aplica y el archivo 2 o 3 falla, la opcion preferida es un
forward-fix auditado que complete el contrato final.

## 18. Criterios de aborto

Abortar antes de ejecutar si:

- el proyecto/ref no es inequívocamente Production;
- falta autorizacion escrita;
- un archivo o hash no coincide;
- la feature flag aparece configurada;
- Production o Training legacy no estan estables;
- cambio el baseline desde 2.2BO;
- el ciclo existente fue modificado;
- aparece cualquier objeto cycle-scoped parcial;
- falta una dependencia base;
- se requiere SQL adicional;
- se requiere backfill;
- no existe canal de observacion y aborto.

Abortar durante la aplicacion si:

- cualquier archivo falla;
- el SQL Editor reporta timeout o estado incierto;
- se pierde la conexion;
- cambia un dato o conteo inesperadamente;
- se intenta activar la feature;
- se propone omitir o reordenar un archivo;
- se requiere editar SQL en vivo.

Abortar durante postchecks si:

- cambia un conteo legacy;
- el ciclo existente cambia;
- aparecen filas en tablas nuevas;
- falta una constraint, indice, trigger o RPC;
- una policy es tautologica o abierta;
- RLS queda deshabilitada;
- `anon` conserva permisos;
- `authenticated` conserva permisos amplios;
- Training legacy presenta una regresion;
- el runtime intenta usar el repository cycle-scoped.

## 19. Evidencia requerida

La ventana debe entregar:

1. project name y ref confirmados;
2. fecha, hora, operador y observador;
3. autorizacion de Arquitectura;
4. hashes de los tres archivos;
5. baseline final inmediatamente anterior;
6. resultado completo de cada ejecucion;
7. hora de inicio y fin de cada archivo;
8. catalogo post-migracion de tablas, columnas y constraints;
9. indices y triggers;
10. RLS y policies completas;
11. grants de `anon` y `authenticated`;
12. firmas, seguridad y grants de las RPCs;
13. conteos antes/despues;
14. evidencia del ciclo existente intacto;
15. evidencia de tablas nuevas vacias;
16. validacion de app, login y Training legacy;
17. evidencia de `/qa/training-cycles` bloqueado;
18. evidencia de feature flag OFF;
19. confirmacion de cero backfill y cero datos de prueba;
20. veredicto final o detalle del punto de aborto.

## 20. Decision solicitada a Arquitectura

Se solicita una decision explicita entre:

```text
A. AUTORIZAR 2.2BP para ejecucion manual controlada en Supabase Production.
B. MANTENER SQL BLOQUEADO y solicitar ajustes documentales/tecnicos.
C. RECHAZAR la ventana y abrir una fase de patch previo.
```

Si se autoriza la opcion A, la autorizacion debe nombrar:

- project ref `lzycxltqbrtsnwfdotqw`;
- los tres archivos exactos;
- sus hashes;
- el orden obligatorio;
- el metodo SQL Editor;
- operador y observador;
- ventana horaria;
- criterios de aborto;
- prohibicion de activar Training Cycles;
- prohibicion de crear o modificar datos productivos.

Hasta recibir esa autorizacion:

```text
NO ejecutar SQL Production.
NO aplicar migraciones.
NO tocar Supabase Production.
```

## 21. Confirmaciones de preparacion

- No se ejecuto SQL Production.
- No se aplicaron migraciones.
- No se toco Supabase Production.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se hizo backfill.
- No se activaron feature flags productivas.
- No se crearon ni modificaron variables Vercel.
- No se hizo redeploy.
- No se crearon ciclos productivos.
- No se modificaron datos productivos.
- No se edito, cerro ni elimino el ciclo existente.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y excluido.
