# Release B D3 - RPC v2 functional QA checks

D3 prepara pruebas funcionales controladas para las RPC v2:

- `public.save_training_workout_readiness_v2(...)`;
- `public.link_training_workout_readiness_session_v2(...)`.

## Orden obligatorio

1. Ejecutar `01_precheck_readonly.sql`.
2. Ejecutar `02_rpc_functional_transaction.sql` solo si el precheck devuelve `D3_QA_READY`.
3. Ejecutar `03_postcheck_readonly.sql` para confirmar que el rollback fue efectivo.

## Alcance

- Ejecucion exclusiva en QA (`organizatech-qa`, project ref `fjjebhaqtrdbpxzxztmh`).
- Production permanece intacta.
- Sin `supabase db push`.
- Sin automatizacion.
- Sin frontend todavia.
- Ningun UUID esta hardcodeado.
- No se imprimen UUIDs, payloads reales ni datos personales.

## Conteo legacy dinamico

Durante la preparacion de D3, el formulario diario de QA agrego legitimamente una cuarta fila en `training_daily_readiness`.

Los conteos legacy cambian con el uso normal de QA, por lo que D3 no debe depender de un numero fijo de filas legacy. El precheck y el postcheck reportan `legacy_training_daily_readiness_rows` solo como informacion.

La prueba funcional captura `legacy_rows_before` al inicio y `legacy_rows_after` al final, y exige que ambos valores sean iguales. Esto demuestra que D3 no altera el contrato legacy durante su ejecucion.

## Precheck

`01_precheck_readonly.sql` valida que:

- `training_workout_readiness` exista y tenga 0 filas;
- las RPC v2 existan;
- `training_daily_readiness` legacy exista;
- `save_daily_training_readiness(jsonb)` exista;
- exista al menos una sesion real reciente de QA, con ciclo y dia asociados, dentro de la ventana permitida y sin readiness enlazado.

Si devuelve `D3_QA_NOT_READY`, detenerse.

Si no existe sesion reciente, crear una sesion QA por el flujo normal de la aplicacion y repetir el precheck. No crear datos mediante SQL manual para satisfacer D3.

## Prueba funcional transaccional

`02_rpc_functional_transaction.sql` abre una transaccion, configura claims locales para simular al usuario autenticado de la sesion candidata, ejecuta las RPC v2 con rol `authenticated`, verifica los escenarios obligatorios y termina siempre en `rollback`.

Escenarios cubiertos:

- primer guardado;
- retry identico;
- retry con payload diferente y `context_mismatch = true`;
- segundo intento real con `skipped = true`;
- primer enlace a `training_session_id`;
- retry del enlace con `already_linked = true`.

Las unicas escrituras permitidas son las que ocurren indirectamente dentro de las RPC v2 sobre `training_workout_readiness`. No hay DML directo sobre `training_sessions`, `exercise_entries`, `training_daily_readiness` ni `training_workout_readiness`.

Si no devuelve `D3_RPC_FUNCTIONAL_VERIFIED`, detenerse.

## Postcheck

`03_postcheck_readonly.sql` confirma que el rollback fue efectivo:

- `training_workout_readiness_rows = 0`;
- `training_daily_readiness` legacy existe;
- `save_daily_training_readiness(jsonb)` existe;
- tabla y RPCs v2 siguen presentes.

El conteo legacy se reporta como informacion y no bloquea el veredicto.

Si no devuelve `D3_QA_ROLLBACK_VERIFIED`, detenerse y no continuar fases posteriores.

Ninguna fila de prueba D2 debe persistir tras el rollback.
## Cierre real de D3 en QA

Durante la ejecucion real de D3 en QA se confirmo el siguiente flujo:

- El precheck inicial quedo bloqueado por ausencia de una sesion candidata reciente.
- Se creo legitimamente una sesion QA mediante el flujo normal de la aplicacion.
- El conteo legacy paso a ser dinamico porque el formulario diario agrego una cuarta fila valida en `training_daily_readiness`.
- Se detecto el error PostgreSQL `42702` en `save_training_workout_readiness_v2` por la clausula `on conflict (user_id, workout_attempt_id)`.
- La causa fue la ambiguedad entre nombres de columnas y variables de salida generadas por `RETURNS TABLE`.
- En QA se aplico manualmente el hotfix `on conflict on constraint training_workout_readiness_user_attempt_key do nothing`.
- La prueba funcional devolvio `D3_RPC_FUNCTIONAL_VERIFIED`.
- El rollback fue verificado con `D3_QA_ROLLBACK_VERIFIED`.
- `training_workout_readiness_rows = 0` al cierre.
- `legacy_training_daily_readiness_rows = 4` al cierre.
- Production y frontend no fueron tocados.

El archivo `04_save_v2_on_conflict_hotfix.sql` documenta el hotfix exacto aplicado en QA. No debe ejecutarse automaticamente ni en Production.