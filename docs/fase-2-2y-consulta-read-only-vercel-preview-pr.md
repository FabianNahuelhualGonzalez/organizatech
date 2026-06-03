# Fase 2.2Y - Consulta read-only Vercel Preview PR

## 1. Contexto

Arquitectura aprobo el cierre formal de Fase 2.2X.

Estado confirmado:

- Fase 2.2X cerrada y aprobada.
- PR no abierto: decision correcta.
- Merge no realizado.
- Vercel Production sin tocar por acciones de despliegue o configuracion.
- Feature flag productiva OFF segun estado aprobado previo.
- Supabase remoto sin tocar.
- Base de datos sin cambios.
- Arquitectura eligio Ruta A: Vercel read-only primero.

Esta fase es solo lectura y busca reducir el riesgo antes de abrir incluso un PR draft.

## 2. Objetivo

Confirmar configuracion Vercel read-only antes de abrir PR desde:

```text
feature/training-sessions-fuente-verdad
```

hacia:

```text
main
```

La consulta busca responder si abrir PR genera Preview automatico, si ese Preview queda aislado de Production, que rama dispara Production y si las variables por ambiente permiten continuar sin riesgo.

## 3. Metodo de consulta read-only

Metodos usados:

- Conector Vercel MCP en modo lectura:
  - listar equipos;
  - listar proyectos;
  - obtener proyecto;
  - listar deployments;
  - obtener deployments especificos;
  - consultar documentacion Vercel;
  - hacer GET read-only a rutas Vercel.
- Revision local de codigo y documentos versionados.
- No se uso Vercel CLI.
- No se uso dashboard Vercel.
- No se uso GitHub para abrir PR.
- No se leyeron archivos `.env`.
- No se imprimieron valores secretos.

Limitacion relevante:

```text
El conector Vercel disponible no expuso una herramienta read-only de listado de environment variables por ambiente. Por seguridad, no se usaron endpoints ad hoc con tokens ni comandos que pudieran descargar valores.
```

## 4. Proyecto Vercel

Proyecto identificado:

```text
Nombre visible: organizatech
Framework: Next.js
Dominio asociado confirmado: organizatech.cl
```

Dominios visibles del proyecto:

- `organizatech.cl`
- dominio Vercel principal del proyecto
- alias Vercel asociado a `main`
- dominio `organizatech.vercel.app`

No se reportan URLs completas de deployments efimeros como evidencia final porque no son necesarias para la decision y pueden generar ruido operativo.

Rama Production Branch:

```text
main
```

Evidencia:

- Deployments con `target=production` observados con `githubCommitRef=main`.
- Alias de rama observado para Production: alias Vercel de `main`.
- Deployment historico de merge PR #28 a `main` aparece como `target=production`.

Nota:

```text
El campo explicito "Production Branch" no fue expuesto por la respuesta del conector get_project. La confirmacion se basa en evidencia operacional de deployments production recientes.
```

## 5. Preview Deployments

Evidencia de deployments no productivos:

- Pushes recientes a `feature/training-sessions-fuente-verdad` generaron deployments `READY` con `target=null`.
- Esos deployments tienen `githubCommitRef=feature/training-sessions-fuente-verdad`.
- Esos deployments tienen alias de rama feature.

Evidencia historica de PR:

- Deployment historico asociado a PR #28:
  - `githubPrId=28`;
  - `githubCommitRef=feature/training-sessions-fuente-verdad`;
  - `target=null`;
  - alias de feature, no aliases de Production.

Evidencia historica de merge:

- Deployment posterior al merge de PR #28:
  - `githubCommitRef=main`;
  - `target=production`;
  - aliases de dominio Production, incluido `organizatech.cl`.

Lectura tecnica:

```text
Abrir PR desde feature hacia main probablemente genera Preview automatico o mantiene deployment Preview asociado al branch/PR. La evidencia historica muestra PR con deployment no Production.
```

Ambiente esperado:

```text
Segun documentacion Vercel, deployments no productivos usan entorno Preview y exponen VERCEL_ENV=preview.
```

Punto no confirmado:

