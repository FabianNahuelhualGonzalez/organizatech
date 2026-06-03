# Fase 2.2AE - Diagnostico read-only de Vercel/autodeploy Production

## 1. Contexto

Arquitectura aprobo el cierre formal de la Fase 2.2AD.

Estado heredado:

- PR #29 fue mergeado manualmente en GitHub.
- `main` contiene el merge del PR #29.
- Commit visible en `main`: `d615a83cd17589f799758c25a4ee6860d136f88e`.
- Vercel Production nuevo no fue observado por TI despues del merge.
- Production sigue en deployment anterior pre-2.2S.
- Ultimo Production observado antes de 2.2AE: PR #28 / `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610`.
- Feature flag `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF/no configurada.

Decision vigente:

- No activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- No cambiar variables Vercel.
- No hacer redeploy manual.
- No tocar Production Deployment.
- No ejecutar SQL.
- No tocar Supabase remoto.

## 2. Objetivo

Diagnosticar en modo read-only por que Vercel Production no genero o no mostro deployment para `d615a83` despues del merge manual del PR #29.

El diagnostico debe concluir una opcion:

```text
A) Vercel si genero deployment para d615a83, pero fallo / fue ignorado / esta pendiente.
B) Vercel no genero deployment para d615a83.
C) Vercel genero deployment correctamente y Production ya corre d615a83 o commit posterior.
```

## 3. Metodos read-only usados

Se usaron solo consultas read-only:

1. GitHub PR info del PR #29.
2. GitHub combined status del commit `d615a83cd17589f799758c25a4ee6860d136f88e`.
3. Vercel list deployments del proyecto `organizatech`.
4. Vercel get project del proyecto `organizatech`.
5. Vercel get deployment de deployments relevantes.
6. Revision local de archivos de configuracion (`vercel.json`, `.vercelignore`, `package.json`) sin modificar archivos.
7. Consulta read-only de documentacion Vercel sobre Git deployments / Ignored Build Step.

No se ejecuto redeploy, no se cambiaron variables y no se toco Production Deployment.

## 4. Revision GitHub

Resultado PR #29:

| Campo | Resultado |
| --- | --- |
| PR | `https://github.com/FabianNahuelhualGonzalez/organizatech/pull/29` |
| Estado | `closed` |
| Merged | `true` |
| Draft | `false` |
| Base | `main` |
| Head | `feature/training-sessions-fuente-verdad` |
| Head SHA reportado | `d95aca4be83563de516af1171ef079d7397fe113` |
| Merge commit SHA | `d615a83cd17589f799758c25a4ee6860d136f88e` |
| Merged at | `2026-06-03T15:18:02Z` |

Resultado combined status del merge commit:

```text
commit=d615a83cd17589f799758c25a4ee6860d136f88e
statuses=[]
```

Lectura TI:

- GitHub confirma merge del PR #29.
- GitHub no muestra status/check Vercel asociado al merge commit `d615a83` mediante la consulta disponible.

## 5. Revision de deployments Vercel

Se revisaron los deployments recientes del proyecto `organizatech`.

### Busqueda de d615a83

Resultado:

```text
No se encontro deployment Vercel con githubCommitSha=d615a83cd17589f799758c25a4ee6860d136f88e.
No se encontro deployment Vercel con commit corto d615a83.
```

No se observo deployment asociado a `d615a83` en estados:

- `READY`
- `BUILDING`
- `FAILED`
- `CANCELLED`
- `IGNORED`

Nota: la herramienta read-only disponible lista deployments generados por Vercel. No expone un registro separado de eventos ignorados si Vercel no creo deployment.

### Deployments recientes relevantes

| Deployment | Commit | Branch | Target | State | Lectura |
| --- | --- | --- | --- | --- | --- |
| `dpl_5g24jc2S9CkyEGB9kKS1KTHAH4DG` | `16ccdec0c5199d034d939cf745a2369d2fa01479` | `feature/training-sessions-fuente-verdad` | `null` | `READY` | Preview posterior al merge, no Production. |
| `dpl_ErYdK8mso1SwUiucjk8PofkcZLjN` | `d95aca4be83563de516af1171ef079d7397fe113` | `feature/training-sessions-fuente-verdad` | `null` | `READY` | Preview del documento 2.2AD inicial. |
| `dpl_JCsZJ3hUdbE2HwLknw8CEuPT8uV8` | `fddae835d542eb4b4e8bc362124d5c77b2de3a96` | `feature/training-sessions-fuente-verdad` | `null` | `READY` | Preview del documento 2.2AC. |
| `dpl_8gWk9GkYQL61WmrLawus3bGB7dvc` | `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610` | `main` | `production` | `READY` | Ultimo Production observado, PR #28. |

Detalle del ultimo Preview:

```text
id=dpl_5g24jc2S9CkyEGB9kKS1KTHAH4DG
state=READY
target=null
source=git
githubCommitRef=feature/training-sessions-fuente-verdad
githubCommitSha=16ccdec0c5199d034d939cf745a2369d2fa01479
```

Detalle del ultimo Production observado:

```text
id=dpl_8gWk9GkYQL61WmrLawus3bGB7dvc
state=READY
target=production
source=git
githubCommitRef=main
githubCommitSha=f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610
alias=organizatech.cl, organizatech.vercel.app, organizatech-git-main...
```

Lectura TI:

- Vercel sigue generando deployments Preview para la rama feature.
- No hay evidencia de deployment Production generado para `d615a83`.
- Production sigue apuntando al deployment anterior de `main`, commit `f6c00eb`.

## 6. Revision de autodeploy / Production Branch

