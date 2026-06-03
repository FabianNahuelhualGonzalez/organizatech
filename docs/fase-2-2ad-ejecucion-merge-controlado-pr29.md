# Fase 2.2AD - Ejecucion controlada de merge PR #29

## 1. Contexto

Arquitectura aprobo el cierre formal de la Fase 2.2AC y autorizo iniciar la Fase 2.2AD para ejecutar el merge controlado del PR #29 hacia `main`.

Estado inicial autorizado:

- Fase 2.2AC cerrada y aprobada.
- PR #29 listo para merge desde el punto de vista tecnico.
- Feature flag `ENABLE_TRAINING_CYCLES_REPOSITORY` OFF/no configurada en Production.
- Activacion Training Cycles bloqueada para una fase posterior separada.
- No se autorizo activar feature flag.
- No se autorizo cambiar variables Vercel.
- No se autorizo redeploy manual.
- No se autorizo SQL, `supabase db push` ni `supabase migration repair`.

## 2. Gate pre-merge final

Gate ejecutado antes de intentar cualquier merge.

### Estado PR #29

| Campo | Resultado |
| --- | --- |
| PR | `https://github.com/FabianNahuelhualGonzalez/organizatech/pull/29` |
| Estado | `open` |
| Draft | `true` |
| Base | `main` |
| Base SHA | `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610` |
| Head | `feature/training-sessions-fuente-verdad` |
| Head SHA | `fddae835d542eb4b4e8bc362124d5c77b2de3a96` |
| Merged | `false` |
| Mergeable | `true` |
| Merge commit SHA calculado | `b2a03be41af8dab34d3ec0d7a89caa4bbcda8ee4` |
| Commits | `20` |
| Archivos cambiados | `25` |
| Additions / deletions | `7783 / 12` |

### Checks

Check visible sobre `fddae835d542eb4b4e8bc362124d5c77b2de3a96`:

```text
Vercel: success
```

### Preview QA

Deployment Preview del PR #29:

| Campo | Resultado |
| --- | --- |
| Deployment ID | `dpl_JCsZJ3hUdbE2HwLknw8CEuPT8uV8` |
| URL | `organizatech-gn26c03hj-fanahuelhualg-8514s-projects.vercel.app` |
| State | `READY` |
| Target | `null` |
| Branch | `feature/training-sessions-fuente-verdad` |
| Commit | `fddae835d542eb4b4e8bc362124d5c77b2de3a96` |
| GitHub PR | `29` |

Resultado de `/qa/training-cycles` en Preview:

```text
HTTP 200 OK
VERCEL_ENV=preview
QA tools=enabled
Supabase env=qa
Acceso=permitido
```

### Production antes del merge

Ultimo deployment Production observado antes del intento de merge:

| Campo | Resultado |
| --- | --- |
| Deployment ID | `dpl_8gWk9GkYQL61WmrLawus3bGB7dvc` |
| URL | `organizatech-ov6fpl0ed-fanahuelhualg-8514s-projects.vercel.app` |
| Target | `production` |
| Branch | `main` |
| Commit | `f6c00ebc0a27bc46d810d67519bdb5fd7d3c0610` |
| State | `READY` |

Validaciones HTTP sobre Production antes del intento:

```text
/ -> HTTP 200 OK
trainingCyclesRepositoryEnabled=false
/qa/training-cycles -> HTTP 200 OK con Acceso bloqueado
VERCEL_ENV=production
QA tools=disabled
Supabase env=not-set
```

Lectura TI: Production estaba intacta antes del intento de merge y la feature flag productiva seguia OFF/no configurada segun evidencia de runtime (`trainingCyclesRepositoryEnabled=false`) y bloqueo QA en Production.

### Archivos sensibles

El diff del PR fue revisado por comparacion `main...feature/training-sessions-fuente-verdad`:

- No aparece `supabase/.temp/`.
- No aparecen archivos `.env`.
- Archivos esperados: documentacion 2.2H-2.2AC, codigo 2.2S, script aislado versionado y migracion `20260531_training_cycles.sql`.

## 3. Ejecucion

Resultado de ejecucion: `abortado`.

GitHub mantenia el PR #29 en Draft. Como 2.2AC habia documentado que GitHub normalmente exige cambiar un PR Draft a Ready for review antes del merge, se intento ejecutar el paso autorizado de Ready.

### Intento de cambiar Draft a Ready

Metodo:

```text
Conector GitHub: markPullRequestReadyForReview
```

Resultado:

```text
Error code: UNKNOWN
GithubGraphQLAPIError
FORBIDDEN
Resource not accessible by integration
```

Interpretacion:

- El bloqueo corresponde a permisos de la integracion GitHub/Codex.
- Causa raiz: la integracion GitHub/Codex no dispone del scope de escritura necesario para modificar el PR.
- No corresponde a conflicto del PR.
- No corresponde a fallo de checks.
- No corresponde a cambio inesperado en el diff.
- El PR no cambio a Ready.

### Intento de merge directo con expected head SHA

Como el merge estaba autorizado y el gate pre-merge estaba OK, se intento merge directo usando el head esperado:

```text
expected_head_sha=fddae835d542eb4b4e8bc362124d5c77b2de3a96
merge_method=merge
```

Resultado:

```text
Error code: FORBIDDEN
GitHub API error 403
Resource not accessible by integration
```

Interpretacion:

- El bloqueo corresponde a permisos de la integracion GitHub/Codex.
- Causa raiz compartida con el intento Draft -> Ready: la integracion GitHub/Codex no dispone del scope de escritura necesario para modificar el PR ni ejecutar el merge.
- El intento de merge directo no revelo una causa distinta; fue la misma restriccion de permisos aplicada sobre otro endpoint de GitHub.
- El merge no se ejecuto.
- `main` no cambio.
- No se genero deployment Production nuevo asociado al merge.

### Estado posterior inicial del PR desde Codex

Verificacion posterior al bloqueo:

| Campo | Resultado |
| --- | --- |
| Estado | `open` |
| Draft | `true` |
| Merged | `false` |
| Mergeable | `true` |
| Head SHA | `fddae835d542eb4b4e8bc362124d5c77b2de3a96` |

### Postcheck manual posterior al merge

TI reporto evidencia manual posterior a la ejecucion desde GitHub.com:

```text
PR #29 fue mergeado manualmente en GitHub.
GitHub main muestra: Merge pull request #29.
Commit visible en main: d615a83.
main actualizado correctamente.
```

Lectura TI:

- El merge manual fue ejecutado correctamente.
- La autorizacion de 2.2AD cubria esta ejecucion manual.
- La limitacion de Codex quedo acotada a permisos de integracion, no al estado tecnico del PR.

## 4. Vercel Production

Postcheck manual posterior al merge:

```text
Vercel Deployments revisado con filtro Production.
No aparece deployment Production nuevo asociado al PR #29.
GitHub repo sidebar muestra Preview reciente y Production hace 3 dias.
```

Ultimo Production visible reportado por TI:

```text
Merge pull request #28
commit f6c00eb
hace 3 dias
```

Lectura TI:

- Merge GitHub: OK.
- Autodeploy Production Vercel: no observado / pendiente.
- Production sigue en el deployment anterior.
- No hubo redeploy manual.
- No se cambiaron variables Vercel.
- No se activo `ENABLE_TRAINING_CYCLES_REPOSITORY`.

## 5. Postchecks

Postchecks posteriores al merge manual:

Estado confirmado:

- GitHub main contiene el merge manual del PR #29 segun evidencia TI.
- Commit visible en main: `d615a83`.
- Vercel Production deployment nuevo: no observado / pendiente.
- Production sigue en deployment anterior asociado a PR #28 (`f6c00eb`).
- No se hizo redeploy manual.
- No se cambiaron variables Vercel.
- No se activo `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Training Cycles sigue bloqueado para usuarios finales.
- No se creo microciclo productivo real.
- `public.training_cycles` no fue consultada en esta fase para evitar SQL.
- `training_sessions` y `exercise_entries` no fueron consultadas en esta fase para evitar SQL.

Estado de `public.training_cycles`:

- Estado esperado segun cierre 2.2P: existe y vacia.
- No se revalido con SQL en 2.2AD por restriccion vigente.
- No hubo acciones SQL/Supabase que pudieran modificarla desde Codex en esta fase.

## 6. Seguridad

Confirmaciones de seguridad de la fase:

- No se activo feature flag.
- No se cambiaron variables Vercel.
- No se hizo redeploy manual.
- No se toco Production Deployment manualmente.
- No se creo microciclo productivo real.
- No se expuso Training Cycles a usuarios finales.
- No se ejecuto SQL.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se toco Supabase remoto.
- No se modifico base de datos.
- No se modifico codigo funcional.
- No se commiteo `supabase/.temp/`.

## 7. Resultado

Resultado final de 2.2AD:

```text
Merge ejecutado: si, manualmente en GitHub.com
Commit visible en main: d615a83
Resultado Codex: intentos Ready/merge bloqueados por permisos de integracion
Resultado manual: merge GitHub OK
Autodeploy Production Vercel: no observado / pendiente
Production: sigue en deployment anterior
Feature flag: OFF/no configurada
Training Cycles: bloqueado en UI productiva
```

La causa de aborto desde Codex no fue tecnica del PR ni del deployment. La causa fue falta de permisos de la integracion para:

1. Cambiar Draft a Ready for review.
2. Ejecutar merge del PR.

La ejecucion manual posterior resolvio el merge en GitHub, pero no se observo autodeploy Production nuevo en Vercel.

Consecuencia operacional:

- GitHub `main` contiene el merge del PR #29 y el commit visible `d615a83`.
- Vercel Production nuevo no fue observado.
- Production sigue en el deployment anterior asociado a PR #28 / `f6c00eb`.
- Ese deployment es anterior a 2.2S.
- Production actualmente ejecuta el codigo de deployment anterior, pre-2.2S.
- El gating `ENABLE_TRAINING_CYCLES_REPOSITORY` fue introducido en la fase 2.2S.
- Mientras Production no sea actualizado con el deployment del merge del PR #29, configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` en Vercel no activaria Training Cycles, porque el codigo desplegado actualmente no lee esa variable.
- Activar la variable ahora seria inefectivo y no debe hacerse.
- La activacion de Training Cycles requiere primero resolver el autodeploy/deployment pendiente de Production.

## 8. Siguiente paso recomendado

Ruta recomendada para Arquitectura:

1. Mantener activacion Training Cycles bloqueada.
2. No activar `ENABLE_TRAINING_CYCLES_REPOSITORY`.
3. No cambiar variables Vercel.
4. No hacer redeploy manual sin aprobacion explicita de Arquitectura.
5. Preparar una fase separada para una de estas rutas:
   - diagnostico read-only de por que Vercel no genero Production deployment tras el merge;
   - redeploy controlado de Production, solo si Arquitectura lo autoriza explicitamente.
6. Mantener evidencia de que Production sigue en el deployment anterior hasta resolver el punto Vercel.

Fase siguiente recomendada:

```text
Fase 2.2AE - Diagnostico read-only de Vercel/autodeploy Production
```

Objetivo propuesto:

1. Confirmar si el commit `d615a83` tiene algun deployment en Vercel, en cualquier estado.
2. Confirmar si el webhook de GitHub a Vercel fue recibido/procesado.
3. Revisar si existe regla de Ignored Build Step o condicion que omitio deployment.
4. Confirmar si se requiere redeploy manual controlado o re-disparo controlado, sin ejecutarlo todavia.

La autorizacion de Arquitectura para 2.2AD cubria la ejecucion manual en GitHub.com. No se requirio una nueva aprobacion de Arquitectura para la ejecucion manual, ya que el alcance autorizado incluia cambiar el PR de Draft a Ready si GitHub lo exigia y ejecutar el merge a `main`.

Si Arquitectura prefiere resolver futuras acciones de GitHub desde Codex, se requiere una fase previa para habilitar permisos de la integracion GitHub o instalar/autenticar `gh` localmente. En el entorno actual, `gh` no esta disponible:

```text
gh: no reconocido como comando
```

## 9. Confirmaciones finales

- Gate pre-merge final ejecutado.
- PR #29 seguia abierto, Draft, `merged=false`, `mergeable=true` antes del intento desde Codex.
- Checks OK.
- Preview QA OK.
- Production intacta antes del intento.
- Intento de Ready ejecutado y bloqueado por permisos.
- Merge intentado y bloqueado por permisos.
- Merge manual posterior ejecutado en GitHub.com.
- Main muestra `Merge pull request #29`.
- Commit visible en main: `d615a83`.
- No se observo Production deployment nuevo.
- Production sigue en deployment anterior (`f6c00eb`, PR #28).
- No se activo feature flag.
- No se cambiaron variables Vercel.
- No se hizo redeploy manual.
- No se ejecuto SQL.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se toco Supabase remoto.
- No se creo microciclo productivo real.
- No se hizo commit ni push.
