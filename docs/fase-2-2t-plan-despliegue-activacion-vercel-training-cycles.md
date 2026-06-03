# Fase 2.2T - Plan de despliegue y activacion Vercel Training Cycles

## 1. Contexto

Estado de fases previas:

- Fase 2.2P ejecutada correctamente.
- Fase 2.2Q cerrada y aprobada.
- Fase 2.2R cerrada y aprobada.
- Fase 2.2S cerrada y aprobada.
- `public.training_cycles` existe en Produccion.
- `public.training_cycles` esta vacia.
- Codigo 2.2S versionado en commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
- Feature flag productiva OFF.
- Produccion sigue bloqueada.
- Vercel no fue tocado.
- No se crearon ciclos productivos.

Esta fase prepara el despliegue y activacion controlada en Vercel. No ejecuta ningun cambio remoto.

## 2. Objetivo

Preparar el plan completo de despliegue y activacion controlada en Vercel para Training Cycles, sin ejecutar todavia.

La fase futura debera confirmar que el codigo correcto esta desplegado, configurar la variable server-side solo con aprobacion explicita, ejecutar redeploy si corresponde y validar funcionalmente la UI productiva.

## 3. Decision pendiente

Arquitectura debe definir el flujo exacto antes de ejecutar:

- Abrir PR desde `feature/training-sessions-fuente-verdad`.
- Validar Preview.
- Mergear a `main`.
- Desplegar Produccion desde `main`.
- Configurar variable server-side en Vercel Production.
- Ejecutar redeploy productivo para tomar la variable.
- O usar otro flujo formal aprobado.

Decision pendiente principal:

```text
Definir si el commit 20a67651 debe validarse primero en Preview antes de cualquier merge/despliegue productivo.
```

Decision pendiente sobre cuenta de prueba:

```text
Definir si la validacion funcional productiva se ejecutara con un usuario productivo real o con una cuenta de prueba dedicada.
```

Tambien se debe definir la disposicion esperada de los ciclos creados durante la validacion, porque los postchecks funcionales generan registros reales y permanentes en `public.training_cycles`.

## 4. Deployment Vercel

Hallazgos locales:

- `package.json` define `build` como `next build`.
- No existe `vercel.json` en el repo local.
- El codigo productivo de gating esta en `src/app/page.tsx`.
- El gating productivo depende de `process.env.VERCEL_ENV === "production"`.
- El gating productivo depende de `process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"`.
- La variable es server-side, por lo que requiere que el deployment la incorpore al ejecutar/build/renderizar la app.

Puntos a confirmar antes de ejecutar:

- Que deployment Vercel contiene el commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
- Si el commit ya existe en Preview.
- Si Production requiere merge a `main`.
- Si el proyecto usa deploy automatico al mergear.
- Confirmar redeploy productivo para que el Server Component use el nuevo valor de `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Que no se este usando `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`.

Riesgo:

```text
Mergear a main podria disparar deployment automatico segun configuracion Vercel.
```

## 5. Feature flag productiva

Variable exacta:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

Valor esperado para habilitar:

```text
true
```

Estado actual esperado:

```text
no definida / false / OFF
```

Variable que no debe usarse:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY
```

Motivo:

- La decision 2.2S fue usar flag server-side.
- El cliente solo recibe `trainingCyclesRepositoryEnabled` ya resuelto.
- No se requiere exponer la flag al bundle publico.

## 6. Plan de activacion futuro

Plan propuesto para fase futura aprobada:

1. Confirmar que el deployment objetivo contiene commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
2. Confirmar que la app productiva opera normalmente con feature flag OFF.
3. Confirmar baseline productivo antes de activar.
4. Confirmar que `ENABLE_TRAINING_CYCLES_REPOSITORY` no esta definida o esta en `false`.
5. Configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo con aprobacion explicita.
6. Ejecutar redeploy productivo para que la variable server-side tome efecto.
7. Confirmar que app productiva carga.
8. Confirmar login.
9. Confirmar Training.
10. Ejecutar flujo funcional controlado de ciclos.
11. Capturar evidencia.
12. Mantener rollback listo durante toda la ventana.

No ejecutar este plan en 2.2T.

## 7. Postchecks productivos futuros

Postchecks requeridos para una futura fase de ejecucion:

- App carga.
- Login funciona.
- Training carga.
- Crear ciclo activo.
- Finalizar ciclo.
- Crear siguiente microciclo.
- Historial visible.
- `public.training_cycles` registra el ciclo correcto.
- `source = ui-main-production`.
- RLS mantiene aislamiento por usuario.
- Usuario B no ve ciclos de usuario A.
- `training_sessions` sin cambios inesperados.
- `exercise_entries` sin cambios inesperados.
- No aparecen mensajes "en QA".
- `/qa/training-cycles` devuelve "Acceso bloqueado" en ambiente Production.
- Mobile OK.
- Logs sin errores RLS inesperados.

Advertencia sobre datos permanentes:

Los postchecks funcionales:

```text
Crear ciclo activo
Finalizar ciclo
Crear siguiente microciclo
```

producen registros reales y permanentes en:

```text
public.training_cycles
```

No se debe asumir que la prueba funcional es reversible a nivel de base de datos. El rollback UI apaga la visibilidad desde la app, pero no elimina datos de `public.training_cycles`. El rollback DB no esta autorizado en 2.2T ni debe asumirse autorizado en la futura ejecucion 2.2U.

