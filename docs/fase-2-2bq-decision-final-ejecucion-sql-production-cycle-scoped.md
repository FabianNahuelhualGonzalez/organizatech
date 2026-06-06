# Fase 2.2BQ - Decision final y ejecucion SQL Production cycle-scoped

## 1. Resumen ejecutivo

La Fase 2.2BP fue cerrada y aprobada como solicitud documental para una
ventana SQL Production cycle-scoped.

2.2BQ comienza con un gate final pre-ejecucion. Este documento prepara ese
gate y solicita la decision definitiva de Arquitectura.

Estado al crear este documento:

```text
SQL Production: NO autorizado
Supabase write: NO autorizado
Aplicar migraciones: NO autorizado
Feature flag Production: OFF/no configurada
Training Cycles Production: apagado
```

No se debe pegar ni ejecutar SQL hasta que:

1. todos los gates sean reconfirmados inmediatamente antes de la ventana;
2. Arquitectura emita una autorizacion explicita para ejecutar 2.2BQ;
3. operador y observador confirmen el alcance y los criterios de aborto.

## 2. Estado actual tras 2.2BP

Evidencia documental aprobada:

```text
2.2BO: APTO PARA VENTANA SQL PRODUCTION
2.2BP: CERRADA Y APROBADA
Project ref Production: lzycxltqbrtsnwfdotqw
Migracion cycle-scoped parcial: no detectada
Integridad legacy: OK
Dependencias base: OK
training_cycles: 1 fila activa conocida
```

Ausencias confirmadas en el baseline 2.2BO:

```text
public.training_cycle_routines
public.training_cycle_days
public.training_cycle_exercises
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
public.create_training_cycle_with_plan
public.create_training_session_with_cycle_entries
```

Tambien se confirmo ausencia de constraints, indices y triggers
cycle-scoped parciales.

Esta evidencia habilita la decision, pero debe reconfirmarse al abrir la
ventana. No sustituye los prechecks inmediatamente anteriores al SQL.

## 3. SQL aun no autorizado

La preparacion inicial de 2.2BQ no concede permisos de escritura.

Continua prohibido:

- ejecutar SQL Production;
- aplicar cualquiera de las tres migraciones;
- usar Supabase SQL Editor para escritura;
- ejecutar `supabase db push`;
- ejecutar `supabase migration repair`;
- hacer backfill;
- activar Training Cycles;
- crear o modificar variables Vercel;
- crear ciclos, sesiones o entries productivos;
- editar, cerrar o borrar el ciclo productivo existente.

El unico resultado permitido en esta etapa es una decision de Arquitectura:
autorizar, mantener bloqueada o rechazar la ejecucion.

## 4. Gate pre-ejecucion obligatorio

Cada punto debe quedar marcado como `CONFIRMADO` en la misma sesion y antes
de pegar el primer archivo en SQL Editor.

### 4.1 Ambiente y autorizacion

- [ ] Supabase Dashboard muestra inequivocamente el proyecto Production.
- [ ] Project ref visible: `lzycxltqbrtsnwfdotqw`.
- [ ] Se confirmo el ambiente por dos senales independientes.
- [ ] Arquitectura autorizo expresamente ejecutar 2.2BQ.
- [ ] Operador identificado.
- [ ] Observador identificado.
- [ ] Hora de inicio y canal de aborto definidos.

### 4.2 Aislamiento funcional

- [ ] `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente/OFF en Production.
- [ ] `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta disponible en Production.
- [ ] `NEXT_PUBLIC_SUPABASE_ENV=qa` no esta disponible en Production.
- [ ] Training Cycles permanece apagado.
- [ ] `/qa/training-cycles` permanece bloqueado.
- [ ] App Production carga.
- [ ] Login Production funciona.
- [ ] Training legacy funciona.
- [ ] No se modificaron variables Vercel.
- [ ] No se hizo redeploy.

### 4.3 Baseline Supabase

