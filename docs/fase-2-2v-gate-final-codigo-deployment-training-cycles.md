# Fase 2.2V - Gate final codigo/deployment Training Cycles

## 1. Contexto

Estado confirmado por Arquitectura:

- Fase 2.2P cerrada.
- Fase 2.2Q cerrada.
- Fase 2.2R cerrada.
- Fase 2.2S cerrada.
- Fase 2.2T cerrada.
- Fase 2.2U cerrada.
- `public.training_cycles` existe y esta vacia o en estado esperado.
- Codigo 2.2S versionado en commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26`.
- Feature flag productiva OFF.
- Vercel Production sin tocar.
- Produccion sigue bloqueada.

Esta fase es solo diagnostico y preparacion. No autoriza PR, merge, Vercel, redeploy, feature flag ni ejecucion productiva.

## 2. Objetivo

Confirmar el gate final de codigo y deployment antes de cualquier activacion productiva de Training Cycles.

El objetivo es determinar que se puede confirmar localmente y que debe quedar pendiente para GitHub/Vercel antes de activar:

- si el commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26` esta en `main`;
- si la rama `feature/training-sessions-fuente-verdad` requiere PR/merge;
- que commit esta en Production;
- si activar la flag requiere merge previo;
- si existe autodeploy al mergear `main`;
- cual es el rollback si Production queda con codigo incorrecto.

## 3. Estado local de Git

Comandos locales de solo lectura ejecutados:

```text
git status --short --branch
git branch --show-current
git log --oneline --decorate --graph -n 30
git branch --contains 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26
git merge-base --is-ancestor 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26 main
git merge-base --is-ancestor 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26 origin/main
git log origin/main --oneline -5
```

Resultado local:

```text
Rama actual: feature/training-sessions-fuente-verdad
HEAD actual: b6e1fc9 docs: prepare fase 2.2U controlled vercel activation
Estado remoto local: feature/training-sessions-fuente-verdad alineada con origin/feature/training-sessions-fuente-verdad
Untracked local: supabase/.temp/
```

El commit `20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26` esta en el historial local de la rama feature:

```text
20a6765 feat: prepare controlled production training cycles UI gating
```

`git branch --contains 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26` devolvio:

```text
* feature/training-sessions-fuente-verdad
```

`git merge-base --is-ancestor 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26 main` devolvio:

```text
ancestor=false
```

`git merge-base --is-ancestor 20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26 origin/main` devolvio:

```text
ancestor=false
```

`git log origin/main --oneline -5` devolvio:

```text
f6c00eb Merge pull request #28 from FabianNahuelhualGonzalez/feature/training-sessions-fuente-verdad
11a7f07 Documentar plan productivo Training Cycles
5cd9d2a Merge pull request #27 from FabianNahuelhualGonzalez/feature/training-sessions-fuente-verdad
68bd997 Mejorar resumen visual de ciclos Training
29e17de Merge pull request #26 from FabianNahuelhualGonzalez/feature/training-sessions-fuente-verdad
```

Interpretacion local:

- `20a67651` esta contenido en la rama local `feature/training-sessions-fuente-verdad`.
- `20a67651` no aparece como ancestro de `main` local.
- `20a67651` no aparece como ancestro de `origin/main` cacheado.
- `origin/main` existe como referencia local cacheada, pero su historial visible localmente no muestra `20a67651`.
- `main` local existe, pero no se actualizo en esta fase.
- No se hizo `fetch`, `pull`, consulta a GitHub ni accion remota.
- Con evidencia local actual, la rama feature parece requerir PR/merge antes de que `main` contenga el codigo 2.2S.

Limitacion:

```text
No se puede afirmar el estado real de GitHub/main remoto sin consultar remoto. Esa verificacion queda pendiente.
```

## 4. Estado remoto/GitHub

Confirmable localmente:

- La rama actual es `feature/training-sessions-fuente-verdad`.
- La rama local contiene el commit `20a67651`.
- `main` local no contiene `20a67651` segun `merge-base`.
- El ultimo commit local/remoto de la feature es `b6e1fc9`.

Pendiente de confirmar en GitHub:

```text
Pendiente: confirmar en GitHub si commit 20a67651 esta en main o si requiere PR/merge.
```

Tambien queda pendiente:

- si ya existe PR abierto;
- si se requiere abrir PR;
- si la PR requiere aprobacion previa;
- si mergear a `main` dispara autodeploy en Vercel;
- si `main` remoto difiere de `main` local.

Restricciones:

- No abrir PR.
- No mergear.
- No hacer fetch.
- No hacer pull.
- No hacer push.

## 5. Estado Vercel Production

No se toco Vercel en esta fase.

No se uso:

- Vercel CLI.
- Vercel API.
- Vercel dashboard.
- Redeploy.
- Cambio de variables.

Estado pendiente:

```text
Pendiente: confirmar en Vercel Production que commit esta desplegado.
```

No se debe activar `ENABLE_TRAINING_CYCLES_REPOSITORY` si Production no corre el commit correcto:

```text
20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26
```

o un commit posterior que lo contenga.

## 6. Gate obligatorio

Ningun paso de activacion puede iniciar hasta confirmar:

1. Confirmar `main` remoto.
2. Ejecutar PR/merge si es necesario y solo con autorizacion explicita.
3. Confirmar deployment Production exacto.
4. Confirmar ambiente Vercel Production correcto y feature flag OFF.
5. Solo despues solicitar activacion de flag + redeploy.

Cadena causal obligatoria:

```text
Confirmar main remoto -> PR/merge si es necesario -> confirmar deployment Production -> confirmar flag OFF -> solicitar flag + redeploy.
```

No se pueden saltar pasos. Si el commit correcto no esta en `main` remoto ni en un deployment autorizado, no se puede configurar variable, ejecutar redeploy ni validar UI productiva.

Gate operativo:

```text
No configurar variable, no ejecutar redeploy y no validar UI productiva hasta confirmar el commit correcto en el deployment Production.
```

## 7. Feature flag

Variable exacta:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

Valor de activacion:

```text
true
```

Variable que no debe usarse:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY
```

Estado en 2.2V:

- No activar.
- No configurar.
- No modificar Vercel.

Notas:

- La flag es server-side.
- Requiere redeploy para activacion.
- Requiere redeploy para rollback.

## 8. Autodeploy

Riesgo:

```text
Mergear a main podria disparar autodeploy en Vercel.
```

No se puede confirmar localmente la configuracion real de Vercel.

Pendiente:

- confirmar configuracion de autodeploy antes de abrir PR o mergear;
- confirmar si `main` dispara deployment Production;
- confirmar si hay previews automaticas por PR;
- confirmar si Production queda atada a `main` u otra rama.

Recomendacion:

```text
Antes de PR/merge se debe confirmar configuracion Vercel con aprobacion explicita para revisar Vercel.
```

## 9. Rollback si Production queda con codigo incorrecto

Si Production queda con codigo incorrecto:

1. No activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
2. Mantener feature flag OFF.
3. Revertir deployment si aplica y si Arquitectura lo autoriza.
4. Revertir merge si corresponde y si Arquitectura lo autoriza.
5. No tocar base de datos.
6. No crear ciclos productivos.
7. No ejecutar SQL.
8. No ejecutar `supabase db push`.
9. No ejecutar `supabase migration repair`.

Si la flag ya estuviera activa por error:

- apagar/remover `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- redeploy para que el rollback server-side tome efecto;
- confirmar que `trainingCyclesRepositoryEnabled=false`.

## 10. Criterios de aborto

Abortar si:

- commit no confirmado en `main` o deployment autorizado;
- Vercel Production no confirmable;
- feature flag ya activa;
- autodeploy no entendido;
- PR/merge no autorizado;
- ambiente dudoso;
- cualquier duda sobre codigo desplegado;
- Production no contiene `20a67651` ni commit posterior que lo incluya;
- Vercel no puede confirmar commit desplegado;
- rollback no esta claro;
- se requiere accion remota no autorizada.

## 11. Evidencia requerida para aprobar ejecucion posterior

Evidencia requerida:

- commit `20a67651` en `main` o deployment autorizado;
- deployment Production identificado;
- commit de deployment confirmado;
- feature flag OFF;
- Vercel Production no modificado aun;
- decision PR/merge documentada;
- configuracion autodeploy entendida;
- rollback documentado;
- aprobacion explicita para cualquier accion Vercel;
- aprobacion explicita para cualquier PR/merge;
- confirmacion de no SQL;
- confirmacion de no Supabase remoto;
- confirmacion de no ciclos productivos antes de la ventana.

## 12. Recomendacion TI preliminar

Recomendacion:

```text
No activar Training Cycles hasta confirmar que Vercel Production ejecutara exactamente el codigo 20a67651 o un commit posterior que lo contenga, y hasta que Arquitectura autorice explicitamente PR/merge/Vercel/flag/redeploy.
```

Conclusion local:

```text
Con la evidencia local actual, 20a67651 esta en la rama feature pero no en main local. La fase posterior debe confirmar GitHub/main remoto y Vercel Production antes de cualquier activacion.
```

## 13. Proximo paso recomendado

Secuencia minima recomendada para Arquitectura:

### Paso 1 - Autorizacion minima: consulta read-only del estado de main remoto

Antes de cualquier PR, merge o accion en Vercel, solicitar autorizacion para una consulta de solo lectura que determine si:

```text
20a67651cdc5e8cb15c592e1e4e0f8d5ffc50d26
```

ya esta en `main` remoto.

La consulta puede ser, segun autorizacion posterior:

```text
git fetch sin merge, sin pull, sin push
```

o una consulta directa en GitHub.

Esta accion no debe modificar codigo, ramas, Vercel ni base de datos. Su unico objetivo es resolver la incognita principal del gate.

### Paso 2 - Condicional: PR/merge solo si el commit no esta en main remoto

Si el paso 1 confirma que el commit ya esta en `main` remoto, omitir este paso.

Si el commit no esta en `main` remoto, solicitar autorizacion separada para:

```text
abrir PR
mergear a main
```

No abrir PR ni mergear en esta fase.

### Paso 3 - Condicional: confirmacion de deployment Vercel

Una vez que el commit correcto este en `main` o en un deployment autorizado, confirmar en Vercel que commit esta desplegado en Production antes de tocar variables.

No tocar Vercel en esta fase.

### Paso 4 - Solo con pasos 1-3 confirmados: autorizacion para variable y redeploy

Solo despues de confirmar codigo correcto y deployment correcto, solicitar autorizacion separada para:

```text
configurar ENABLE_TRAINING_CYCLES_REPOSITORY=true
redeploy productivo
validacion funcional
```

Este documento no autoriza tocar Vercel, usar Vercel CLI/API/dashboard, abrir PR, hacer merge, hacer fetch, hacer pull, hacer push, hacer redeploy, activar feature flag, ejecutar SQL, tocar Supabase remoto, modificar base de datos, crear ciclos productivos, hacer commit ni hacer push.
