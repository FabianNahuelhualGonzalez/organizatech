# Fase 2.2CG - Preparacion de activacion funcional Training Cycles Production

## 1. Resumen ejecutivo

2.2CG prepara la activacion funcional controlada de Training Cycles en Production.

Esta fase no activa la feature flag, no toca Vercel, no ejecuta SQL adicional,
no crea ciclos productivos y no modifica datos productivos. Su objetivo es dejar
documentados los gates, la estrategia de primera prueba, los postchecks y el
rollback antes de pedir una autorizacion separada para activar:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY=true
```

La activacion real queda bloqueada hasta una decision posterior de Arquitectura.

## 2. Estado heredado de 2.2CF

2.2CF quedo cerrada y aprobada con este estado:

```text
Patch SQL Production: OK
RPC create_training_cycle_with_plan: actualizada
SECURITY INVOKER: preservado
plan_snapshot.source = "cycle-scoped": OK
Marcador externo "cycle-scoped-qa": removido para nuevos ciclos
Ciclo 1 productivo: intacto
training_cycles_count: 1
Training Cycles Production: apagado
Feature flag productiva: no activada
Datos productivos: sin cambios manuales
```

Evidencia aceptada:

```text
Supabase Production confirmado visualmente.
Project ref Production: lzycxltqbrtsnwfdotqw.

Patch ejecutado:
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql

Hash SHA-256:
5B62073B820D1C974F0792EE816CBA2B4A76A1041B53B76F21F350184045E915