```text
No se pudo confirmar visualmente el contenido de la ruta QA en Preview porque el Preview consultado devolvio Vercel Authentication 401.
```

Por lo tanto:

- Preview automatico: probable / respaldado por evidencia historica.
- Preview usa `VERCEL_ENV=preview`: esperado por plataforma y docs, pero no confirmado visualmente en el Preview actual por proteccion de acceso.
- Abrir PR no afecta Production: probable segun evidencia historica, siempre que no haya reglas custom no visibles.

## 6. Variables por ambiente

Regla de seguridad:

```text
No se exponen valores. Solo se reporta estado general cuando fue observable sin secretos.
```

### Production

Estado observado por GET read-only a `/qa/training-cycles` en Production:

```text
HTTP 200
VERCEL_ENV = production
QA tools = disabled
Supabase env = not-set
Acceso = bloqueado
```

Lectura:

- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta activo en Production.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta seteado como `qa` en Production.
- El helper QA queda bloqueado en Production.

Estado de `ENABLE_TRAINING_CYCLES_REPOSITORY` en Production:

```text
No verificable directamente con las herramientas read-only disponibles.
```

Contexto:

- Fases previas y Arquitectura mantienen feature flag OFF.
- Production actual no corre todavia el commit 2.2S requerido para habilitacion productiva controlada.
- No se modifico ninguna variable.

### Preview

Estado de ruta QA en Preview:

```text
GET read-only a Preview /qa/training-cycles devolvio 401 por Vercel Authentication.
```

Lectura:

- No se confirmo visualmente `VERCEL_ENV=preview`.
- No se confirmo visualmente `NEXT_PUBLIC_ENABLE_QA_TOOLS=true`.
- No se confirmo visualmente `NEXT_PUBLIC_SUPABASE_ENV=qa`.
- No se confirmo directamente que Preview apunte a Supabase QA.

Evidencia indirecta:

- Codigo local de `src/app/qa/training-cycles/page.tsx` solo permite el helper si:

```text
VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

- Codigo local de `src/app/page.tsx` mantiene QA separado de Production.

### Development

No se consulto ambiente Development en Vercel.

Estado:

```text
No aplica para decision de abrir PR hacia main.
```

## 7. Confirmacion Supabase

Production:

- La ruta QA productiva mostro `Supabase env = not-set`.
- Eso confirma que Production no esta marcada como QA desde `NEXT_PUBLIC_SUPABASE_ENV`.
- No se expusieron URLs ni keys.

Lectura positiva:

```text
Supabase env = not-set en Production confirma que Production no puede satisfacer la triple condicion del gating QA:

VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Esto constituye una proteccion activa: el gating QA no puede activarse en Production con ese estado.

Alcance de esta evidencia:

- Es favorable para confirmar que QA no queda habilitado en Production.
- No resuelve los bloqueantes de Preview.
- No resuelve la falta de listado directo de variables por ambiente.

Preview:

- No se pudo confirmar que Preview use Supabase QA por proteccion Vercel Authentication 401.
- Debe quedar como bloqueante antes de abrir PR si Arquitectura exige confirmacion directa.

No se mostraron:

- anon key completa;
- service_role;
- URLs Supabase completas;
- connection strings;
- passwords.

## 8. Autodeploy

Evidencia observada:

- Pushes a `feature/training-sessions-fuente-verdad` generan deployments no Production (`target=null`).
- PR historico #28 genero deployment no Production (`target=null`, `githubPrId=28`).
- Merge historico de PR #28 a `main` genero deployment `target=production`.

Lectura:

```text
El flujo observado indica que abrir PR o pushear feature no deberia tocar Production; mergear a main si dispara Production deploy.
```

Riesgo residual:

```text
No se confirmaron reglas custom de Vercel fuera de lo expuesto por deployments y get_project.
```

## 9. Feature flags

Estado confirmado:

- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta activo en Production segun la ruta `/qa/training-cycles`.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta seteado como `qa` en Production.
- No se modifico ninguna variable.

Estado no confirmado directamente:

- `ENABLE_TRAINING_CYCLES_REPOSITORY` en Production no fue visible mediante el conector disponible.

