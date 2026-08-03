## Alcance

<!-- Describe el objetivo técnico y funcional del PR. No uses descripciones genéricas. -->

- Objetivo:
- Fuera de alcance:

## Clasificación visual obligatoria

<!--
Marca exactamente una clasificación principal.
“Sin cambio visible” incluye infraestructura aislada sólo cuando no se monta ni conecta a la UI.
-->

- [ ] Sin cambio visible, incluida infraestructura aislada no montada ni conectada a UI
- [ ] Cambio visual aprobado
- [ ] Cambio visual no aprobado — **BLOQUEADO**

Justificación de la clasificación:

### Declaración secundaria de infraestructura visual

<!-- Esta declaración no reemplaza la clasificación principal. Marca una opción. -->

- [ ] No contiene infraestructura visual aislada
- [ ] Contiene infraestructura visual aislada y no montada

Artefactos de infraestructura incluidos o justificación de “No contiene”:

Evidencia técnica de que no se importa desde una pantalla productiva, monta, activa ni conecta a UI:

### Comprobación documental de coherencia

- [ ] Se marcó exactamente una clasificación principal
- [ ] Si contiene infraestructura visual aislada, la clasificación principal es “Sin cambio visible”
- [ ] Si contiene infraestructura visual aislada, el diff no incluye su conexión visible
- [ ] Si el diff monta, activa o conecta UI, se clasificó como cambio visible aprobado o como cambio visible no aprobado y bloqueado

### Inventario exacto de cambios visibles

<!-- Para cada fila escribe qué agrega, elimina o modifica. Usa “Ninguno” sólo si es verdadero. -->

| Tipo | Agrega | Elimina | Modifica | Pantalla/ubicación |
| --- | --- | --- | --- | --- |
| Card |  |  |  |  |
| Button |  |  |  |  |
| Section |  |  |  |  |
| Modal |  |  |  |  |
| Drawer |  |  |  |  |
| Texto visible |  |  |  |  |
| Otro cambio visible |  |  |  |  |

## Gates de aprobación de producto

<!--
Un cambio visual no puede tener commit ni PR sin aprobación previa explícita.
No marques estas casillas si no hay evidencia trazable.
Auditoría técnica ≠ aprobación de producto.
-->

- Captura o wireframe previo: <!-- enlace o referencia -->
- Aprobación previa explícita del dueño de producto: <!-- enlace/referencia, rol, fecha y texto inequívoco -->
- [ ] La aprobación previa cubre exactamente el alcance y el wireframe declarados
- [ ] Confirmo que la aprobación no corresponde sólo a una auditoría técnica

## Evidencia final

- Before: <!-- captura de la misma pantalla/estado/viewport/tema; si no existía, mostrar punto de inserción -->
- After: <!-- captura de la misma pantalla/estado/viewport/tema -->
- Preview URL: <!-- URL revisable, sin tokens ni credenciales -->
- Aprobación final explícita del dueño de producto: <!-- enlace/referencia, rol, fecha y texto inequívoco tras revisar Preview -->

## QA mobile

- Dispositivo/viewport: iPhone 15 Pro Max / <!-- dimensiones -->
- Navegador:
- Tema:
- Flujo probado:
- Resultado:

- [ ] Layout y jerarquía visual verificados
- [ ] Interacción, scroll y estados verificados
- [ ] Teclado y safe areas verificados, si aplica
- [ ] Ausencia de contenido, acciones o resúmenes duplicados verificada
- [ ] Before/After corresponden al diff actual
- [ ] Preview corresponde al commit actual

## Separación infraestructura / conexión

- [ ] Este PR no mezcla infraestructura visual con su conexión visible
- PR de infraestructura relacionado: <!-- enlace o “No aplica” con justificación -->
- PR de conexión visual relacionado: <!-- enlace o “No aplica” con justificación -->

## Validación técnica

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `git diff --check`

Resultados y excepciones justificadas:

## Gate final

- [ ] Todo elemento visible del diff aparece en el inventario exacto
- [ ] No se agregan Card, Button, Section, Modal, Drawer ni textos visibles no declarados
- [ ] La evidencia de aprobación pertenece al dueño de producto y es explícita
- [ ] El resultado final coincide con lo aprobado; cualquier diferencia fue reaprobada
- [ ] El PR cumple [`docs/visual-governance.md`](../docs/visual-governance.md)

> Si un cambio visual carece de declaración o aprobación explícita, el commit, el PR y el merge quedan bloqueados. No solicitar review ni merge con evidencia pendiente.
>
> Estos gates son controles de proceso y revisión humana; esta plantilla no afirma ni implementa enforcement automático.
