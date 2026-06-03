# Fase 2.2AF - Diagnostico manual read-only Dashboard Vercel

## 1. Contexto

Arquitectura aprobo el cierre formal de la Fase 2.2AE.

Estado heredado:

- Fase 2.2AE cerrada y aprobada.
- Resultado B confirmado: Vercel no genero deployment para `d615a83`.
- PR #29 fue mergeado manualmente en GitHub.
- `main` contiene el merge del PR #29.
- Commit visible en `main`: `d615a83cd17589f799758c25a4ee6860d136f88e`.
- Production sigue ejecutando codigo pre-2.2S.
- Feature flag `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF/no configurada.
- Training Cycles sigue bloqueado.
- Redeploy manual no autorizado.

Decision de Arquitectura:

```text
No se autoriza redeploy manual todavia.
```

Motivo:

```text
El redeploy manual podria resolver el sintoma, pero no la causa raiz.
Antes se debe entender por que el merge a main no genero deployment Production.
```

Evidencia relevante de 2.2AE:

- Vercel si genero Preview para la rama `feature/training-sessions-fuente-verdad`.
- Vercel no genero Production para `d615a83` en `main`.
- La integracion GitHub-Vercel no parece estar completamente rota; el problema parece especifico del evento `main`/Production.

## 2. Objetivo

Preparar diagnostico manual/read-only en Dashboard Vercel para identificar por que `main` / `d615a83` no genero deployment Production.

Esta fase solo busca evidencia. No autoriza:

- Activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Cambiar variables Vercel.
- Hacer redeploy manual.
- Tocar Production Deployment.
- Crear microciclo productivo real.
- Exponer Training Cycles a usuarios finales.
- Ejecutar SQL.
- Tocar Supabase remoto.
- Ejecutar `supabase db push`.
- Ejecutar `supabase migration repair`.
- Modificar base de datos.
- Modificar codigo funcional.

## 3. Responsable de la revision manual

La revision manual debe ejecutarla un usuario con acceso al Dashboard Vercel del proyecto `organizatech`.

Codex no debe:

- Usar botones del Dashboard.
- Cambiar settings.
- Ejecutar redeploy.
- Copiar valores secretos.
- Modificar variables.
- Tocar Production Deployment.

## 4. Evidencia segura

Durante la revision manual:

- No exponer secretos.
- No copiar valores de variables sensibles.
- No copiar tokens.
- No copiar connection strings.
- No copiar passwords.
- No mostrar valores de environment variables.
- Reportar solo estados/configuracion general.

Ejemplos de evidencia segura:

- `Production Branch = main`.
- `Ignored Build Step = configurado/no configurado`.
- `Autodeploy desde main = activo/no activo/no visible`.
- `Deployment para d615a83 = no existe / existe con estado X`.
- `Webhook/log para d615a83 = recibido/no recibido/no visible`.

## 5. Checklist manual Dashboard Vercel

### 5.1 Project Settings -> Git

Revisar:

- Proyecto correcto: `organizatech`.
- Conexion GitHub correcta.
- Repositorio correcto: `FabianNahuelhualGonzalez/organizatech`.
- Branch configurado para Production.
- Reglas especificas por branch, si existen.

Registrar:

```text
Git provider:
Repository:
Production Branch:
Hallazgos:
```

### 5.2 Production Branch

Confirmar:

- `Production Branch = main`.
- No existe override que apunte a otra rama.
- No hay condicion que excluya merges a `main`.

Resultado esperado:

```text
Production Branch = main
```

Estado manual:

```text
Pendiente de revision manual.
```

### 5.3 Ignored Build Step

Revisar en Settings -> Git:

- Si existe Ignored Build Step.
- Si el comando de ignore podria omitir builds documentales.
- Si el comando aplica distinto a Production que a Preview.
- Si el comando usa rutas, branch, commit message o diff.

Registrar sin exponer informacion sensible:

```text
Ignored Build Step: configurado/no configurado
Aplica a Production: si/no/no visible
Riesgo de ignorar cambios documentales: si/no/no concluyente
```

Comparar contra el despliegue Production anterior asociado a PR #28:

```text
Ignored Build Step existia cuando se desplego PR #28: si/no/no visible
Si existia: explicar por que PR #28 si se desplego, si el Dashboard lo permite.
Si fue configurado despues de PR #28: registrar ese momento como posible introduccion del cambio.
```

Estado manual:

```text
Pendiente de revision manual.
```

### 5.4 Autodeploy desde main

Confirmar:

- Autodeploy desde `main` activo.
- No existe configuracion que deshabilite deploys para `main`.
- No existe regla `deploymentEnabled` o equivalente que bloquee `main`.
- No hay condicion de equipo/proyecto que requiera disparo manual.

Registrar:

```text
Autodeploy desde main: activo/no activo/no visible
Bloqueo por configuracion: si/no/no visible
Proyecto pausado en Settings -> General: si/no/no visible
```

Estado manual:

```text
Pendiente de revision manual.
```

### 5.5 Deployments omitidos/ignored para d615a83

En Vercel Deployments:

- Buscar `d615a83`.
- Buscar `d615a83cd17589f799758c25a4ee6860d136f88e`.
- Revisar filtros:
  - All
  - Production
  - Preview
  - Failed
  - Canceled / Cancelled
  - Ignored, si existe filtro visible

Registrar:

```text
Deployment d615a83 visible: si/no
Estado: Ready/Building/Failed/Cancelled/Ignored/no aplica
Target: Production/Preview/null/no aplica
Branch: main/otro/no aplica
URL/ID seguro: si corresponde
```

Estado manual:

```text
Pendiente de revision manual.
```

### 5.6 Webhook/logs GitHub -> Vercel

Si Dashboard Vercel o GitHub permiten revisar delivery/logs:

- Confirmar si hubo evento para merge commit `d615a83`.
- Confirmar si Vercel recibio el evento.
- Confirmar si Vercel lo proceso.
- Confirmar si fue ignorado por regla de build.
- Confirmar si hubo error.
- Revisar tambien en GitHub -> Settings -> Webhooks -> delivery logs el evento de push/merge para `d615a83`.
- Confirmar si GitHub envio el webhook hacia Vercel.

No copiar payloads con secretos. Reportar solo estado general:

```text
Webhook/log para d615a83: recibido/no recibido/no visible
Webhook enviado desde GitHub: si/no/no visible
Procesado por Vercel: si/no/no visible
Motivo de omision/error: texto seguro si existe
```

Estado manual:

```text
Pendiente de revision manual.
```

### 5.7 Botones/acciones relacionadas con redeploy

Revisar sin ejecutar:

- Si existe boton Redeploy.
- Si existe opcion Promote.
- Si existe opcion Retry.
- Si existe opcion Rebuild.
- Si existe accion recomendada por Vercel.

Registrar:

```text
Accion disponible: Redeploy/Retry/Promote/Rebuild/otra/no visible
Accion ejecutada: no
```

Importante:

```text
No ejecutar ninguna accion.
```

Estado manual:

```text
Pendiente de revision manual.
```

## 6. Evidencia manual recopilada

La revision manual read-only en Dashboard Vercel y GitHub registro la siguiente evidencia.

### 6.1 Vercel -> Project Settings -> Git

```text
Repositorio conectado:
FabianNahuelhualGonzalez/organizatech

