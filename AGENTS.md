# Organizatech — instrucciones permanentes

## Autoridad, seguridad y entornos

- El dueño de producto define y aprueba pantallas, campos, textos, comportamientos y alcance. No ampliar una solicitud ni conectar UI visible sin su aprobación explícita.
- Producción está activa: priorizar estabilidad, seguridad, compatibilidad y ausencia de regresiones. QA siempre precede a PROD.
- No modificar Supabase remoto, variables de entorno, DDL/DML, QA o PROD sin autorización explícita y específica para ese destino.
- No usar ni exponer `service_role`, contraseñas, tokens, JWT, cookies, secretos o datos personales.
- El dueño de producto ejecuta commit y push. Antes de entregarle comandos, mostrar estado, diff, inventario exacto y validaciones.
- La QA manual, visual y funcional corresponde al dueño de producto. Los agentes no abren Preview, QA o PROD para sustituir esa prueba.
- Preservar cambios y stashes existentes. No aplicar, borrar ni sobrescribir un stash sin autorización.

## Protocolo de eficiencia

- Tratar el repositorio, el código y la documentación vigente como fuente principal. Consultar historial sólo cuando sea necesario para la tarea actual.
- Una conversación y un worktree por entregable. No mezclar funcionalidades independientes en el mismo ciclo de implementación.
- Inspeccionar primero los archivos directamente afectados y ampliar sólo ante una dependencia comprobada.
- No hacer refactors, mejoras cosméticas, optimizaciones ni investigaciones fuera del alcance.
- No usar subagentes por defecto. Para una tarea grande o crítica, usar como máximo dos y sólo con responsabilidades distintas y justificadas.
- No usar tareas automáticas periódicas para programar. Reservarlas para esperas o monitoreo externo con condición clara de detención.
- Implementar, validar lo relevante, corregir hallazgos concretos y detenerse cuando el alcance esté correcto.
- Usar validación escalonada: pruebas focalizadas durante el desarrollo; suite de la feature al cierre; validación global sólo cuando cambien contratos compartidos, infraestructura o antes de un release que lo requiera.
- Auditar principalmente el diff, los archivos modificados y sus dependencias directas. No repetir una auditoría PASS. Ante FAIL, corregir los hallazgos y volver a auditar sólo esa corrección.
- Cuando se solicite auditoría independiente, usar GPT-5.6 Sol con exigencia media y modo read-only, salvo instrucción explícita distinta.
- Mantener respuestas y salidas acotadas: resultado, validaciones, riesgos reales, migraciones y siguiente gate.

El flujo detallado está en [`docs/workflows/token-efficient-delivery.md`](docs/workflows/token-efficient-delivery.md). El estado operativo resumido está en [`docs/project/current-state.md`](docs/project/current-state.md); los detalles efímeros pertenecen a handoffs, no a este archivo.

## Git y trabajo paralelo

- Todo cambio debe vivir en una branch y worktree propios cuando exista trabajo paralelo o el checkout principal tenga cambios ajenos.
- El dueño de producto crea branches y worktrees mediante comandos exactos preparados por el coordinador.
- Usar Conductor sólo cuando el aislamiento o paralelismo aporte valor real. No usarlo para un fix pequeño que ya tenga worktree dedicado.
- Ninguna actividad paralela puede compartir archivos, contratos o migraciones. Reservar los archivos compartidos para una integración secuenciada.
- No incluir `.env`, secretos, `supabase/.temp` ni archivos temporales.

# Reglas del composition root

Estas reglas aplican a toda persona o agente que modifique `src/components/organizatech-app.tsx`. La política completa y su checklist están en [`docs/architecture/composition-root-policy.md`](docs/architecture/composition-root-policy.md).

## Reglas ejecutables

- Mantener `organizatech-app.tsx` como composition root: sólo providers y boundaries globales, composición/selección de pantallas, conexión de controllers ya definidos y coordinación realmente transversal de sesión y navegación.
- No agregar UI extensa de features, reglas o cálculos de dominio, repositories/queries, normalización de formularios, parsing de storage, modelos derivados ni lógica propia de una feature.
- Ubicar por defecto cada feature en `src/features/<feature>/`, la UI compartida y estable en `src/ui/` y la infraestructura o dominio reutilizable en `src/lib/`.
- Mantener el estado de una sola feature dentro de esa feature. No crear un store universal; compartir estado sólo cuando existan múltiples consumidores reales y un contrato tipado.
- En todo cambio del root, declarar qué responsabilidad entra o sale y justificar cualquier lógica agregada. Preferir módulos pequeños, ownership claro y ausencia de dependencias cruzadas entre features.
- Mantener cada write detrás de una allowlist explícita. El cliente no puede aceptar ni modificar campos de ownership como `user_id`, `owner_id`, `profile_id` o equivalentes.
- La infraestructura no autoriza una conexión visible. No montar ni conectar componentes, Card, Button, resúmenes, Modal, Drawer o texto visible sin aprobación explícita del dueño de producto y sin cumplir [`docs/visual-governance.md`](docs/visual-governance.md).
- `ShareWorkoutCard` y `workout-share` deben permanecer desconectados de la UI. Una integración futura requiere alcance y aprobación de producto propios.
- Aplicar por ahora enforcement documental y revisión humana. No introducir límites de líneas ni hashes frágiles como sustituto de boundaries arquitectónicos.
- No adelantar ni renumerar P3-41–P3-45. Los contratos automatizados de boundaries/imports se proponen para P3-45.

Si un cambio contradice estas reglas, se bloquea hasta reducir su alcance o contar con una decisión arquitectónica y, cuando corresponda, una aprobación de producto explícitas.
