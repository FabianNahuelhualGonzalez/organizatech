# Fase 2.2BR - Confirmacion final pre-ejecucion SQL Production cycle-scoped

## 1. Resumen ejecutivo

Arquitectura cerro 2.2BQ y eligio solicitar una validacion operativa adicional
antes de autorizar SQL Production.

2.2BR consolida esa confirmacion final. La fase es read-only y documental:
no autoriza pegar SQL, aplicar migraciones ni escribir en Supabase.

El punto operativo sensible es que la primera migracion normaliza grants de
tablas legacy activas. Por ello, ademas de validar el catalogo final, Training
legacy debe probarse inmediatamente despues de esos postchecks.

## 2. Estado actual tras 2.2BQ

Estado aprobado:

```text
2.2BO: APTO PARA VENTANA SQL PRODUCTION
2.2BP: CERRADA Y APROBADA
2.2BQ: CERRADA Y APROBADA
Ruta de Arquitectura: validacion adicional antes de ejecutar
SQL Production: NO autorizado
Supabase write: NO autorizado
Aplicar migraciones: NO autorizado
```

Baseline aprobado:

```text
Project ref Production: lzycxltqbrtsnwfdotqw
Schema cycle-scoped parcial: no detectado
Integridad legacy: OK
Dependencias base: OK
training_cycles: 1 fila activa conocida
```

## 3. SQL Production sigue no autorizado

La creacion, revision o commit de este documento no cambia el gate.

Continua prohibido:

- ejecutar SQL Production;
- aplicar migraciones;
- escribir en Supabase Production;
- ejecutar `db push`;
- ejecutar `migration repair`;
- hacer backfill;
- activar Training Cycles;
- modificar variables Vercel;
- hacer redeploy;
- crear o modificar datos productivos.

La ejecucion requiere una autorizacion posterior, expresa y separada de
Arquitectura.

## 4. Checklist final pre-ejecucion

Todos los puntos deben confirmarse en la misma sesion inmediatamente anterior
al SQL. Una evidencia historica no sustituye este gate final.

### Ambiente

- [ ] Dashboard Supabase muestra el proyecto Production correcto.
- [ ] Project ref visible: `lzycxltqbrtsnwfdotqw`.
- [ ] El ambiente se confirma por dos senales independientes.
- [ ] No existe duda de ambiente.

### Aplicacion y feature flags

- [ ] App Production estable.
- [ ] Login Production funcional.
- [ ] Training legacy funcional.
- [ ] `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente/OFF.
- [ ] Training Cycles apagado.
- [ ] `/qa/training-cycles` bloqueado.
- [ ] Variables QA no disponibles en Production.
- [ ] No hubo cambios Vercel ni redeploy.

### Baseline Supabase

- [ ] No hubo cambios no planificados desde 2.2BO.
- [ ] Ciclo 1 sigue activo e intacto.
- [ ] Las tres tablas `training_cycle_*` siguen ausentes.
- [ ] Las columnas cycle-scoped siguen ausentes.
- [ ] Las RPCs cycle-scoped siguen ausentes.
- [ ] No existen objetos cycle-scoped parciales.
- [ ] Conteos e integridad legacy coinciden con 2.2BO.
- [ ] Dependencias base siguen disponibles.

### Artefactos y operacion

- [ ] Tres archivos exactos confirmados.
- [ ] Tres hashes SHA-256 confirmados.
- [ ] Orden obligatorio confirmado.
- [ ] SQL Editor manual confirmado como unico metodo.
- [ ] `db push` prohibido.
- [ ] `migration repair` prohibido.
- [ ] Backfill prohibido.
- [ ] Rollback/forward-fix disponible.
- [ ] Criterios de aborto aceptados.
- [ ] Operador y observador identificados.
- [ ] Ventana horaria y canal de aborto definidos.
- [ ] Autorizacion expresa de Arquitectura recibida.

Si un punto no puede marcarse, no pegar el primer archivo.

## 5. Supabase Production y project ref

Referencia aprobada:

```text
lzycxltqbrtsnwfdotqw
```

2.2BO confirmo documentalmente este project ref como Production. Debido a que
2.2BR no autoriza acceso ni escritura remota, la evidencia visual fresca debe
registrarse manualmente al abrir la futura ventana.

Evidencia requerida:

- nombre del proyecto visible;
- project ref visible;
- ambiente identificado como Production;
- fecha y hora;
- operador y observador.

Ante cualquier diferencia o ambiguedad, abortar antes de pegar SQL.

## 6. Feature flag OFF

Estado requerido:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/OFF en Production
```