Git integration:
Activa

Pull Request Comments:
ON

deployment_status Events:
ON

repository_dispatch Events:
ON

Commit Status:
ON

Commit Comments:
OFF

Consolidated Commit Status:
OFF

Require Verified Commits:
Inherit from Team / Disabled

Git LFS:
Disabled

Deploy Hooks:
No hay hooks creados.
```

Lectura:

- La integracion GitHub-Vercel esta activa.
- El repositorio conectado corresponde al repositorio esperado.
- No se observaron Deploy Hooks manuales creados.
- Production Branch no fue visible explicitamente en las pantallas revisadas.
- Production Branch se mantiene inferido como `main` por evidencia historica de deployments Production desde `main`.

### 6.2 Vercel -> Build and Deployment

```text
Framework Preset:
Next.js

Build Command:
default / sin override

Output Directory:
default / sin override

Install Command:
default / sin override

Development Command:
next / sin override

Root Directory:
./

Include files outside root directory in Build Step:
Enabled

Skip deployments when there are no changes to the root directory or its dependencies:
Disabled

Ignored Build Step:
Behavior = Automatic

Node.js Version:
24.x

On-Demand Concurrent Builds:
Disable on-demand concurrent builds
Builds are queued, maximum of one at a time

Build Machine:
Inherited from Team / Standard

