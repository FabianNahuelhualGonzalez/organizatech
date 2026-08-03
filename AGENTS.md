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