El gate de codigo solo habilita el repository productivo cuando:

```ts
process.env.VERCEL_ENV === "production" &&
process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

No crear, modificar ni activar la variable durante esta fase o durante la
ventana SQL. No hacer redeploy.

## 7. Training Cycles apagado

La futura aplicacion de schema no autoriza activacion funcional.

Durante prechecks, aplicacion, postchecks y observacion:

- repository cycle-scoped OFF;
- Training legacy como ruta productiva;
- sin llamadas a las RPCs cycle-scoped;
- sin accesos funcionales a las tablas nuevas;
- sin ciclos productivos nuevos.

El marcador `plan_snapshot.source = "cycle-scoped-qa"` debe resolverse o
aceptarse explicitamente antes de una futura activacion. No bloquea el SQL con
la feature flag OFF porque ninguna RPC sera invocada.

## 8. Proteccion de Ciclo 1

Existe una fila activa conocida en `public.training_cycles`, denominada
operacionalmente Ciclo 1.

Reglas:

```text
No editar.
No cerrar.
No cancelar.
No borrar.
No usar como prueba.
No asociar plan cycle-scoped.
No asociar sesiones o entries.
No hacer backfill.
```

Las nuevas columnas de `training_cycles` son nullable. La migracion debe
tolerar el registro existente sin exigir filas en `training_cycle_*`.

Antes y despues se debe confirmar:

- mismo conteo de ciclos;
- mismo identificador, usuario y estado;
- datos preexistentes intactos;
- cero relaciones cycle-scoped nuevas.

## 9. Orden exacto de migraciones

Orden obligatorio:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

No reordenar, omitir, editar ni mezclar con SQL adicional.

Los estados posteriores al archivo 1 o a los archivos 1 y 2 son intermedios.
No activar la feature ni realizar pruebas funcionales entre archivos.

## 10. Hashes SHA-256

Hashes confirmados localmente el 6 de junio de 2026:

```text
4721A69F57289221C50AE7A08D6E199A1699152C2961D5D40B9514380F7C7AC5
  20260604_training_cycle_scoped_model.sql

28FCB2DC90DF469D2D829377471939F2E0119BE81AC51E7ADA45E2930CFFD8D1
  20260604_training_cycle_scoped_policy_fix.sql

94FD3CB3D8DF1166CB7C17ADB6E5122D58A62387AED61122E7E7C336DF82AFD5
  20260605_training_cycle_scoped_session_entries_contract.sql