Resultado SQL:
Success. No rows returned.
```

Observacion tecnica no bloqueante:

```text
PUBLIC EXECUTE
postgres EXECUTE
```

No modificar grants dentro de 2.2CG. Cualquier normalizacion adicional de grants
debe requerir autorizacion separada.

## 3. Estado final Production esperado antes de activacion

Antes de activar funcionalmente Training Cycles, Production debe mantenerse asi:

- Production deployment `READY`.
- App productiva estable.
- Login productivo operativo.
- Training legacy operativo.
- `/qa/training-cycles` bloqueado en Production.
- Training Cycles Production no expuesto.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente/OFF.
- Sin llamadas cycle-scoped inesperadas.
- `training_cycles_count = 1`.
- Ciclo 1 productivo intacto.

## 4. RPC Production esperada

La RPC esperada tras 2.2CF es:

```text
public.create_training_cycle_with_plan
```

Condiciones esperadas:

- existe en schema `public`;
- mantiene `SECURITY INVOKER`;
- no usa `SECURITY DEFINER`;
- crea nuevos ciclos con:

```text
plan_snapshot.source = "cycle-scoped"
```

- ya no usa `"cycle-scoped-qa"` como marcador externo nuevo;
- mantiene separado el payload anidado:

```text
plan_snapshot.plan.source = "ui-main-production"
```

para ciclos creados desde la app productiva.

## 5. Training legacy

Training legacy debe seguir funcionando antes y despues de cualquier activacion.

Validaciones esperadas:

- app productiva carga;
- login funciona;
- Training legacy carga;
- rutinas y entrenamientos legacy existentes siguen visibles;
- no aparecen errores criticos visuales;
- no se pierde acceso a datos legacy.

Si Training legacy falla, abortar la activacion y mantener Training Cycles apagado.

## 6. Training Cycles Production apagado

Estado requerido antes de cualquier activacion:

```text
Training Cycles Production: apagado
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/OFF
```

No se debe activar la flag ni crear/modificar variables Vercel dentro de esta fase.

## 7. Usuario recomendado de primera prueba

Usuario recomendado:

```text
Fabian, solo si Arquitectura autoriza usar la cuenta real productiva.
```

Advertencias obligatorias:

- No usar Ciclo 1 como prueba.
- No cerrar Ciclo 1.
- No modificar Ciclo 1.
- No borrar Ciclo 1.
- No crear ciclo productivo hasta autorizacion posterior.
- No crear usuario/cuenta productiva de prueba sin autorizacion separada.

Si Arquitectura prefiere no usar la cuenta real productiva, debe autorizar una
cuenta productiva controlada y documentar su alcance antes de activar.

## 8. Estrategia productiva recomendada

Estrategia propuesta, solo para una fase posterior autorizada:

1. Activar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo con autorizacion posterior.
2. Esperar deployment/redeploy Production autorizado.
3. Confirmar app/login/Training legacy OK.
4. Confirmar que Training Cycles aparece solo donde corresponde.
5. Crear maximo un ciclo productivo controlado, solo si se autoriza.
6. Validar SQL:

```text
training_cycles_count aumenta exactamente segun lo autorizado.
nuevo ciclo plan_snapshot.source = "cycle-scoped".
nuevo ciclo plan_snapshot.plan.source = "ui-main-production".
Ciclo 1 no cambia.
```

7. Registrar maximo un entrenamiento productivo controlado solo si Arquitectura
   lo autoriza.

## 9. Checklist de activacion Vercel

Checklist previo, sin ejecutar en 2.2CG:

- [ ] Confirmar Vercel Production correcto.
- [ ] Confirmar Production deployment actual `READY`.
- [ ] Confirmar `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente/OFF antes de la ventana.
- [ ] Confirmar que `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta disponible para Production.
- [ ] Confirmar que `NEXT_PUBLIC_SUPABASE_ENV` no esta disponible para Production ni `qa`.
- [ ] Confirmar Supabase Production correcto.
- [ ] Confirmar app productiva estable.
- [ ] Confirmar Training legacy estable.
- [ ] Confirmar Ciclo 1 intacto.
- [ ] Confirmar autorizacion explicita de Arquitectura para tocar Vercel.
- [ ] Configurar o activar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo si se autoriza.
- [ ] Ejecutar deployment/redeploy Production solo si se autoriza.
- [ ] Confirmar target Production y commit esperado.
- [ ] Ejecutar smoke test Productivo.

## 10. Postchecks UI

Postchecks UI a preparar para una activacion posterior:

- App productiva carga.
- Login funciona.
- Training legacy carga.
- Training Cycles aparece solo si la flag esta activa.
- No aparece error visual critico.
- Ciclo 1 no se modifica ni se cierra.
- `/qa/training-cycles` sigue bloqueado en Production.
- No aparece informacion QA ni rutas QA expuestas.

## 11. Postchecks Network

Antes de activar:

- sin llamadas cycle-scoped inesperadas;
- sin llamadas a RPCs cycle-scoped durante Training legacy;
- sin errores de schema/RPC por feature flag apagada.

Despues de activar, solo si se autoriza prueba funcional:

- llamadas cycle-scoped solo durante flujo autorizado;
- no llamadas duplicadas inesperadas;
- no fallback legacy silencioso durante flujo cycle-scoped;
- no llamadas a Supabase QA desde Production.

## 12. Postchecks SQL

Postchecks SQL read-only a preparar para una fase posterior:

```sql
select count(*) as training_cycles_count
from public.training_cycles;
```

```sql
select
  id,
  cycle_number,
  status,
  created_at,
  updated_at,
  plan_snapshot ->> 'source' as outer_source,
  plan_snapshot -> 'plan' ->> 'source' as inner_source
