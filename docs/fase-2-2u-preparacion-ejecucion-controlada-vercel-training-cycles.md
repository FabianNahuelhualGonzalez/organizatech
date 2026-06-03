# Fase 2.2U - Preparacion ejecucion controlada Vercel Training Cycles

## 1. Contexto

Estado confirmado:

- Fase 2.2P cerrada.
- Fase 2.2Q cerrada.
- Fase 2.2R cerrada.
- Fase 2.2S cerrada.
- Fase 2.2T cerrada.
- `public.training_cycles` existe en Produccion.
- `public.training_cycles` esta vacia o en estado esperado antes de la prueba.
- Codigo 2.2S versionado en commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
- Feature flag productiva OFF.
- Vercel Production sin tocar.
- Produccion sigue bloqueada.

Estado local revisado:

```text
Rama actual: feature/training-sessions-fuente-verdad
HEAD actual: f132ad6 docs: plan fase 2.2T vercel training cycles activation
Commit 2.2S presente en historial local: 20a6765 feat: prepare controlled production training cycles UI gating
```

Esta fase solo prepara la ejecucion controlada. No toca Vercel, no activa feature flag y no crea ciclos productivos.

## 2. Objetivo

Preparar la ejecucion controlada de despliegue y activacion en Vercel para Training Cycles, sin ejecutar todavia.

La fase futura debera confirmar deployment, ambiente, variable server-side, redeploy, postchecks y rollback antes de exponer el repository de ciclos a Produccion.

## 3. Decision de usuario de validacion

Arquitectura recomienda usar:

```text
Usuario productivo real controlado: Fabian Nahuelhual
```

Justificacion:

- La validacion funcional creara datos reales y permanentes en `public.training_cycles`.
- No conviene crear datos basura con una cuenta de prueba si no habra rollback DB.
- Los ciclos creados deben tener sentido real para el usuario.

Ciclo funcional previsto:

```text
Nuevo microciclo
Tipo: microciclo
Objetivo: descarga
Duracion: 1 semana
Estado: active
```

Decision pendiente:

- Arquitectura debe aceptar explicitamente la disposicion de los ciclos creados durante la validacion.
- No se debe borrar ningun ciclo creado sin autorizacion separada.

## 4. Confirmaciones necesarias antes de ejecutar

Antes de ejecutar 2.2U se debe confirmar:

- Si el codigo `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26` esta en `main` o requiere merge.
- Si hay PR pendiente o necesario.
- Deployment exacto que usara Vercel Production.
- Que el deployment contiene el commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
- Que Vercel Environment es `Production`.
- Que `ENABLE_TRAINING_CYCLES_REPOSITORY` esta OFF / no configurada antes de activacion.
- Que `public.training_cycles` existe y esta vacia o en estado esperado.
- Que Vercel Production aun no fue tocado.
- Que `training_sessions` mantiene baseline esperado o diferencia justificada.
- Que `exercise_entries` mantiene baseline esperado o diferencia justificada.

Confirmaciones pendientes por restriccion de esta fase:

- No se confirma si el codigo esta en `main`, porque no se ejecutaron acciones remotas.
- No se confirma deployment Vercel, porque no se uso Vercel CLI/API/dashboard.
- No se confirma estado real de variables Vercel, porque no se toco Vercel.
- No se confirma baseline remoto actual, porque no se ejecuto SQL.

## 5. Importante

Si alguna confirmacion requiere consultar Vercel, debe quedar pendiente para la fase de ejecucion aprobada.

En esta fase de preparacion:

- No se debe tocar Vercel.
- No se debe usar Vercel CLI.
- No se debe usar API de Vercel.
- No se debe usar dashboard de Vercel.
- No se debe ejecutar redeploy.
- No se debe activar feature flag.

## 6. Variable productiva

Variable exacta:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

Valor para habilitar:

```text
true
```

Variable que no debe usarse:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY
```

Motivo:

- Fase 2.2S decidio usar feature flag server-side.
- `src/app/page.tsx` evalua `process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"`.
- Al ser server-side, requiere redeploy para tomar efecto.

Condicion de activacion productiva:

```text
VERCEL_ENV === "production"
ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

## 7. Flujo futuro propuesto

Gate obligatorio antes de cualquier operacion en Vercel:

```text
1. Confirmar si el codigo 20a67651 esta en main o requiere merge.
2. Confirmar deployment Production con ese codigo.
```

Ningun paso posterior puede iniciarse hasta que estos dos puntos esten confirmados. No se puede configurar variable, ejecutar redeploy ni validar UI si el commit correcto no esta en el deployment Production.

Flujo propuesto para una fase futura aprobada:

1. Validar si `20a67651` debe mergearse a `main`.
2. Confirmar deployment Production con ese codigo.
3. Confirmar que la app productiva funciona con feature flag OFF.
4. Confirmar baseline inicial de `training_cycles`.
5. Confirmar baseline inicial de `training_sessions`.
6. Confirmar baseline inicial de `exercise_entries`.
7. Configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo con autorizacion explicita.
8. Ejecutar redeploy productivo.
9. Validar app.
10. Validar login.
11. Validar modulo Training.
12. Ejecutar validacion funcional real con usuario Fabian Nahuelhual.
13. Crear microciclo real de descarga.
14. Confirmar `source = ui-main-production`.
15. Confirmar `/qa/training-cycles` bloqueado en Production.
16. Confirmar `training_sessions` sin cambios inesperados.
17. Confirmar `exercise_entries` sin cambios inesperados.
18. Capturar evidencia.
19. Mantener rollback UI disponible durante toda la ventana.

No ejecutar este flujo en la fase documental 2.2U.

## 8. Postchecks futuros

Postchecks requeridos:

- App carga.
- Login funciona.
- Training carga.
- `trainingCyclesRepositoryEnabled` activo en Production.
- Crear ciclo activo real.
- Finalizar ciclo si corresponde.
- Crear siguiente microciclo si corresponde.
- Historial visible.
- `public.training_cycles` registra datos esperados.
- `source = ui-main-production`.
- No aparecen mensajes "en QA".
- `/qa/training-cycles` devuelve "Acceso bloqueado" en Production.
- RLS mantiene aislamiento por usuario.
- Si es posible verificar con segundo usuario: usuario B no ve ciclos de usuario A.
- Si no es posible verificar segundo usuario durante esta ventana: diferir a fase posterior documentada y mantener evidencia de RLS previa.
- `training_sessions` sin cambios inesperados.
- `exercise_entries` sin cambios inesperados.
- Mobile OK.

Nota RLS:

```text
La validacion con usuario real Fabian Nahuelhual no reemplaza completamente una prueba multiusuario, aunque repository y RLS ya fueron validados en fases anteriores.
```

Nota:

```text
Crear ciclo activo, finalizar ciclo y crear siguiente microciclo producen datos reales y permanentes en public.training_cycles.
```

## 9. Baselines esperados

Baselines esperados antes de prueba funcional:

```text
public.training_cycles: vacia o estado esperado antes de prueba
training_sessions = 36 / 11 / 25, salvo cambios funcionales justificados
exercise_entries = 78 / 11, salvo cambios funcionales justificados
```

Si alguno difiere, abortar o documentar justificacion antes de activar.

## 10. Datos permanentes

La validacion funcional creara datos reales permanentes en:

```text
public.training_cycles
```

Reglas:

- No asumir rollback DB.
- No borrar ciclos creados sin autorizacion explicita separada.
- No ejecutar `DROP`.
- No ejecutar SQL no autorizado.
- La disposicion de esos ciclos debe quedar aceptada por Arquitectura.
- El rollback UI puede ocultar ciclos desde la app, pero no los borra ni modifica en base de datos.

## 11. Rollback UI

Rollback UI futuro:

1. Apagar o remover `ENABLE_TRAINING_CYCLES_REPOSITORY`.
2. Redeploy para que la variable server-side tome efecto.
3. Confirmar `trainingCyclesRepositoryEnabled=false`.
4. Confirmar fallback legacy activo o bloqueo anterior.
5. No borrar `public.training_cycles`.
6. No borrar ciclos creados.
7. No tocar `training_sessions`.
8. No tocar `exercise_entries`.
9. No ejecutar `supabase db push`.
10. No ejecutar `supabase migration repair`.

Rollback DB:

- No esta autorizado.
- Debe requerir aprobacion separada si alguna vez se propone.

## 12. Criterios de aborto

Abortar si:

- Codigo `20a67651` no esta en deployment correcto.
- No se puede confirmar ambiente Production.
- Feature flag aparece activa antes de autorizacion.
- Vercel ya fue tocado sin autorizacion.
- `public.training_cycles` no existe.
- `public.training_cycles` no esta vacia o no esta en estado esperado.
- No se acepta usar usuario productivo real.
- No se confirma disposicion de datos permanentes.
- Redeploy falla.
- App no carga.
- Training no carga.
- No se crea ciclo.
- `source` no es `ui-main-production`.
- `/qa/training-cycles` queda accesible en Production.
- Cambios inesperados en `training_sessions`.
- Cambios inesperados en `exercise_entries`.
- Hay duda de ambiente.

## 13. Evidencia requerida

Evidencia requerida:

- Commit desplegado.
- Deployment Production identificado.
- Estado inicial de feature flag.
- Estado inicial de `training_cycles`.
- Estado inicial de `training_sessions`.
- Estado inicial de `exercise_entries`.
- Evidencia de variable configurada.
- Evidencia de redeploy.
- Evidencia de app/login/Training.
- Evidencia de ciclo creado.
- Evidencia de `source = ui-main-production`.
- Evidencia de helper QA bloqueado.
- Evidencia de fallback/rollback si aplica.
- Confirmacion de no `supabase db push`.
- Confirmacion de no `supabase migration repair`.
- Confirmacion de no SQL no autorizado.

## 14. Riesgos

Riesgos consolidados:

- Autodeployment al mergear a `main`.
- Commit `20a67651` podria no estar en Production al momento de ejecucion.
- La validacion funcional crea datos permanentes en `public.training_cycles`.
- Rollback UI oculta funcionalidad, pero no borra datos.
- Variable server-side requiere redeploy para activacion y rollback.
- Vercel o ambiente equivocado podria exponer comportamiento fuera de ventana o no activar el comportamiento esperado.

## 15. Recomendacion TI preliminar

Recomendacion:

```text
No ejecutar 2.2U hasta que Arquitectura otorgue aprobacion explicita para tocar Vercel, configurar ENABLE_TRAINING_CYCLES_REPOSITORY, redeploy y crear el microciclo real con usuario Fabian Nahuelhual.
```

Orden recomendado:

1. Confirmar PR/main/deployment sin ambiguedad.
2. Confirmar Production.
3. Confirmar flag OFF.
4. Confirmar baselines.
5. Activar flag solo con aprobacion.
6. Redeploy.
7. Validar funcionalmente.
8. Documentar evidencia.
9. Mantener rollback UI listo.

Este documento no autoriza tocar Vercel, usar Vercel CLI/API/dashboard, hacer redeploy, activar feature flag, ejecutar SQL, tocar Supabase remoto, modificar base de datos, crear ciclos productivos ni exponer Training Cycles a usuarios finales.