## 8. Baselines esperados antes de activacion

Baselines esperados antes de prueba funcional:

```text
training_cycles_count = 0
training_sessions = 36 / 11 / 25
exercise_entries = 78 / 11
```

Si `training_sessions` o `exercise_entries` cambian por uso funcional normal antes de la ventana, se debe registrar el nuevo baseline y justificar la diferencia antes de activar.

## 9. Rollback

Rollback funcional:

1. Remover `ENABLE_TRAINING_CYCLES_REPOSITORY` o setearla en `false`.
2. Ejecutar redeploy para que el apagado de la variable server-side tome efecto.
3. Confirmar que `trainingCyclesRepositoryEnabled` vuelve a `false`.
4. Confirmar fallback legacy activo o bloqueo productivo anterior.
5. No borrar `public.training_cycles`.
6. No borrar ciclos ya creados.
7. No tocar `training_sessions`.
8. No tocar `exercise_entries`.
9. No ejecutar `supabase db push`.
10. No ejecutar `supabase migration repair`.

Nota:

```text
Si se apaga la flag despues de crear ciclos productivos, esos ciclos quedarian inaccesibles desde la UI mientras la flag este OFF, pero no se borrarian ni modificarian en base de datos.
```

Rollback DB:

- No esta autorizado en 2.2T.
- No debe asumirse autorizado en la futura ejecucion 2.2U.
- No ejecutar `DROP`.
- No eliminar ciclos creados por validacion funcional sin aprobacion explicita separada.
- La estrategia de disposicion de ciclos de prueba debe decidirla Arquitectura antes de ejecutar.

## 10. Criterios de aborto

Abortar si:

- No se puede identificar deployment correcto.
- El codigo `20a67651` no esta desplegado.
- Variable productiva no es confirmable.
- Vercel env no es Production.
- Redeploy falla.
- App no carga.
- Training no carga.
- Error al crear ciclo.
- RLS falla.
- Aparecen mensajes "en QA".
- `source` no es `ui-main-production`.
- Arquitectura no definio usuario real vs cuenta de prueba dedicada.
- No esta definida la disposicion esperada de ciclos creados durante validacion.
- Hay duda de ambiente.
- Cualquier cambio inesperado en `training_sessions`.
- Cualquier cambio inesperado en `exercise_entries`.
- Helper QA queda accesible en Produccion.
- Se requiere SQL no autorizado.

## 11. Evidencia requerida

Evidencia requerida para futura activacion:

- Commit desplegado.
- Deployment Vercel identificado.
- Estado de variable antes de activar.
- Estado de variable despues de activar, sin exponer secretos.
- Resultado de redeploy si aplica.
- Capturas o logs de postchecks.
- Confirmacion de `source = ui-main-production`.
- Confirmacion de RLS.
- Confirmacion de no cambios inesperados en `training_sessions`.
- Confirmacion de no cambios inesperados en `exercise_entries`.
- Confirmacion de no `supabase db push`.
- Confirmacion de no `supabase migration repair`.
- Confirmacion de no SQL no autorizado.
- Decision de Arquitectura sobre usuario productivo real vs cuenta de prueba dedicada.
- Decision de Arquitectura sobre disposicion esperada de ciclos creados durante la validacion.
- Confirmacion de rollback disponible.

## 12. Riesgos

Riesgos identificados:

- Feature flag server-side requiere redeploy para tomar efecto.
- Rollback puede ocultar ciclos productivos desde UI, pero no borrarlos.
- Flujo real de usuario debe validarse con cuidado.
- Los postchecks funcionales producen registros reales y permanentes en `public.training_cycles`.
- Merge a `main` puede disparar deployment automatico segun configuracion Vercel.
- Si el deployment no contiene `20a67651`, la flag no tendra el comportamiento esperado.
- Si se activa la flag en el ambiente incorrecto, podria exponerse funcionalidad fuera de ventana.

## 13. Recomendacion TI preliminar

Recomendacion:

```text
No activar ENABLE_TRAINING_CYCLES_REPOSITORY hasta confirmar deployment exacto, ambiente Production, baseline vigente y rollback operativo.
```

Flujo recomendado:

1. Abrir o revisar PR con commit `20a67651`.
2. Validar Preview si Arquitectura lo solicita.
3. Confirmar si merge a `main` dispara Production.
4. Confirmar deployment productivo con commit correcto.
5. Solicitar aprobacion separada para configurar variable y redeploy.
6. Ejecutar fase futura de activacion con postchecks y rollback.

Nota sobre Preview:

```text
La validacion en Preview escribe en Supabase QA y no afecta la base de datos de Produccion.
```

## 14. Proximo paso recomendado

Solicitar a Arquitectura aprobacion para una fase posterior:

```text
Fase 2.2U - Despliegue y activacion controlada en Vercel
```

o alternativamente:

```text
Fase 2.2T-Ejecucion - Despliegue/activacion controlada en Vercel
```

La fase futura debe autorizar explicitamente:

- tocar Vercel;
- identificar deployment;
- configurar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- redeploy si corresponde;
- ejecutar postchecks productivos;
- activar rollback si falla.

Este documento no autoriza tocar Vercel, hacer redeploy, activar feature flag, ejecutar SQL, tocar Supabase remoto, crear ciclos productivos ni exponer Training Cycles a usuarios finales.
