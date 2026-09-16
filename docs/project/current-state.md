# Estado operativo actual

Actualizado: 2026-09-15.

Este documento es un índice, no un historial. Actualizarlo sólo cuando cambie un gate relevante y mover los detalles a un handoff específico.

## Base compartida

- `origin/main`: `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`.
- Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`; no tocar sin autorización.
- Las tareas automáticas de implementación están pausadas y no deben reactivarse para programar.

## Entregables abiertos

| Prioridad | Entregable | Estado | Documento |
| --- | --- | --- | --- |
| 1 | Persistencia al guardar ciclo/entrenamiento | FAIL funcional; requiere diagnóstico | [`training-cycle-save-persistence.md`](../handoffs/training-cycle-save-persistence.md) |
| 2 | Panel Coach y vinculación | REQUIERE MÁS TRABAJO; preservado localmente | [`coach-dashboard-linking.md`](../handoffs/coach-dashboard-linking.md) |

## Orden de reanudación

1. Terminar y versionar esta migración documental.
2. Abrir una conversación nueva para la persistencia del entrenamiento.
3. Entregar Preview y esperar QA manual del dueño.
4. Retomar Panel Coach en su worktree existente mediante una tarea Conductor acotada.
5. Aplicar migraciones Coach primero en QA, únicamente después de PASS técnico, auditoría y autorización exacta.
