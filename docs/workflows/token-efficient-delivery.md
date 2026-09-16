# Protocolo de entrega eficiente

## Objetivo

Resolver cada solicitud con el menor uso razonable de contexto, agentes, razonamiento y validaciones, sin reducir seguridad, estabilidad ni calidad.

## Unidad de trabajo

Cada tarea debe tener:

- un entregable concreto;
- una branch y worktree identificados;
- alcance de archivos y exclusiones;
- criterios de aceptación;
- validaciones proporcionales;
- una condición explícita de detención.

Abrir una conversación nueva por entregable. La conversación recibe `AGENTS.md` y sólo el handoff o documento de producto relevante.

## Clasificación

| Tipo | Ejecución predeterminada |
| --- | --- |
| Pequeña | Trabajo directo, sin agentes, pruebas focalizadas |
| Normal | Trabajo directo, pruebas focalizadas y de feature |
| Grande | Trabajo directo; máximo uno o dos agentes si separan responsabilidades |
| Crítica | Análisis más profundo y auditoría focalizada; incluye auth, autorización, RLS, pagos, datos sensibles, migraciones destructivas y PROD |

## Flujo

1. Confirmar branch, worktree, estado, stash y alcance.
2. Leer sólo los archivos afectados y dependencias demostradas.
3. Implementar el parche mínimo.
4. Ejecutar pruebas focalizadas.
5. Corregir sólo errores relacionados.
6. Ejecutar la suite de la feature una vez al cierre.
7. Ejecutar typecheck, lint o build global sólo si el alcance lo justifica o como gate final acordado.
8. Auditar una vez el diff y las dependencias directas cuando corresponda.
9. Preparar inventario y comandos para que el dueño haga commit/push.
10. Detenerse y esperar QA manual.

## Auditoría

- Modelo predeterminado solicitado: GPT-5.6 Sol, exigencia media, read-only.
- Un PASS cierra la auditoría; no buscar mejoras indefinidamente.
- Un FAIL debe listar hallazgos concretos. Se corrigen sólo esos hallazgos y se reaudita el delta de corrección.
- La auditoría completa del repositorio se reserva para solicitudes explícitas o cambios transversales de alto riesgo.

## Conductor y automatizaciones

Usar Conductor cuando una actividad grande necesite aislamiento estable, ownership separado o trabajo paralelo sin archivos compartidos. No usarlo por rutina para bugs acotados.

No programar mediante una tarea automática cada pocos minutos. Las automatizaciones se reservan para observar un proceso externo o retomar una espera, con cadencia razonable, salida silenciosa si nada cambia y condición de cierre.

## Base de datos y ambientes

- Crear migraciones mínimas y versionadas.
- Revisar ownership, allowlists, RLS, grants, `WITH CHECK`, `SECURITY DEFINER` y `search_path` cuando apliquen.
- Validar localmente; ejecutar primero en QA sólo con autorización exacta.
- PROD requiere QA PASS y autorización separada.
- No usar credenciales entregadas por chat ni publicar secretos.

## Plantilla diaria

> Lee `AGENTS.md` y únicamente `[documento relevante]`. Implementa `[mejora]` en `[branch/worktree]`. Limita el análisis al alcance y dependencias necesarias. No uses agentes salvo valor real; máximo dos. No hagas refactors fuera del alcance. Implementa, valida, corrige errores relacionados y detente. Audita el diff sólo si corresponde. No hagas commit/push: entrega inventario y comando seguro al dueño.