Deployment Checks:
No checks configured

Rolling Releases:
Disabled

Prioritize Production Builds:
Enabled
```

Lectura:

- No se observo Ignored Build Step personalizado.
- No se observo regla local que omita deploys por cambios documentales.
- `Skip deployments when there are no changes to the root directory or its dependencies` esta Disabled.
- La configuracion visible no explica por si sola la ausencia de deployment Production para `d615a83`.
- Con `Skip deployments when there are no changes to the root directory or its dependencies` = Disabled y sin Ignored Build Step personalizado, la configuracion visible no contiene un mecanismo activo que justifique el skip de `d615a83`.
- La causa mas probable es que la GitHub App de Vercel no recibio o no proceso el evento de merge para el commit `d615a83` en la rama `main`.

### 6.3 Vercel -> General

```text
Project Name:
organizatech

Estado paused del proyecto:
No se observo estado paused en las capturas revisadas.

Vercel Toolbar:
Default controlled at team level

Data Preferences:
Enabled

Transfer/Delete:
Visibles, no utilizados.
```

Lectura:

- No se observo que el proyecto este pausado.
- Las acciones destructivas o de transferencia estaban visibles pero no fueron utilizadas.

### 6.4 GitHub -> Settings -> Webhooks

```text
Webhooks manuales visibles:
No hay webhooks manuales visibles en el repositorio.

Delivery logs desde Webhooks:
No disponibles en esta seccion.
```

### 6.5 GitHub -> Settings -> GitHub Apps

```text
GitHub App Vercel:
Instalada para el repositorio.

Lectura:
La integracion GitHub -> Vercel existe como GitHub App, no como webhook manual visible.
Por eso no hay delivery logs en Settings -> Webhooks del repo.
```

Lectura:

- La integracion GitHub -> Vercel existe como GitHub App instalada para el repositorio.
- No se pudieron revisar delivery logs desde Settings -> Webhooks porque no existe webhook manual visible.

### 6.6 Vercel -> Deployments

```text
Filtros usados:
All Branches
All Environments
Status visible: todos los estados disponibles

Busqueda:
Ctrl+F d615a83

Resultado:
0/0

Deployment para d615a83:
No visible.

Deployments recientes observados:
Previews de la rama feature/training-sessions-fuente-verdad para commits posteriores como 97073e1, b3d95ca y 16ccdec.

