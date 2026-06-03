# Fase 2.2Z - Revision manual read-only Vercel

## 1. Contexto

Arquitectura aprobo el cierre formal de Fase 2.2Y.

Estado confirmado:

- Fase 2.2Y cerrada y aprobada.
- Ruta A elegida: revision manual/read-only del dashboard Vercel por TI/Arquitectura.
- PR no abierto.
- Merge no realizado.
- PR y merge siguen bloqueados.
- Vercel Production sin tocar.
- Feature flag productiva OFF.
- Supabase remoto sin tocar.
- Base de datos sin cambios.

Esta fase no ejecuta acciones sobre Vercel. Solo prepara la pauta de revision visual/manual para que TI/Arquitectura complete la validacion en Dashboard Vercel sin modificar configuracion.

## 2. Objetivo

Revisar manualmente Dashboard Vercel en modo solo lectura antes de abrir PR draft desde:

```text
feature/training-sessions-fuente-verdad
```

hacia:

```text
main
```

La revision debe confirmar si abrir PR draft queda limitado a Preview, si Preview usa Supabase QA y si Production permanece intacta.

## 3. Alcance y no autorizado

Alcance autorizado:

- Revision visual/manual en Dashboard Vercel.
- Registro documental de hallazgos sin secretos.
- Confirmacion por ambiente: Production, Preview y Development.

No autorizado:

- Crear PR.
- Mergear a `main`.
- Cambiar variables Vercel.
- Crear variables Vercel.
- Activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Ejecutar redeploy.
- Tocar Production Deployment.
- Crear ciclos productivos.
- Ejecutar SQL.
- Tocar Supabase remoto.
- Ejecutar `supabase db push`.
- Ejecutar `supabase migration repair`.
- Modificar base de datos.
- Modificar codigo funcional.
- Hacer commit.
- Hacer push.
- Versionar `supabase/.temp/`.

## 4. Checklist de revision

### 4.1 Proyecto correcto

Contexto:

```text
Confirmado operacionalmente por 2.2Y mediante Vercel MCP; verificar visualmente en Dashboard Vercel.
```

Validar en Dashboard Vercel:

- Nombre visible del proyecto: `organizatech`.
- Repositorio conectado: `FabianNahuelhualGonzalez/organizatech`.
- Team/cuenta esperada.

Evidencia segura:

```text
Proyecto Vercel: organizatech
Repositorio conectado: presente / coincide
```

No copiar tokens ni IDs si no son necesarios.

### 4.2 Dominio productivo

Contexto:

```text
Confirmado operacionalmente por 2.2Y mediante datos del proyecto Vercel; verificar visualmente en Dashboard Vercel.
```

Validar:

- Dominio productivo asociado: `organizatech.cl`.
- El dominio esta asociado al proyecto `organizatech`.
- No hay redireccion inesperada hacia otro proyecto.

Evidencia segura:

```text
Dominio organizatech.cl: presente / asociado al proyecto correcto
```

### 4.3 Production Branch

Contexto:

```text
Confirmado operacionalmente por 2.2Y mediante deployments target=production con githubCommitRef=main; verificar visualmente en Dashboard Vercel.
```

Validar en Git / Production Branch:

- Production Branch configurada: `main`.
- Deployments Production se originan desde `main`.

Evidencia segura:

```text
Production Branch: main
```

Criterio:

- Si Production Branch no es `main`, abortar apertura de PR y volver a Arquitectura.

### 4.4 Preview Deployments

Contexto:

```text
Parcialmente confirmado por 2.2Y: deployments historicos de feature/PR aparecen con target=null y merge a main aparece con target=production. Verificacion visual obligatoria en Dashboard Vercel.
```

Validar:

- PRs o branches generan Preview Deployments.
- Abrir PR draft desde `feature/training-sessions-fuente-verdad` hacia `main` no promueve ni despliega Production.
- Preview usa ambiente `Preview`.
- Preview expone `VERCEL_ENV=preview`.
- Preview Deployments estan o no protegidos por Vercel Authentication.

Contexto Vercel Authentication:

```text
Estado observado en 2.2Y: el Preview consultado devolvio 401 por Vercel Authentication.
```

Registrar si la proteccion esta habilitada y que implica para el flujo QA. Si Preview esta protegido, la validacion QA futura requerira acceso autorizado al equipo/proyecto Vercel.

Evidencia segura:

```text
Preview Deployments para PR/branches: habilitados / no habilitados / no verificable
Preview afecta Production: no / si / no verificable
VERCEL_ENV esperado en Preview: preview
Vercel Authentication en Preview: habilitada / no habilitada / no verificable
```

### 4.5 Variables Production

Contexto:

```text
No confirmado directamente en fases previas; verificacion obligatoria en Dashboard Vercel.
```

Validar en Environment Variables, ambiente Production:

- `ENABLE_TRAINING_CYCLES_REPOSITORY`: ausente o no activa.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS`: ausente o no activa.
- `NEXT_PUBLIC_SUPABASE_ENV`: ausente, distinto de `qa` o no configurado como QA.
- Variables Supabase apuntan a Supabase Produccion.

Evidencia segura:

```text
Production / ENABLE_TRAINING_CYCLES_REPOSITORY: ausente / presente no activa / activa
Production / NEXT_PUBLIC_ENABLE_QA_TOOLS: ausente / presente no activa / activa
Production / NEXT_PUBLIC_SUPABASE_ENV: ausente / no qa / qa
Production / Supabase: apunta a Produccion / apunta a QA / no verificable
```

No copiar valores. No mostrar anon key completa. No mostrar service_role. No mostrar URLs completas si no es necesario.

### 4.6 Variables Preview

Contexto:

```text
No confirmado directamente en fases previas; verificacion obligatoria en Dashboard Vercel.
```

Validar en Environment Variables, ambiente Preview:

- `NEXT_PUBLIC_ENABLE_QA_TOOLS`: activo solo si corresponde al helper QA.
- `NEXT_PUBLIC_SUPABASE_ENV`: `qa`.
- Variables Supabase apuntan a Supabase QA.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` no habilita Production desde Preview.

Evidencia segura:

```text
Preview / NEXT_PUBLIC_ENABLE_QA_TOOLS: activo / no activo / no verificable
Preview / NEXT_PUBLIC_SUPABASE_ENV: qa / no qa / no verificable
Preview / Supabase: apunta a QA / apunta a Produccion / no verificable
Preview / ENABLE_TRAINING_CYCLES_REPOSITORY: ausente / presente / no verificable
```

Criterio:

- Si Preview apunta a Supabase Produccion, abortar.
- Si Preview no puede confirmarse como QA, no abrir PR.

### 4.7 Variables Development

Contexto:

```text
No confirmado directamente en fases previas; verificacion obligatoria si el Dashboard Vercel expone Development para este proyecto.
```

Validar en Environment Variables, ambiente Development:

- Estado general de Supabase local/desarrollo si aplica.
- Ausencia de variables que puedan afectar Production.

Evidencia segura:

```text
Development / Supabase: QA / local / no verificable / no aplica
Development / observaciones: sin impacto Production / revisar
```

### 4.8 Supabase Production

Contexto:

```text
Parcialmente favorable en 2.2Y: Production mostro Supabase env=not-set y QA bloqueado, pero la URL/target Supabase Production no fue confirmado directamente. Verificacion obligatoria en Dashboard Vercel.
```

Validar que Production usa Supabase Produccion:

- URL/identificador visible corresponde al proyecto productivo esperado.
- No copiar URL completa si no es necesario.
- No copiar anon key completa.
- No copiar service_role.

Evidencia segura:

```text
Production Supabase: apunta a Produccion
```

### 4.9 Supabase QA en Preview

Contexto:

```text
No confirmado en fases previas; verificacion obligatoria en Dashboard Vercel.
```

Validar que Preview usa Supabase QA:

- URL/identificador visible corresponde al proyecto QA esperado.
- `NEXT_PUBLIC_SUPABASE_ENV=qa`.
- Helper QA queda disponible solo bajo Preview si `NEXT_PUBLIC_ENABLE_QA_TOOLS=true`.

Evidencia segura:

```text
Preview Supabase: apunta a QA
Preview NEXT_PUBLIC_SUPABASE_ENV: qa
```

### 4.10 Feature flags apagadas en Production

Contexto:

```text
Parcialmente confirmado por 2.2Y para QA tools y Supabase env en Production; ENABLE_TRAINING_CYCLES_REPOSITORY no fue confirmado directamente. Verificacion obligatoria en Dashboard Vercel.
```

Validar:

- `ENABLE_TRAINING_CYCLES_REPOSITORY` no esta activo en Production.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta activo en Production.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta configurado como `qa` en Production.

Evidencia segura:

```text
Production feature productiva: OFF
Production QA tools: OFF
Production Supabase env qa: no
```

### 4.11 PR draft no afecta Production

Contexto:

```text
Parcialmente confirmado por 2.2Y mediante evidencia historica de PR/feature con target=null y merges a main con target=production; verificar visualmente reglas de Git/Deployments en Dashboard Vercel.
```

Validar en Git/Deployments settings:

- Abrir PR draft desde feature hacia main genera Preview o checks de PR.
- No genera Production Deployment.
- No cambia aliases Production.
- No toca `organizatech.cl`.

