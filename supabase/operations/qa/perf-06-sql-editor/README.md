# PERF-06 manual en Supabase SQL Editor

Estos archivos permiten ejecutar PERF-06 en el Dashboard de Supabase sin una
conexión PostgreSQL directa desde el Mac. El destino de este directorio es
exclusivamente QA `organizatech-qa`, project ref
`fjjebhaqtrdbpxzxztmh`. No están autorizados para PROD.

## Por qué este flujo conserva el historial

La ejecución manual es una excepción controlada para este QA, cuyo historial de
migraciones de usuario todavía no existe. Los bundles no aplican SQL aislado:
dentro de la misma transacción crean `supabase_migrations.schema_migrations`,
registran las 18 migraciones históricas ya presentes materialmente y ejecutan y
registran las seis migraciones PERF-06. Cada fila conserva `version`, `name` y el
array exacto `statements` derivado con el parser de Supabase CLI 2.113.0.

Manifiesto canónico:

- 24 versiones.
- 336 statements.
- SHA-256:
  `2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848`.
- Fingerprint baseline:
  `ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1`.
- Fingerprint final:
  `833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9`.

## Orden obligatorio

1. Abrir el proyecto `organizatech-qa` y confirmar visualmente la ref
   `fjjebhaqtrdbpxzxztmh`.
2. Copiar completo `perf-06-qa-rollback.sql` a una consulta nueva del SQL
   Editor y pulsar **Run** una sola vez.
3. Continuar únicamente si la última tabla de resultados muestra:
   `verdict=PASS`, `terminal=ROLLBACK_VERIFIED`, `baseline_items=346` y el
   fingerprint baseline exacto.
4. Copiar completo `perf-06-qa-commit.sql` a otra consulta nueva y pulsar
   **Run** una sola vez.
5. Continuar únicamente si la última tabla de resultados muestra:
   `verdict=PASS`, 24 versiones, 336 statements, cero lineages pendientes y
   `catalog_valid=true`, `complete_state_valid=true`.
6. Copiar completo `perf-06-qa-postcheck.sql` a otra consulta nueva y pulsar
   **Run**. Debe repetir el mismo PASS final.
7. Recién después se realiza QA funcional manual en la Preview.

Si cualquier ejecución devuelve un error o `FAIL`, no se reintenta, no se edita
el SQL en el Dashboard y no se ejecuta el siguiente archivo. Se conserva el
mensaje completo y se vuelve a la tarea PERF-06R para diagnosticarlo.

## Garantías

- `perf-06-qa-rollback.sql` termina la operación principal con `ROLLBACK`.
- `perf-06-qa-commit.sql` contiene un único `COMMIT` principal, posterior a
  todos los gates finales.
- `perf-06-qa-postcheck.sql` es read-only y termina con `ROLLBACK`.
- No hay comandos `psql`, contraseñas, tokens, JWT ni claves Supabase.
- El lote toma los mismos locks y ejecuta los mismos SQL auditados por el runner
  nativo. No elimina ni altera la tabla diagnóstica.
- Los bundles se regeneran determinísticamente con
  `node scripts/perf-06-sql-editor-bundle.mjs --write` y se verifican con
  `node scripts/perf-06-sql-editor-bundle.mjs --verify`.

## Fuera de alcance

- PROD.
- `migration repair`, `db push` o CLI remoto.
- Borrado de la tabla diagnóstica.
- Cambios de variables de entorno o credenciales.
- Cualquier edición manual de los bundles generados.