- [ ] No hubo cambios no planificados desde 2.2BO.
- [ ] `training_cycles` conserva una fila activa conocida.
- [ ] El Ciclo 1 no fue editado, cerrado, cancelado ni eliminado.
- [ ] Las tres tablas `training_cycle_*` siguen ausentes.
- [ ] Las columnas cycle-scoped siguen ausentes.
- [ ] Las dos RPCs cycle-scoped siguen ausentes.
- [ ] No aparecieron constraints, indices o triggers parciales.
- [ ] Conteos e integridad legacy coinciden con 2.2BO.
- [ ] Dependencias `pgcrypto`, `gen_random_uuid()` y
      `public.set_updated_at()` siguen disponibles.

### 4.4 Artefactos y metodo

- [ ] Los tres archivos exactos estan disponibles localmente.
- [ ] Los tres hashes SHA-256 coinciden.
- [ ] El orden obligatorio fue confirmado.
- [ ] Metodo unico: SQL Editor manual de Supabase Production.
- [ ] No se usara `db push`.
- [ ] No se usara `migration repair`.
- [ ] No habra backfill.
- [ ] No se ejecutara SQL adicional o improvisado.
- [ ] Rollback/forward-fix esta disponible.
- [ ] Criterios de aborto fueron leidos y aceptados.

Si un punto queda pendiente, ambiguo o distinto del baseline, no pegar SQL y
clasificar 2.2BQ como `ABORTADA ANTES DE EJECUCION`.

## 5. Migraciones exactas y orden

Orden obligatorio:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

No se permite:

- reordenar archivos;
- omitir el patch de policies;
- detener la ventana voluntariamente en un estado intermedio;
- editar SQL durante la ejecucion;
- combinar contenido con scripts no auditados;
- ejecutar pruebas funcionales entre archivos.

Responsabilidad:

```text
Archivo 1: modelo base, tablas, columnas, RLS, grants y RPCs iniciales.
Archivo 2: coherencia compuesta y policies no tautologicas.
Archivo 3: contrato final de session entries cycle-scoped.
```

Los estados posteriores al archivo 1 o a los archivos 1 y 2 son intermedios y
no deben considerarse resultado exitoso.

## 6. Hashes SHA-256 confirmados

Hashes calculados localmente el 6 de junio de 2026:

```text
4721A69F57289221C50AE7A08D6E199A1699152C2961D5D40B9514380F7C7AC5
  20260604_training_cycle_scoped_model.sql

28FCB2DC90DF469D2D829377471939F2E0119BE81AC51E7ADA45E2930CFFD8D1
  20260604_training_cycle_scoped_policy_fix.sql

94FD3CB3D8DF1166CB7C17ADB6E5122D58A62387AED61122E7E7C336DF82AFD5
  20260605_training_cycle_scoped_session_entries_contract.sql
```

Los hashes deben volver a calcularse inmediatamente antes de ejecutar. Una
diferencia, incluso minima, obliga a abortar y solicitar nueva auditoria.

## 7. Metodo unico de ejecucion

Metodo solicitado:

```text
Supabase Dashboard
-> proyecto Production
-> project ref lzycxltqbrtsnwfdotqw
-> SQL Editor
-> ejecucion manual controlada
```

Por cada archivo se debe registrar:

- nombre exacto;
- hash;
- hora de inicio;
- hora de finalizacion;
- operador;
- resultado completo de SQL Editor;
- confirmacion `Success` o punto exacto de falla.

No continuar al archivo siguiente si SQL Editor informa error, timeout,
desconexion o resultado incierto.

## 8. No se usara db push

2.2BQ no autoriza:

```text
supabase db push
```

La aplicacion se limita al SQL Editor manual. No se modificara el historial
remoto mediante CLI ni se resolveran divergencias automaticamente.

## 9. No se usara migration repair

2.2BQ no autoriza:

```text
supabase migration repair
```

Un estado parcial debe inventariarse con consultas read-only. Cualquier
reconciliacion del historial requiere otra autorizacion.

## 10. No habra backfill