Production nuevo asociado a PR #29 / d615a83:
No observado.
```

Lectura:

- No se observo deployment visible para `d615a83`.
- No se observo deployment ignored, failed o cancelled visible para `d615a83`.
- Vercel siguio generando Previews para la rama `feature/training-sessions-fuente-verdad`.
- No se observo Production nuevo asociado al merge del PR #29.

### 6.7 Conclusion manual preliminar

```text
Resultado B:
Causa no encontrada visualmente y no existe deployment visible para d615a83.
```

No se observo:

- Ignored Build Step personalizado.
- Regla local que omita deploys por cambios documentales.
- Proyecto pausado.
- Deployment ignored/failed/cancelled visible para `d615a83`.
- Webhook manual con delivery logs.

Si se observo:

- GitHub App Vercel instalada.
- Integracion GitHub-Vercel operativa para Preview.
- Production sigue sin deployment para `d615a83`.

## 7. Resultado A/B/C

Completar despues de la revision manual.

### Opcion A - Causa encontrada

Usar si se identifica causa concreta:

```text
A) Causa encontrada:
Ignored Build Step / branch config / webhook / autodeploy config.
```

Completar:

```text
Causa:
Evidencia segura:
Riesgo:
Correccion propuesta:
```

### Opcion B - Causa no encontrada

Usar si no se ve bloqueo:

```text
B) Causa no encontrada:
Se confirma que no hay bloqueo visible y se requiere redeploy manual controlado.
```

Completar:

```text
Production Branch: main esperado; no se documento override visible en la evidencia manual recibida.
Ignored Build Step: Automatic; no se observo Ignored Build Step personalizado.
Autodeploy: sin bloqueo visible en Build and Deployment; Production para d615a83 no se genero.
Webhook/logs: no hay webhook manual visible; integracion Vercel existe como GitHub App.
Razon para redeploy controlado: no hay deployment visible para d615a83 y la causa no fue encontrada visualmente.
```

### Opcion C - Production ya se actualizo

Usar si Vercel muestra deployment nuevo:

```text
C) Production ya se actualizo posteriormente:
Vercel muestra deployment nuevo con d615a83 o commit posterior.
```

Completar:

```text
Deployment ID:
Commit:
Branch:
Target:
Status:
Postchecks pendientes:
```

Estado actual de 2.2AF:

```text
Resultado B documentado:
Causa no encontrada visualmente; requiere autorizacion separada para redeploy manual controlado o revision avanzada de configuracion Vercel/GitHub App.
```

## 8. Recomendacion TI segun resultado

Si A:

- Reportar causa encontrada.
- Proponer correccion separada.
- No modificar configuracion sin autorizacion.
- No activar feature flag.

Si B:

- Solicitar autorizacion separada para redeploy manual controlado.
- Mantener Training Cycles bloqueado hasta que Production ejecute codigo 2.2S.
- No activar feature flag hasta postchecks posteriores.
- Mantener `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF/no configurada.
- Considerar revision avanzada de configuracion Vercel/GitHub App si Arquitectura prefiere resolver causa raiz antes de redeploy.

Si C:

- Continuar con postchecks productivos.
- Mantener feature flag OFF hasta fase separada.
- Confirmar que Production corre `d615a83` o commit posterior que incluya 2.2S.

Recomendacion TI actual:

```text
Mantener Training Cycles bloqueado.
No activar feature flag.
No hacer redeploy manual todavia sin autorizacion explicita.
Resultado probable: B) Causa no encontrada visualmente; requiere autorizacion separada para redeploy manual controlado o revision avanzada de configuracion Vercel/GitHub App.
```

## 9. Siguiente fase recomendada

Recomendacion para Arquitectura:

```text
Fase 2.2AG - Redeploy manual controlado de Production con autorizacion explicita de Arquitectura.
```

Alcance sugerido:

1. Autorizar explicitamente redeploy manual en Vercel Production apuntando a `d615a83` o al ultimo commit de `main`.
2. Ejecutar redeploy sin modificar variables.
3. Monitorear `target=production` y `state=READY`.
4. Confirmar que el commit desplegado contiene `20a67651` o posterior.
5. Confirmar runtime `trainingCyclesRepositoryEnabled=false`.
6. Confirmar que `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF/no configurada.

Aclaracion:

```text
El redeploy manual no activa Training Cycles.
Solo actualiza el codigo desplegado en Production al codigo 2.2S o posterior.
La activacion de la feature flag queda para una fase posterior separada.
```

## 10. Confirmaciones de 2.2AF

- Documento/checklist preparado.
- La revision manual debe hacerla un usuario con acceso Dashboard Vercel.
- Resultado A/B/C documentado como B segun evidencia manual.
- No se hizo redeploy manual.
- No se activo `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- No se cambiaron variables Vercel.
- No se toco Production Deployment.
- No se creo microciclo productivo real.
- No se expuso Training Cycles a usuarios finales.
- No se ejecuto SQL.
- No se toco Supabase.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se modifico base de datos.
- No se modifico codigo funcional.
- No se hizo commit ni push.
- `supabase/.temp/` debe seguir fuera del versionado.
