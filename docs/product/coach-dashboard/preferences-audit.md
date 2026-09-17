# Preferencias privadas Coach — auditoría del lote local

Fecha: 2026-09-08. Entorno DATA `codex/coach-dashboard-data-01`, base/HEAD
`00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`. Stash protegido intacto:
`7e618d67efb4290082a4f6be258c1f75640856c8`.

## Veredicto acotado

- Código técnico local: PASS (suite npm test, typecheck, lint, build y diff).
- 15 pruebas focales PASS; coordinador las repitió durante la revisión.
- PostgreSQL 17.5 local: 64 comprobaciones PASS, incluidos ownership, ACL/RLS,
  carreras CAS inicial/actualización e idempotencia. Log del implementador
  inspeccionado, no se reejecutó SQL en la auditoría estática.
- Auditoría independiente Claude, sólo Read/Glob/Grep: PASS estático, sin
  hallazgos bloqueantes. Proceso real completado exit0, no auditoría simulada.
- Codex Security diff: completado, 13 archivos revisados, cero vulnerabilidades
  confirmadas. No equivale a auditoría de toda la plataforma.
- Integración del flujo Coach, migraciones QA y QA manual: PENDIENTES.

## Inventario congelado de DATA

Este apartado conserva el snapshot del **primer lote de trece archivos**. El
segundo lote añade el adaptador SDK y su test, con nuevo hash de package y
precisión documental del runner; tiene validaciones/auditoría propias y no está
cubierto automáticamente por los resultados históricos de esta página.

1. package.json — sólo script focal y posttest, sin dependencias.
2. src/features/active-workout/active-workout-visual-integration-contract.test.ts — sólo hash package.
3. src/features/coach-portal/coach-portal-integration-contract.ts — ruta exacta migración nueva.
4. src/features/coach-dashboard/data/README.md
5. src/features/coach-dashboard/data/coach-preferences-contract.ts
6. src/features/coach-dashboard/data/coach-preferences-deadline.ts
7. src/features/coach-dashboard/data/coach-preferences-migration.test.ts
8. src/features/coach-dashboard/data/coach-preferences-operation.ts
9. src/features/coach-dashboard/data/coach-preferences-repository.test.ts
10. src/features/coach-dashboard/data/coach-preferences-repository.ts
11. supabase/migrations/20260908201518_coach_dashboard_private_preferences.sql
12. supabase/tests/support/coach_preferences_local_bootstrap.sql
13. supabase/tests/support/run_coach_preferences_postgres.mjs

Hash migración: `1dcba62528dac569acaa18d84437cd3a965d5ebd4274f9cfef1d1d20f2ba2cee`.
Hash package: `8e7d21947dde0b7898221a46b58e3d1d08cf2b6bbc38ace3ef8e0292b04adf06`.
Lock intacto: `3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5`.

## Límites y condiciones antes de integración/QA

- No hay adaptador productivo ni controller conectado. Implementar cliente de
  token fijo sin persistencia/refresh; invalidar por cuenta/portal/generación,
  descartar respuestas antiguas y reconciliar un write de resultado incierto
  antes de reintentar. El deadline8s no promete rollback SQL.
- Las funciones usan FORCE RLS sin policies y necesitan un definer con privilegios
  efectivos compatibles. El runner prueba postgres superusuario; antes de QA
  verificar owner/BYPASSRLS/grants reales, exposición RPC y authJWT/PostgREST.
  Un owner sin privilegios falla cerrado, pero la función queda inutilizable.
- El bootstrap local aplica auth sintético + migración inicial Coach + nueva;
  no prueba toda la historia de migraciones hospedada.
- 40001 es conflicto de versión en este contrato y también puede representar un
  fallo real de serialización con otras isolaciones. No hay reintento silencioso;
  no es bypass de seguridad. expectedVersion0 ya configurado también es conflicto.
- Precisión documental pendiente antes del inventario final: README48/runner2
  dicen que no leen credenciales. No leen dotenv ni aceptan URL QA/PROD y el
  destino es socket local fijo, pero pg instalado consulta PGPASSWORD/PGSSLMODE
  por defecto al omitirse password/ssl. No se inspeccionaron valores ni se observó
  exfiltración. Corregir esa garantía demasiado amplia; no afirmar entorno
  hermético. Esta precisión del coordinador complementa el informe Claude.
- El runner descarga un binario público con SHA256 fijo antes de ejecutarlo;
  “SQL local” no significa “cero red”. No se accedió a DB remota durante el lote.
- TAC no verificable: conector desconectado. La revisión local no dependió de
  ese acceso y no acredita funciones protegidas disponibles.

## Evidencia local y trazabilidad

- Claude: `/tmp/organizatech-coach-preferences-claude-audit.json`.
- SQL: `/tmp/organizatech-coach-preferences-sql.log`.
- Suite: `/tmp/organizatech-coach-preferences-npm-test.log`.
- Repetición focal: `/tmp/organizatech-coach-preferences-audit-focal.log`.
- Resto: `/tmp/organizatech-coach-preferences-{typecheck,lint,build}.log`.
- Scan: `cb3e6328-efb9-4901-9c4e-19f6c40ce1d7`.
- Bundle sellado:
  `/private/var/folders/w2/82hn88697plbqkvjmzjpdvk80000gn/T/codex-security-scans-TEzRxF/organizatech-coach-dashboard-data-01/00701bd5012f3b0baf126ca40d7dd292fd9b4dc2_20260908T204356Z_w_ipmsju/`.
  Contiene report.md, manifest, findings, coverage y SARIF. Cobertura completa del
  diff solicitado, no del repositorio; inventario nativo10 fuentes +3 docs/support.

Consumo informado por el contador del scan: total acumulado5.817.094 tokens,
incluidos5.546.624 tokens de entrada cacheados. La medición está marcada PARCIAL
por lineage/ownership incompletos y registros inválidos: no atribuirla como gasto
exclusivo de estos trece archivos ni como medición exacta de este turno. Claude
reportó por separado27.986 tokens de salida y0,8509374USD; no sumar contadores
como si representaran el mismo sistema de facturación.

No hubo commit, push, merge, migración remota ni modificación de producción.