Evidencia segura:

```text
Abrir PR draft afecta Production: no / si / no verificable
```

### 4.12 Merge a main puede gatillar Production deploy

Contexto:

```text
Confirmado operacionalmente por 2.2Y mediante deployments historicos de merge a main con target=production; verificar visualmente en Dashboard Vercel.
```

Validar:

- Merge a `main` puede disparar Production deploy.
- Esto debe mantenerse bloqueado hasta autorizacion separada.

Evidencia segura:

```text
Merge a main dispara Production deploy: si / no / no verificable
```

## 5. Evidencia segura

Permitido:

- Capturas de pantalla si no muestran valores secretos.
- Nombre de variable.
- Ambiente.
- Estado general:
  - presente;
  - ausente;
  - activo;
  - no activo;
  - apunta a QA;
  - apunta a Produccion;
  - no verificable.

No permitido:

- Copiar valores completos de variables.
- Copiar anon keys completas.
- Copiar service_role.
- Copiar passwords.
- Copiar connection strings.
- Copiar tokens.
- Copiar secrets de Vercel.
- Copiar URLs internas completas si no son necesarias.

Si aparece un secreto en pantalla:

```text
No copiarlo. No pegarlo en el reporte. Enmascararlo antes de guardar evidencia.
```

## 6. Resultado esperado

TI/Arquitectura debe elegir una conclusion:

### Resultado A - Seguro abrir PR draft

Condiciones minimas:

- Proyecto Vercel correcto.
- Dominio productivo correcto.
- Production Branch = `main`.
- Abrir PR draft genera solo Preview/checks y no afecta Production.
- Preview usa `VERCEL_ENV=preview`.
- Preview usa Supabase QA.
- Production usa Supabase Produccion.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` no esta activo en Production.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta activo en Production.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta configurado como `qa` en Production.

Conclusion:

```text
Seguro solicitar autorizacion para abrir PR draft.
```

### Resultado B - No seguro abrir PR

Aplica si:

- Preview no esta confirmado con Supabase QA.
- Production tiene feature flag activa.
- Production tiene QA tools activo.
- Production tiene `NEXT_PUBLIC_SUPABASE_ENV=qa`.
- Preview apunta a Supabase Produccion.
- Abrir PR podria afectar Production.
- Se requiere modificar algo para revisar.
- Se exponen secretos.
- Alguna configuracion critica queda no verificable.

Conclusion:

```text
Mantener PR bloqueado y volver a Arquitectura con bloqueantes.
```

## 7. Criterios de aborto

Abortar si:

- No se puede confirmar que Preview usa QA.
- Production tiene `ENABLE_TRAINING_CYCLES_REPOSITORY` activo.
- Production tiene `NEXT_PUBLIC_ENABLE_QA_TOOLS` activo.
- Production tiene `NEXT_PUBLIC_SUPABASE_ENV=qa`.
- Preview apunta a Supabase Produccion.
- Abrir PR podria afectar Production.
- Se requiere modificar algo para revisar.
- Se exponen secretos.
- Hay duda de ambiente.
- Hay duda sobre Production Branch.

## 8. Recomendacion TI preliminar

Recomendacion:

```text
Completar la revision manual read-only en Dashboard Vercel antes de abrir PR.
```

Si el resultado es A:

```text
Solicitar autorizacion explicita para abrir PR draft desde feature/training-sessions-fuente-verdad hacia main.
```

Si el resultado es B:

```text
Mantener PR bloqueado y volver a Arquitectura con bloqueantes concretos.
```

## 9. Proceso posterior al checklist

Flujo requerido:

```text
Completar checklist manual
-> auditoria final del checklist completado por TI/Codex/Claude
-> si resultado A y sin bloqueantes, solicitar autorizacion para abrir PR draft
-> si resultado B, mantener PR bloqueado y volver a Arquitectura
```

Reglas:

- El checklist completado con resultado A/B y evidencia segura debe ser devuelto a TI/Codex/Claude para auditoria final antes de solicitar autorizacion para abrir PR draft.
- Un resultado A no abre el PR automaticamente.
- Un resultado A solo habilita solicitar autorizacion separada para abrir PR draft.
- Un resultado B mantiene PR y merge bloqueados.
- La auditoria final no autoriza tocar Vercel Production, activar feature flag, redeploy ni mergear.

Este documento no autoriza crear PR, mergear, cambiar variables Vercel, activar feature flag, hacer redeploy, tocar Production Deployment, crear ciclos productivos, ejecutar SQL, tocar Supabase remoto, modificar base de datos, modificar codigo funcional, hacer commit ni hacer push.