Lectura de seguridad:

```text
No hay evidencia de que Training Cycles productivo este habilitado, pero falta confirmacion directa de variables Vercel por ambiente.
```

## 10. Resultado

Resultado:

```text
B) No es seguro abrir PR todavia.
```

Motivo:

- No se pudo confirmar directamente que Preview actual use Supabase QA.
- No se pudo listar variables Vercel por ambiente con la herramienta read-only disponible.
- No se pudo confirmar directamente el estado de `ENABLE_TRAINING_CYCLES_REPOSITORY` en Production.

Puntos favorables:

- Proyecto Vercel identificado.
- Dominio Production identificado.
- Rama Production inferida con evidencia operacional: `main`.
- PR historico genero deployment no Production.
- Merge historico a `main` genero Production deployment.
- QA helper esta bloqueado en Production.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` no esta activo en Production.
- `NEXT_PUBLIC_SUPABASE_ENV` no esta seteado como `qa` en Production, por lo que Production no puede cumplir el gating QA.

## 11. Riesgos

Riesgos detectados:

- Confusion Preview vs Production si no se revisa la configuracion completa.
- Variables mal asignadas por ambiente.
- Preview apuntando a Supabase Produccion.
- Feature productiva activa por error.
- Autodeploy no esperado por regla custom no visible.
- Preview protegido por Vercel Authentication impide confirmar visualmente QA sin metodo adicional.

## 12. Criterios de aborto

Abortar si:

- Preview no esta confirmado como Preview.
- Preview no esta confirmado con Supabase QA.
- Production Branch queda dudosa.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` aparece activo en Production.
- `NEXT_PUBLIC_ENABLE_QA_TOOLS` aparece activo en Production.
- Hay riesgo de Production al abrir PR.
- Se requiere exponer valores secretos para confirmar variables.

Estado frente a criterios:

```text
Abortar apertura de PR por ahora: Preview con Supabase QA no fue confirmado directamente y variables Vercel por ambiente no fueron listables con el conector disponible.
```

## 13. Recomendacion TI preliminar

Recomendacion:

```text
No abrir PR todavia. Volver a Arquitectura con bloqueantes acotados.
```

Siguiente paso recomendado jerarquizado:

### Ruta preferida - Revision manual/read-only del dashboard Vercel por TI/Arquitectura

Solicitar a TI/Arquitectura una revision manual en dashboard Vercel, solo lectura y sin modificar variables, para cerrar los bloqueantes.

Justificacion:

```text
Es la opcion de menor friccion y mayor completitud, porque no requiere nuevo tooling ni autenticacion tecnica adicional en Codex.
```

Debe confirmar:

1. `ENABLE_TRAINING_CYCLES_REPOSITORY` por ambiente.
2. Variables Preview relevantes.
3. Si Preview apunta a Supabase QA.
4. Si Production apunta a Supabase Produccion.
5. Si abrir PR solo genera Preview y no toca Production.

### Ruta alternativa - Vercel CLI `vercel env ls` autorizado

Solicitar autorizacion separada para usar Vercel CLI en modo estrictamente read-only, por ejemplo `vercel env ls`, sin descargar valores a archivos locales y sin imprimir secretos.

Esta ruta requiere aprobacion explicita porque implica usar tooling adicional autenticado.

### Ruta alternativa - Abrir PR draft y monitorear

Solicitar autorizacion para abrir PR draft y monitorear checks/Preview.

Esta ruta es menos recomendable porque no cierra formalmente el gate solicitado por Arquitectura antes de abrir PR. Podria confirmar comportamiento despues de generar Preview, pero no resuelve la condicion previa de revisar variables por ambiente antes del PR.

No reabrir decision de PR draft hasta cerrar los bloqueantes principales o hasta que Arquitectura acepte explicitamente esta ruta con riesgo residual.

Este documento no autoriza abrir PR, mergear, cambiar variables Vercel, activar feature flag, redeploy, tocar Production Deployment, crear ciclos productivos, ejecutar SQL, tocar Supabase, modificar base de datos, modificar codigo funcional, hacer commit ni hacer push.