from public.training_cycles
order by created_at asc;
```

Validaciones esperadas:

- `training_cycles_count` antes/despues coincide con la cantidad autorizada.
- Ciclo 1 conserva mismo `id`, `status`, `created_at` y `updated_at`.
- Nuevo ciclo productivo, si se autoriza, tiene:

```text
plan_snapshot.source = "cycle-scoped"
plan_snapshot.plan.source = "ui-main-production"
```

Si se autoriza registrar un entrenamiento productivo controlado:

```text
training_sessions.cycle_id != null
training_sessions.cycle_day_id != null
exercise_entries.training_cycle_exercise_id != null
exercise_entries.exercise_id = null
```

No hacer backfill ni editar datos manualmente para cumplir estos postchecks.

## 13. Rollback funcional

Rollback funcional recomendado, solo con autorizacion posterior:

1. Apagar/remover `ENABLE_TRAINING_CYCLES_REPOSITORY`.
2. Redeploy Production solo si Arquitectura lo autoriza.
3. Confirmar app/login/Training legacy OK.
4. Confirmar Training Cycles apagado.
5. No borrar ciclos productivos creados sin autorizacion separada.
6. No tocar Ciclo 1.

Si se creo un ciclo productivo controlado durante una prueba autorizada, mantenerlo
como evidencia salvo que Arquitectura autorice una accion especifica posterior.

## 14. Criterios de aborto

Abortar si:

- feature flag aparece activa antes de autorizacion;
- Production no esta `READY`;
- login falla;
- Training legacy falla;
- `/qa/training-cycles` no esta bloqueado antes de activar;
- Ciclo 1 cambia;
- se crean ciclos no autorizados;
- Network muestra llamadas cycle-scoped inesperadas antes de activar;
- Vercel requiere cambios no autorizados;
- Supabase Production no puede confirmarse;
- `ENABLE_TRAINING_CYCLES_REPOSITORY` no puede controlarse de forma segura;
- aparece cualquier indicio de Supabase QA en Production;
- se requiere SQL adicional no autorizado;
- se requiere modificar grants;
- se requiere `db push` o `migration repair`.

## 15. Riesgos

| Riesgo | Impacto | Control |
| --- | --- | --- |
| Activar flag sin ventana autorizada | Exponer flujo cycle-scoped productivo antes de completar gates | Mantener flag OFF hasta autorizacion separada |
| Usar Ciclo 1 como prueba | Alteracion de dato productivo existente | Prohibicion explicita y postcheck de Ciclo 1 |
| Crear mas de un ciclo productivo | Contaminacion productiva innecesaria | Maximo un ciclo, solo si se autoriza |
| Mezcla QA/Production por variables publicas | Riesgo de entorno cruzado | Confirmar QA vars fuera de Production |
| Falla Training legacy tras redeploy | Regresion productiva | Smoke test inmediato y rollback funcional |
| Duplicados en guardado cycle-scoped | Datos productivos duplicados | Network/postchecks SQL y prueba acotada |

## 16. Restricciones vigentes

No autorizado en 2.2CG:

- activar Training Cycles Production;
- activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- crear/modificar variables Vercel;
- redeploy manual;
- crear ciclos productivos;
- crear usuario/cuenta productiva de prueba;
- backfill;
- modificar/borrar/cerrar Ciclo 1;
- tocar datos productivos manualmente;
- SQL Production adicional;
- Supabase write adicional;
- `db push`;
- `migration repair`;
- modificar grants.

## 17. Decision solicitada a Arquitectura

Se solicita a Arquitectura decidir en una fase posterior:

```text
A) Autorizar activacion funcional controlada en Production.
B) Solicitar auditoria adicional antes de activar.
C) Mantener Training Cycles Production apagado.
```

Si se autoriza A, la autorizacion debe especificar:

- si se usara la cuenta real de Fabian o una cuenta productiva controlada;
- si se permite crear un unico ciclo productivo controlado;
- si se permite registrar un entrenamiento productivo controlado;
- quien ejecuta el cambio de variable Vercel;
- si se autoriza redeploy Production;
- que evidencia debe capturarse;
- que rollback queda disponible.

Recomendacion tecnica:

```text
Mantener Training Cycles apagado hasta tener autorizacion explicita para
Vercel/feature flag/redeploy y para la creacion de maximo un ciclo productivo
controlado. No usar Ciclo 1 como prueba.
```
