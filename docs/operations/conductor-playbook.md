# Playbook de Conductor

`AGENTS.md` es la regla principal del repositorio. Este playbook sólo define el uso operativo de Conductor y no reemplaza sus políticas de seguridad, entornos ni Git.

## Abrir y ejecutar una tarea

- Crear una tarea y un worktree por cambio independiente, con branch, alcance, exclusiones y validaciones definidos.
- Usar el mismo worktree únicamente para implementación, auditoría y corrección del mismo diff.
- Codex implementa. Claude audita en modo read-only el diff exacto; no modifica archivos ni amplía el alcance.
- Elegir Plan Mode para cambios amplios, migraciones, seguridad o navegación. Usar Fast Mode sólo para fixes pequeños, claros y de bajo riesgo.
- Antes de editar: comprobar branch, base, `git status` y stash. Los stashes no se tocan.

## Paralelizar o secuenciar

- Paralelizar sólo tareas con ownership de archivos, contratos y migraciones totalmente distintos.
- Secuenciar cambios que compartan archivos, contratos, migraciones, seguridad, navegación o integración.
- No ejecutar dos agentes sobre el mismo diff. La auditoría read-only se hace al cerrar la implementación.
- El script `dev` es local y usa `CONDUCTOR_PORT`, por lo que varios worktrees pueden levantar servidores sin colisionar. No iniciar Preview para sustituir QA manual.

## Cierre de cada tarea

1. Mantener el diff pequeño y dentro del alcance.
2. Ejecutar las validaciones proporcionales y revisar `git diff --check`.
3. Solicitar auditoría cuando corresponda; corregir sólo hallazgos concretos y reauditar ese delta.
4. Entregar al dueño inventario exacto, resultado de validaciones, riesgos y comandos de commit. El dueño hace commit y push.
5. El dueño ejecuta QA manual; QA precede a PROD y cualquier cambio remoto requiere su autorización explícita.
6. Con QA PASS y el cambio integrado, archivar el worktree/tarea. No archivar ni borrar ramas antes de ese gate.

## Datos locales y secretos

La configuración compartida no copia archivos ignorados a worktrees nuevos. No copiar, leer ni versionar `.env`, credenciales, tokens, cookies, secretos ni archivos locales. Si una tarea depende de configuración local, detenerse y pedir al dueño un mecanismo seguro sin incluirla en Conductor.
