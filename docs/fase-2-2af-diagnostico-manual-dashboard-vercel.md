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

## 6. Resultado A/B/C

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
Production Branch:
Ignored Build Step:
Autodeploy:
Webhook/logs:
Razon para redeploy controlado:
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

Estado actual de 2.2AF desde Codex:

```text
Resultado A/B/C pendiente de revision manual.
```

## 7. Recomendacion TI segun resultado

Si A:

- Reportar causa encontrada.
- Proponer correccion separada.
- No modificar configuracion sin autorizacion.
- No activar feature flag.

Si B:

- Solicitar autorizacion separada para redeploy manual controlado.
- Mantener Training Cycles bloqueado hasta que Production ejecute codigo 2.2S.
- No activar feature flag hasta postchecks posteriores.

Si C:

- Continuar con postchecks productivos.
- Mantener feature flag OFF hasta fase separada.
- Confirmar que Production corre `d615a83` o commit posterior que incluya 2.2S.

## 8. Confirmaciones de 2.2AF

- Documento/checklist preparado.
- La revision manual debe hacerla un usuario con acceso Dashboard Vercel.
- Resultado A/B/C queda pendiente hasta completar revision manual.
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