```

Recalcular inmediatamente antes de ejecutar. Cualquier diferencia obliga a
abortar y solicitar nueva auditoria.

## 11. Metodo futuro: SQL Editor manual

Metodo unico solicitado:

```text
Supabase Dashboard
-> Production lzycxltqbrtsnwfdotqw
-> SQL Editor
-> ejecucion manual controlada
```

Por cada archivo registrar:

- nombre;
- hash;
- hora de inicio y fin;
- operador;
- resultado de SQL Editor.

Continuar solo ante `Success` inequivoco. Error, timeout, desconexion o estado
incierto obligan a detener la secuencia.

## 12. Prohibicion de db push

No ejecutar:

```text
supabase db push
```

No aplicar automaticamente el historial local ni resolver divergencias por
CLI.

## 13. Prohibicion de migration repair

No ejecutar:

```text
supabase migration repair
```

Si aparece un estado parcial, inventariarlo mediante consultas read-only y
solicitar autorizacion para un forward-fix o rollback auditado.

## 14. Prohibicion de backfill

La ventana futura solo agrega schema y normaliza permisos.

Resultado esperado:

```text
training_cycle_routines: 0 filas
training_cycle_days: 0 filas
training_cycle_exercises: 0 filas
training_sessions con datos cycle-scoped: 0 filas
exercise_entries con training_cycle_exercise_id: 0 filas
```

No crear ciclos, sesiones, entries ni ejercicios de prueba.

## 15. Rollback y forward-fix

Principios:

1. mantener la flag OFF;
2. detenerse ante el primer error;
3. preservar evidencia;
4. determinar la atomicidad real del archivo fallido;
5. inventariar el estado con consultas read-only;
6. no reintentar ciegamente;
7. preferir forward-fix auditado si existe estado parcial;
8. no modificar ni borrar datos;
9. no usar `db push` ni `migration repair`.

Contrato final de entries:

- retirar la constraint nueva solo con autorizacion;
- restaurar `exercise_id NOT NULL` solo si no existen valores nulos;
- restaurar RPC y policy anteriores solo mediante script auditado.

Coherencia y policies:

- retirar FKs antes de sus uniques auxiliares;
- restaurar policies desde el baseline;
- no dejar policies tautologicas como estado operativo.

Modelo base:

- no retirar tablas o columnas sin autorizacion destructiva;
- confirmar tablas vacias y columnas sin datos;
- retirar dependencias en orden inverso.

## 16. Criterios de aborto

Abortar antes de ejecutar si:

- ambiente o project ref ambiguos;
- falta autorizacion expresa;
- un hash difiere;
- feature flag configurada;
- App, login o Training legacy inestables;
- baseline distinto de 2.2BO;
- Ciclo 1 modificado;
- estado cycle-scoped parcial;
- dependencia base ausente;
- necesidad de SQL adicional o backfill.

Abortar durante la ejecucion si:

- una sentencia falla;
- SQL Editor reporta timeout;
- se pierde la conexion;
- el resultado es incierto;
- cambia un dato o conteo;
- se intenta cambiar el orden;
- se intenta activar la feature o modificar Vercel.

Abortar en postchecks si:

- cambia un conteo legacy;
- Ciclo 1 cambia;
- aparecen filas cycle-scoped;
- falta un objeto esperado;
- una constraint no esta validada;
- RLS queda deshabilitada;
- una policy es abierta o tautologica;
- `anon` conserva permisos;
- `authenticated` conserva permisos amplios;
- una RPC queda `SECURITY DEFINER`;
- Training legacy presenta regresion.

## 17. Postchecks completos

Si Arquitectura autoriza y el SQL se ejecuta en una fase posterior, completar
los controles afirmativos documentados en 2.2BQ seccion 16:

- schema, seccion 16.1;
- coherencia, seccion 16.2;
- seguridad, seccion 16.3;
- RPCs, seccion 16.4;
- datos y aplicacion, seccion 16.5.

No considerar exitosa la ventana hasta que todos esos postchecks se confirmen
y documenten sin excepciones.

## 18. Validacion inmediata de Training legacy

La migracion 1 ejecuta `REVOKE` sobre tablas legacy productivas activas:

```text
training_cycles
training_sessions
exercise_entries
```

2.2BO detecto grants amplios que la migracion normalizara. El estado final
esperado es:

```text
anon: sin permisos
authenticated: SELECT, INSERT, UPDATE
authenticated: sin DELETE, TRUNCATE, REFERENCES, TRIGGER
```

Despues de validar catalogo, RLS, policies y grants, ejecutar inmediatamente
una validacion funcional no destructiva de Training legacy:

- app carga;
- login funciona;
- Training abre;
- rutinas y ejercicios existentes son visibles;
- historial y progreso existentes cargan;
- no aparecen errores de permisos;
- no se crean ni modifican datos.

Si Training legacy falla, mantener la feature flag OFF, detener la ventana y
activar el plan de forward-fix/rollback. No continuar a activacion funcional.

## 19. Decision solicitada a Arquitectura

Se solicita una decision final:

```text
A. AUTORIZAR EJECUCION
   Autorizar los tres archivos exactos, en orden, por SQL Editor manual y con
   todos los gates y criterios de aborto de 2.2BR.

B. MANTENER SQL BLOQUEADO
   Solicitar evidencia o controles adicionales sin ejecutar SQL.

C. RECHAZAR EJECUCION
   Abrir una fase de patch o rediseno previo.
```

Una autorizacion valida para A debe nombrar:

- project ref `lzycxltqbrtsnwfdotqw`;
- archivos, hashes y orden;
- operador, observador y ventana;
- SQL Editor manual;
- proteccion de Ciclo 1;
- feature flag OFF;
- cero backfill y cero datos de prueba;
- criterios de aborto;
- postchecks de catalogo;
- validacion inmediata de Training legacy.

Hasta recibir esa autorizacion:

```text
NO pegar SQL.
NO ejecutar SQL Production.
NO aplicar migraciones.
NO tocar Supabase Production.
```

## 20. Confirmaciones de esta preparacion

- No se ejecuto SQL Production.
- No se aplicaron migraciones.
- No se toco Supabase Production.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se hizo backfill.
- No se activaron feature flags productivas.
- No se modificaron variables Vercel.
- No se hizo redeploy.
- No se crearon ciclos productivos.
- No se modificaron datos productivos.
- No se edito, cerro ni elimino el Ciclo 1.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y excluido.
