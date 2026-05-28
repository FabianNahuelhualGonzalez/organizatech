# Protocolo de cambios de base de datos

## Objetivo

Este protocolo define las reglas para planificar, validar y desplegar cambios de base de datos en Organizatech sin afectar datos productivos, usuarios reales ni compatibilidad con registros historicos.

La regla principal es:

**Nunca se mergea codigo que depende de una migracion sin plan de despliegue, validacion y rollback.**

## Clasificacion de cambios

### Cambios aditivos

Son cambios que agregan capacidad sin romper lo existente:

- Nuevas columnas nullable.
- Nuevas tablas.
- Nuevos indices.
- Nuevas RPC.
- Nuevas policies compatibles.

Estos cambios suelen ser los mas seguros, pero igual requieren QA y validacion en produccion si el codigo depende de ellos.

### Cambios destructivos

Son cambios que pueden romper codigo o datos existentes:

- Borrar columnas.
- Renombrar columnas.
- Cambiar tipos de datos.
- Eliminar tablas.
- Cambiar constraints de forma incompatible.
- Endurecer RLS sin revisar flujos existentes.

Estos cambios no deben hacerse en caliente. Deben planificarse con fase de compatibilidad, respaldo y rollback.

### Cambios de lectura

Son cambios donde el frontend o repository empieza a leer nuevos campos, tablas o RPC.

Antes de mergear codigo de lectura nuevo, confirmar:

- La migracion ya existe.
- QA tiene el schema esperado.
- Produccion tendra el schema esperado antes del deploy.
- Los datos legacy siguen visibles o existe fallback.

### Cambios de escritura

Son cambios donde el frontend empieza a escribir en nuevas columnas, tablas o RPC.

Antes de mergear codigo de escritura nuevo, confirmar:

- La migracion esta aplicada en QA.
- La escritura fue validada en QA.
- La migracion productiva se aplicara antes del deploy productivo si el codigo la requiere.
- La operacion falla con mensaje claro si falta schema.
- No se duplica informacion ni se crean registros parciales.

### Cambios de RLS, policies y RPC

Todo cambio de seguridad debe revisarse con especial cuidado:

- RLS debe permanecer activo.
- Las policies deben ser multiusuario y basadas en `auth.uid()`.
- Las RPC llamadas desde frontend deben usar permisos minimos.
- Las RPC deben validar ownership dentro de la funcion.
- Las tablas nuevas deben tener `GRANT` explicitos si aplica.
- Las RPC usadas desde frontend deben tener `GRANT EXECUTE` para los roles esperados.

## Patron expand and contract

Los cambios de base de datos deben seguir el patron **expand and contract** cuando haya riesgo de incompatibilidad.

### 1. Expand

Agregar estructura nueva sin romper la antigua:

- Crear columnas nuevas nullable.
- Crear tablas nuevas.
- Crear RPC nuevas.
- Mantener lecturas antiguas.
- Mantener escrituras antiguas si todavia son necesarias.

### 2. Migrate

Mover el uso hacia el modelo nuevo:

- Desplegar codigo compatible con ambos modelos.
- Validar nuevas escrituras.
- Validar lectura de datos nuevos y legacy.
- Diagnosticar historicos antes de cualquier backfill.
- Ejecutar backfill solo si fue aprobado y probado.

### 3. Contract

Retirar lo antiguo solo cuando sea seguro:

- Confirmar que no hay codigo usando el modelo anterior.
- Confirmar que los datos historicos fueron migrados o tienen lectura compatible.
- Retirar columnas, paths o RPC legacy en una fase separada.

## Orden correcto de despliegue

### Migracion primero, codigo despues

Usar este orden cuando el codigo nuevo depende de columnas, tablas, indices o RPC nuevas.

Orden:

1. Aplicar migracion en QA.
2. Validar QA.
3. Aplicar migracion en produccion si el deploy productivo la requiere.
4. Desplegar codigo.
5. Validar produccion.

### Codigo compatible primero, migracion despues

Usar este orden cuando el codigo puede funcionar con schema antiguo y nuevo.

Ejemplos:

- Lectura con fallback.
- Campos opcionales.
- RPC usada solo si existe feature habilitada.

