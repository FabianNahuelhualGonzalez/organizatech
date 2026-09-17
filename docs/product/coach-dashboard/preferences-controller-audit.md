# Preferencias Coach — auditoría histórica del controller aislado

> Este documento registra el gate previo al montaje. La integración vigente está
> descrita en `integration-contract.md`.

## Veredicto

Código y auditoría estática independiente Claude: PASS del lote local, no del
flujo integrado. Sin QA manual, publicación ni cambios remotos.

Cinco archivos: contrato/controller/test en `coach-dashboard/hooks`, registro
focal/posttest en `package.json` y únicamente su hash en el contrato visual de
Active Workout. SHA-256 agregado de rutas relativas ordenadas + NUL + contenido:
`14bf4077dc7e469ace4e04a625d3560f07766d0834eca8d6078f5de1eff033fe`.

Quince pruebas focales, npm test completo, typecheck, lint, build y diff-check
exit0. Logs `/tmp/organizatech-coach-controller-{focal,npm-test,typecheck,lint,build}.log`.
Auditoría real read-only: `/tmp/organizatech-coach-controller-claude-audit.json`.
Claude no ejecutó esos gates; los resultados automáticos son del coordinador.

## Contrato comprobado

Estado confirmado separado del borrador, null distinto de cero, intención de
guardar con dos campos allowlisted y versión capturada. Una sola operación
pendiente entre lectura, tarifa e interés Chat; sin cierre o éxito optimista.
Errores conservan borrador, exigen lectura confirmada antes de otro write y
no producen reintentos automáticos. Interés Chat confirmado no altera versión
de tarifa. Identidad invalidada/dispose descartan respuestas tardías; forbidden
y stale limpian datos locales sin cerrar Auth. Snapshot copiado/inmutable.

## Límites no bloqueantes y obligaciones de integración

- El puerto recibe DTO ya validado/acotado del repository y operaciones con
  deadline; este controller no interpreta JSON remoto.
- Un controller por generación de identidad/portal; `isCurrent` no vuelve a
  true tras invalidarse esa generación y el consumidor ejecuta dispose.
- Parser monetario puro/total y predicado de identidad sin excepciones.
- El límite de versión presupone entero seguro de DATA; no es un segundo
  validador de respuestas remotas.
- Suscriptores de estado deben ser callbacks estables sin excepciones; los
  errores de suscriptores no se convierten en falsos errores de transporte.
- Compatibilidad estructural con DATA, adaptación de UI/recuperación, wiring
  de sesión y pruebas del flujo siguen pendientes. No está montado en producto.

No fuentes históricas inventadas, SQL, tokens, ownership modificable ni datos
de alumnos en este lote. No se copiaron fuentes entre worktrees.
