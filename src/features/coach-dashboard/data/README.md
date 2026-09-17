# Preferencias privadas del Coach — lote local

Alcance: tarifa mensual única CLP e interés en Chat. No implementa cartera,
vinculación, aceptación del alumno, cobros, renovación ni edición de entrenamiento.
La UI productiva no está conectada por este lote.

## Contratos

- `read_own_coach_dashboard_preferences()` devuelve `monthlyFeeClp`, `version`
  y `chatInterestRegistered`. Sin tarifa guardada: `null`, versión `0`.
- `save_own_coach_dashboard_fee(p_monthly_fee_clp numeric, p_expected_version numeric)`
  devuelve tarifa y versión nuevas. Sólo enteros exactos; `null` y fracciones se
  rechazan antes del cast. Configurar `0` es distinto de no haber configurado tarifa.
- `register_own_coach_chat_interest()` devuelve confirmación idempotente; no cambia
  la versión de la tarifa. No envía correos ni promete una fecha de lanzamiento.

La versión es compare-and-swap: una actualización concurrente obsoleta produce
`version_conflict`, sin reintento silencioso que sobrescriba al otro dispositivo.
Los límites numéricos corresponden únicamente a representación exacta de JavaScript;
los totales derivados deben verificar desbordamiento o usar aritmética exacta.

## Integración obligatoria

`captureCoachPreferencesOperation` verifica identidad con el token capturado.
`createSupabaseCoachPreferencesRepository` implementa el transporte real del SDK:
recibe sólo configuración pública y el principal existente, fija el token validado
mediante `accessToken` y no inicializa otra sesión Auth, persistencia ni refresh.
No almacena ni registra el token. Cada RPC es POST con retry deshabilitado y recibe
el mismo `signal` de `captureOperation(signal)`: captura y RPC comparten ocho segundos.
La captura independiente también tiene límite por defecto. Auth puede no aceptar
cancelación: las respuestas tardías se ignoran, sin crear un cliente ni despachar RPC.
Los ocho tests del adaptador usan el SDK real con fetch simulado; no contactan QA.
La configuración debe proceder del entorno público aprobado, nunca del formulario.

`isCurrent()` debe invalidarse al cambiar cuenta, portal o generación de sesión.
Además de los guards de datos, el controller debe descartar resultados de operaciones
que ya no sean las vigentes. Un timeout de un write significa resultado incierto:
consultar de nuevo antes de decidir reintento; nunca anunciar éxito sin confirmación.

## Migración y pruebas

`20260908201518_coach_dashboard_private_preferences.sql` crea sólo dos tablas
privadas y tres RPC públicas autenticadas. RLS default-deny, sin grants directos,
membership Coach verificada en servidor y ownership desde `auth.uid()`. Las funciones
definer son necesarias para acceder a ese almacenamiento privado y fijan search_path
vacío. Borrar la identidad elimina sus preferencias mediante FK; no afecta training.

Pruebas locales: `npm run test:coach-dashboard-preferences` y
`node supabase/tests/support/run_coach_preferences_postgres.mjs`.
El segundo comando usa PostgreSQL 17.5 efímero, socket Unix privado, fixtures sintéticos
y pruebas reales concurrentes. No carga archivos dotenv ni acepta una URL QA/PROD;
el destino SQL es un socket local fijo. El driver pg puede consultar opciones del
entorno por defecto (incluidas PGPASSWORD/PGSSLMODE): no afirmar que el proceso es
hermético. La autenticación trust de esta instancia sintética no necesita contraseña.

La migración aún no está aplicada en QA. Su aplicación requiere inventario/hashes y
autorización exactos; este lote no constituye auditoría independiente ni QA manual.