Orden:

1. Desplegar codigo compatible.
2. Aplicar migracion.
3. Activar nueva lectura/escritura si corresponde.
4. Validar.

### Cuando usar feature flag

Usar feature flag cuando:

- El cambio afecta escritura productiva.
- Hay migracion y codigo que deben convivir.
- Se requiere apagar rapido el flujo nuevo sin rollback completo.
- El cambio puede afectar datos historicos.

## Checklist antes de merge

Antes de mergear un cambio que toca base de datos o depende de ella:

- QA validado.
- Migracion QA aplicada.
- Migracion produccion aplicada si el codigo la requiere antes de desplegar.
- Vercel Production apunta a Supabase Produccion.
- Vercel Preview apunta a Supabase QA.
- Development/local apuntan a Supabase QA.
- `.env.local` no esta versionado.
- No hay secrets, tokens ni service_role en frontend.
- Fallback legacy revisado si existen datos antiguos.
- RLS revisado.
- Policies/RPC revisadas.
- Errores visibles en espanol.
- Plan de rollback definido.

## Checklist post-deploy

Despues de desplegar:

- Login productivo funciona.
- Datos reales visibles.
- Datos legacy visibles.
- Guardado nuevo funcionando.
- Separacion Usuario A vs Usuario B validada si aplica.
- Consola sin errores criticos.
- Network sin fallas de schema/RPC.
- No hay caida silenciosa a localStorage en modo real.
- Produccion no recibe datos de QA.
- QA no recibe datos productivos.

## Regla legacy

Los datos historicos son parte del producto y deben tratarse como datos reales.

Reglas:

- No eliminar lectura historica sin diagnostico.
- No hacer backfill automatico sin validacion.
- No asumir que los registros antiguos tienen campos nuevos completos.
- Si hay datos antiguos, implementar fallback read-only cuando sea necesario.
- No modificar historicos sin respaldo, script revisado y aprobacion.
- No usar datos legacy como fuente principal para nuevos guardados si ya existe modelo nuevo.

## Reglas de seguridad

- No usar `service_role` en frontend.
- RLS obligatorio.
- Validar ownership con `auth.uid()`.
- No desactivar RLS para resolver errores.
- No exponer claves privadas.
- No subir `.env.local`.
- No guardar secrets en GitHub, ClickUp ni documentacion.
- Usar `GRANT` explicitos para tablas nuevas cuando corresponda.
- Usar `GRANT EXECUTE` para RPC llamadas desde frontend.
- No confiar en `user_id` recibido desde frontend para operaciones sensibles.

## Leccion aprendida Fase 2 Training

En Fase 2 Training, `training_sessions` paso a ser fuente de verdad del entrenamiento diario.

La implementacion funciono en QA, pero el codigo nuevo fue desplegado antes de cerrar completamente la compatibilidad con datos legacy en produccion.

Los datos antiguos no se perdieron. Seguian existiendo en:

- `routines`
- `training_sessions`
- `exercise_entries`

El problema fue que los registros legacy tenian campos nuevos en `NULL`, por ejemplo:

- `routine_id`
- `calendar_week_start`
- `planned_day`
- `planned_date`
- `trained_date`
- `completed_at`

El codigo nuevo esperaba esos campos para construir el dashboard/carrusel, por lo que algunos entrenamientos antiguos dejaron de verse temporalmente.

La solucion aplicada fue:

- Aplicar la migracion productiva correspondiente.
- Agregar fallback legacy de solo lectura para reconstruir entrenamientos antiguos desde `exercise_entries` cuando no existe una sesion Fase 2 para el dia.

## Prohibiciones

- No borrar columnas en caliente.
- No renombrar columnas sin fase de compatibilidad.
- No cambiar tipos sin plan de migracion.
- No ejecutar `UPDATE`/`DELETE` masivo sin respaldo.
- No hacer backfill automatico sin diagnostico.
- No mergear si produccion no esta validada.
- No desplegar codigo que depende de una migracion no aplicada.
- No modificar RLS sin pruebas multiusuario.
- No usar datos hardcodeados de usuarios, emails, ids o fechas.