La ventana agrega schema y normaliza permisos. No debe poblar las nuevas
tablas ni columnas.

Esperado al finalizar:

```text
training_cycle_routines: 0 filas
training_cycle_days: 0 filas
training_cycle_exercises: 0 filas
training_sessions con cycle_id/cycle_day_id: 0 filas
exercise_entries con training_cycle_exercise_id: 0 filas
```

No se crearan ciclos, sesiones, entries o ejercicios de prueba.

## 11. Proteccion del Ciclo 1 productivo

Existe una fila activa conocida en `public.training_cycles`, denominada
operacionalmente Ciclo 1.

Controles obligatorios:

```text
No borrar.
No editar.
No cerrar.
No cancelar.
No usar como dato de prueba.
No asociar a tablas training_cycle_*.
No asociar sesiones o entries nuevas.
No hacer backfill.
No exigir que tenga plan cycle-scoped.
```

Las columnas nuevas de `training_cycles` son nullable. El registro debe seguir
siendo valido sin datos asociados en las tablas nuevas.

La evidencia antes/despues debe confirmar:

- mismo conteo en `training_cycles`;
- mismo identificador, usuario y estado;
- datos preexistentes sin cambios;
- cero relaciones cycle-scoped nuevas.

## 12. Feature flag OFF/no configurada

Gate productivo:

```ts
process.env.VERCEL_ENV === "production" &&
process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

Estado requerido durante toda 2.2BQ:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/OFF
```

No se creara, modificara ni activara la variable. Tampoco se hara redeploy.

## 13. Training Cycles permanece apagado

La aplicacion del schema no equivale a activacion funcional.

Durante prechecks, ejecucion, postchecks y observacion:

- repository cycle-scoped apagado;
- UI legacy como ruta productiva;
- `/qa/training-cycles` bloqueado;
- sin requests a tablas o RPCs cycle-scoped;
- sin ciclos productivos nuevos.

El marcador actual:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

no bloquea la ventana con la flag OFF, porque las RPCs no se invocaran. Debe
resolverse o aceptarse expresamente antes de una futura activacion funcional.

## 14. Rollback y forward-fix

Principios:

1. mantener la flag OFF;
2. detenerse ante el primer error;
3. preservar logs y resultados;
4. determinar si el SQL Editor revirtio el archivo fallido;
5. inventariar el estado con consultas read-only;
6. no reintentar ciegamente;
7. preferir forward-fix auditado si existe estado parcial;
8. no borrar ni modificar datos;
9. no usar `db push` ni `migration repair`.

Archivo 3:

- restaurar RPC/policy anteriores solo mediante script auditado;
- retirar la constraint nueva solo con autorizacion;
- restaurar `exercise_id NOT NULL` solo si no existen valores nulos.

Archivo 2:

- restaurar policies del baseline solo con script auditado;
- retirar FKs compuestas antes de retirar sus uniques de soporte;
- no dejar policies tautologicas como estado operativo.

Archivo 1:

- no retirar tablas o columnas sin autorizacion destructiva separada;
- confirmar tablas vacias y columnas sin datos;
- retirar dependencias en orden inverso.

Si los archivos 1 o 2 quedan aplicados y el siguiente falla, la ruta preferida
es un forward-fix revisado que complete el contrato final.

## 15. Criterios de aborto

Abortar antes del SQL si:

- hay duda de ambiente o project ref;
- no existe autorizacion explicita;
- un hash no coincide;
- la flag aparece configurada;
- App, login o Training legacy no estan estables;
- el baseline cambio;
- el Ciclo 1 cambio;
- aparece schema cycle-scoped parcial;
- falta una dependencia;
- se requiere SQL adicional o backfill.

Abortar durante la aplicacion si:

- cualquier sentencia o archivo falla;
- SQL Editor informa timeout;
- se pierde la conexion;
- el resultado es incierto;
- cambia un conteo o dato;
- se propone alterar el orden;
- se intenta modificar una variable o activar la feature.

Abortar durante postchecks si:

- cambia un conteo legacy;
- cambia el Ciclo 1;
- aparecen filas cycle-scoped;
- falta cualquier objeto esperado;
- una constraint no esta validada;
- RLS queda deshabilitada;
- una policy es abierta o tautologica;
- `anon` conserva permisos;
- `authenticated` conserva `DELETE`, `TRUNCATE`, `REFERENCES` o `TRIGGER`;
- una RPC queda `SECURITY DEFINER`;
- Training legacy presenta regresion;
- el frontend intenta usar el repository cycle-scoped.

## 16. Postchecks esperados si Arquitectura autoriza

### 16.1 Schema

- tablas `training_cycle_routines`, `training_cycle_days` y
  `training_cycle_exercises` creadas;
- columnas normalizadas de duracion en `training_cycles`;
- `training_sessions.cycle_id` y `cycle_day_id`;
- `exercise_entries.training_cycle_exercise_id`;
- `exercise_entries.exercise_id` nullable;
- constraint que exige `exercise_id` o `training_cycle_exercise_id`.

### 16.2 Coherencia

- constraints y FKs esperadas presentes y validadas;
- uniques compuestos de soporte presentes;
- rutina, dia, ejercicio y sesion asociados al mismo ciclo;
- indices esperados presentes;
- triggers `updated_at` presentes.

### 16.3 Seguridad

- RLS activo en las seis tablas;
- policies `TO authenticated`;
- sin policies abiertas;
- sin comparaciones tautologicas;
- `anon` sin permisos;
- `authenticated` solo con `SELECT`, `INSERT`, `UPDATE`;
- sin `DELETE`, `TRUNCATE`, `REFERENCES` o `TRIGGER`.

La migracion 1 ejecuta `REVOKE` sobre tablas legacy activas:
`training_sessions`, `exercise_entries` y `training_cycles`. El estado previo
detectado en 2.2BO incluye grants amplios que la migracion normalizara.
Training legacy debe validarse inmediatamente despues de los postchecks de
catalogo.

### 16.4 RPCs

- `create_training_cycle_with_plan` existe;
- `create_training_session_with_cycle_entries` existe;
- ambas son `SECURITY INVOKER`;
- ambas usan `auth.uid()`;
- `EXECUTE` solo para `authenticated`;
- no se invocan durante la ventana.

### 16.5 Datos y aplicacion

- conteos legacy sin cambios;
- nuevas tablas vacias;
- nuevas columnas sin backfill;
- Ciclo 1 intacto;
- App Production carga;
- login funciona;
- Training legacy funciona;
- `/qa/training-cycles` bloqueado;
- feature flag OFF;
- cero ciclos productivos nuevos;
- cero redeploy.

## 17. Decision solicitada a Arquitectura

Arquitectura debe emitir una de estas decisiones:

```text
A. AUTORIZAR EJECUCION 2.2BQ
   Autoriza aplicar manualmente los tres archivos exactos en Supabase
   Production mediante SQL Editor, en el orden y bajo los gates documentados.

B. MANTENER BLOQUEADA 2.2BQ
   No se ejecuta SQL. Se solicitan controles o evidencia adicionales.

C. RECHAZAR EJECUCION 2.2BQ
   No se ejecuta SQL. Se abre una fase de patch o rediseno previo.
```

Una autorizacion valida para la opcion A debe indicar expresamente:

- project ref `lzycxltqbrtsnwfdotqw`;
- los tres archivos;
- los tres hashes;
- el orden obligatorio;
- metodo SQL Editor manual;
- operador y observador;
- ventana horaria;
- criterios de aborto;
- proteccion del Ciclo 1;
- feature flag OFF;
- prohibicion de backfill y datos de prueba;
- postchecks requeridos.

Hasta recibir esa autorizacion:

```text
NO pegar SQL.
NO ejecutar SQL Production.
NO aplicar migraciones.
NO tocar Supabase Production.
```

## 18. Confirmaciones de esta preparacion

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
- No se edito, cerro ni elimino el Ciclo 1.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y excluido.