Evidencia disponible:

- Deployments historicos muestran Production deploys desde `main`.
- El deployment `dpl_8gWk9GkYQL61WmrLawus3bGB7dvc` tiene:
  - `target=production`
  - `githubCommitRef=main`
  - `githubCommitSha=f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610`
  - `source=git`
- El proyecto tiene dominios/alias asociados a `main`, incluyendo `organizatech-git-main-fanahuelhualg-8514s-projects.vercel.app`.

Limitacion de herramienta:

- `get_project` no expuso explicitamente el campo de Production Branch.
- `get_project` no expuso un flag directo de autodeploy enabled/disabled.

Lectura TI:

- Hay evidencia historica de autodeploy Production desde `main`.
- No se puede confirmar directamente con la herramienta disponible si el autodeploy desde `main` sigue activo en la configuracion actual.
- El hecho observado es que el merge commit `d615a83` no genero deployment visible.

## 7. Revision de webhook GitHub -> Vercel

Resultado:

```text
No verificable directamente con la herramienta disponible.
```

Evidencia indirecta:

- Vercel recibio/proceso pushes posteriores de la rama `feature/training-sessions-fuente-verdad`, generando Preview para `16ccdec`.
- No hay deployment ni status asociado al merge commit `d615a83`.

Hallazgo diagnostico central:

- La integracion GitHub-Vercel esta operativa: Vercel proceso correctamente el commit `16ccdec` del feature branch post-merge generando Preview.
- El problema es especifico al evento de merge a `main` asociado a `d615a83`.
- Esto descarta una falla general de webhook y apunta a una de dos hipotesis principales:
  1. Ignored Build Step configurado en Dashboard que aplica distinto a Production.
  2. Configuracion especifica del branch `main` / Production Branch en Vercel.

Lectura TI:

- No se puede confirmar desde Codex si el webhook GitHub -> Vercel para `d615a83` fue recibido, ignorado o no emitido.
- Se recomienda revisar este punto en Dashboard Vercel/GitHub o mediante API autorizada en fase separada si Arquitectura lo requiere.

## 8. Ignored Build Step

Revision local:

```text
vercel.json: no existe.
.vercelignore: no existe.
package.json: contiene "build": "next build".
```

No se encontro configuracion local de `ignoreCommand`.

Revision de documentacion Vercel:

- Vercel permite configurar `ignoreCommand` en `vercel.json`.
- Tambien puede existir un Ignored Build Step en configuracion del proyecto.
- Un comando de ignore puede omitir builds segun cambios git.

Limitacion de herramienta:

- `get_project` no expuso configuracion de Ignored Build Step del Dashboard.
- No hay deployment `IGNORED` visible para `d615a83` en la lista consultada.

Lectura TI:

- No hay evidencia local de Ignored Build Step.
- No se puede descartar una regla configurada en Dashboard Vercel con las herramientas actuales.
- Si existiera una regla que ignore cambios documentales, podria explicar que el merge documental/post-documental no generara Production deployment, pero esto requiere confirmacion read-only adicional.

## 9. Resultado A/B/C

Resultado:

```text
B) Vercel no genero deployment para d615a83.
```

Justificacion:

- GitHub confirma que PR #29 fue mergeado.
- Merge commit: `d615a83cd17589f799758c25a4ee6860d136f88e`.
- GitHub combined status del commit: `statuses=[]`.
- Vercel deployments recientes no contienen `d615a83`.
- No hay deployment `READY`, `BUILDING`, `FAILED`, `CANCELLED` o `IGNORED` asociado a `d615a83` en la evidencia disponible.
- Production sigue en deployment anterior `f6c00eb` / PR #28.

## 10. Riesgos

- Production sigue ejecutando codigo pre-2.2S.
- Production todavia no lee `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Activar la feature flag ahora seria inefectivo y puede generar confusion operacional.
- Redeploy manual no esta autorizado en 2.2AE.
- Cambios de variables Vercel no estan autorizados.
- Supabase/DB no debe tocarse.
- Training Cycles no debe exponerse a usuarios finales hasta resolver deployment Production y ejecutar fase de activacion separada.

## 11. Recomendacion TI

Dado el resultado B, TI recomienda:

1. Mantener bloqueada la activacion de Training Cycles.
2. No activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
3. No cambiar variables Vercel.
4. No hacer redeploy manual en esta fase.
5. Antes de cualquier activacion de feature flag, confirmar que Production corre `d615a83` o commit posterior que incluya 2.2S.

Opcion preferida - Diagnostico manual read-only del Dashboard Vercel:

Objetivo:

```text
Resolver la causa raiz antes de cualquier redeploy.
```

Validar:

1. Settings -> Git -> Ignored Build Step.
2. Settings -> Git -> Production Branch = `main`.
3. Autodeploy desde `main` activo.
4. GitHub webhook delivery logs para `d615a83`, si estan disponibles.

Ventaja:

```text
Previene que futuros merges a main vuelvan a quedar sin deployment Production.
```

Opcion alternativa - Redeploy manual controlado explicitamente autorizado:

Objetivo:

```text
Desplegar mas rapido el codigo ya mergeado en main.
```

Condicion:

```text
Solo con autorizacion explicita de Arquitectura.
```

Riesgo:

```text
Si existe Ignored Build Step o configuracion que bloquea main, el redeploy manual puede resolver el sintoma actual, pero futuros merges podrian volver a no desplegarse automaticamente.
```

## 12. Confirmaciones finales

- No se activo feature flag.
- No se cambiaron variables Vercel.
- No se hizo redeploy manual.
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
