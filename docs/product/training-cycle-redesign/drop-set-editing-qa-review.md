# Drop set: orden de campos y sugerencias encadenadas

## Alcance aprobado — 2026-09-09

Referencia: decisiones numeradas del dueño y mejora prioritaria de ciclos
registradas en el hilo coordinador el 2026-09-09; captura previa
`CFA6FC54-240B-45D2-82AF-F0254BABC819/1-Foto-1.jpg`. La última frase confusa del
ejemplo fue retirada por el dueño y no se implementa.

Clasificación: **Cambio visual aprobado** sobre el editor existente, sin nueva
pantalla ni ampliación del selector de técnicas.

- **Section existente Descensos de carga:** se invierte el orden de sus campos
  y unidades: `reps → kg`, igual que la tabla principal. Se intercambian sólo
  los anchos de las columnas de unidad correspondientes, también en mobile.
- **Button, Card, Modal y Drawer:** ninguno nuevo ni eliminado. Los controles
  existentes de agregar/quitar descensos y de técnica se conservan.
- **Texto visible:** ninguno nuevo ni modificado.
- **Composición root, Coach, SQL, RPC, dependencias y entorno:** sin cambios.

Wireframe funcional de la modificación solicitada:

```text
DESCENSOS DE CARGA
↓1   [reps] reps   [kg] kg   [quitar]
↓2   [reps] reps   [kg] kg   [quitar]
[Agregar descenso]
```

El ejemplo autorizado mantiene cuatro series principales de 20 reps con igual
carga. Elegir Drop set no cambia sus cargas/reps ni las transforma en pirámide.
El comportamiento previo de entrada se conserva: si no hay descensos, se crea
uno en la última serie. El usuario puede abrir las acciones de cualquier serie
y usar Agregar descenso en esa serie concreta; no se agregan a todas. El ejemplo
de 10 reps por descenso se introduce editando el campo; el default existente de
8 reps no se cambia globalmente.

## Regla implementada y límite explícito

Resolución acotada confirmada por el coordinador antes de implementar la relación
reps/carga: mantener el descenso base existente de 0,8 y añadir una cota de
volumen sólo cuando el objetivo de reps supera al tramo anterior:

```text
kgSugeridos = redondeoHaciaAbajoA0,5(
  kgPrevios × 0,8 × min(1, repsPrevias / repsObjetivo)
)
```

Es una **heurística inicial editable de carga/volumen**, no un cálculo de fatiga,
capacidad real, seguridad clínica ni rendimiento garantizado. No se aplica
Epley ni se extrapola el recomendador de historial fuera de sus límites.
Menos reps objetivo nunca aumenta la carga por encima del descenso base del
20 %. Más reps objetivo puede reducirla adicionalmente.

Ejemplo de esta regla: 20×70 seguido de tres descensos de 10 reps sugiere
56 / 44,5 / 35,5 kg. Los 50 / 40 / 30 kg indicados por el dueño son ilustrativos,
no una tabla ni una fórmula obligatoria; siguen pudiendo configurarse manualmente.

## Edición y conservación

- Editar kg o reps de la serie elegida recalcula su cadena pendiente de
  sugerencias, sin alternar técnica ni cambiar las otras series principales.
- Editar reps de un descenso recalcula su carga sólo si todavía es sugerida y
  actualiza los siguientes descensos sugeridos usando el tramo precedente.
- Editar kg fija ese descenso como carga manual, incluso si coincide con la
  sugerencia anterior. Se conserva el string completo, también si iguala/supera
  la referencia previa o cruza la carga manual siguiente; no se restaura el valor
  anterior. Las sugerencias posteriores pueden seguir esa referencia.
- Una marca opcional `followsPreviousLoad` identifica sólo cargas generadas por
  este editor. No se infiere procedencia comparando números. La allowlist de
  payload excluye la marca: no cambia el contrato persistido ni la base de datos.
- Cargas recuperadas sin esa marca se tratan conservadoramente como manuales;
  abrir/reabrir un borrador no las recalcula. Después de recuperar un plan, sus
  descensos existentes siguen editables manualmente y los nuevos sí reciben
  sugerencias. No se promete conservar procedencia automática entre recargas.
- Un buffer incompleto/inválido permanece textual. Sólo se vacían cargas
  sugeridas dependientes de referencias inválidas, sin insertar cero, NaN ni
  valores por defecto. Al completar la referencia se recalculan otra vez.
- Si una carga manual deja de ser descendente tras cambiar su referencia, se
  conserva y el guardado queda bloqueado hasta que el usuario la corrija.
- Quitar un descenso o aceptar explícitamente una recomendación actualiza
  sugerencias pendientes; no pisa cargas manuales.
- Se mantienen los bloqueos de plan activo/sincronización pendiente y el
  autoguardado existente. La edición genera un único snapshot del reducer.

## Validaciones

Base: `b9c10874a81b6a0f6e0b21029bdf3556908adf4d`.
Branch: `codex/cycle-redesign-integration-01`.
Worktree: `/Users/fabiannahuelhual/Developer/organizatech-cycle-redesign-integration-01`.
Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`, intacto.

Frontend focal: PASS, 63 pruebas de reducer, siete de autoguardado, cuatro de URL,
cuatro de UI y contratos. Nueve casos nuevos del reducer cubren encadenado,
límites de carga/volumen, entrada numérica, preservación manual/recuperada,
selección de serie, guards y preparación/persistencia real con writer en memoria.

La UI se verifica ejecutando el TSX real con React en Node y disparando handlers;
primitives/CSS se sustituyen en ese contrato aislado. No es navegador ni QA de
layout, foco, teclado o contraste. La prueba comprueba orden DOM REPS/KG,
recálculo, carga manual y conservación de las otras principales.

Gates completos reejecutados tras corregir el hallazgo MEDIUM, secuencialmente y
todos con salida cero:

- `npm run test:training-cycle-builder-frontend`: PASS.
- `npm test`, incluidos pretest y posttest: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS, Next.js 15.5.18.
- `npm run typecheck`, después del build: PASS.
- `git diff --check`: PASS; archivos nuevos comprobados además sin incidencias
  de whitespace mediante diff no-index.

No se ejecutó `npm test` junto con build/typecheck: el contrato PERF-03 altera
temporalmente el root durante sus pruebas y el archivo quedó restituido.

Las guías React/Next mantienen la lógica dentro del reducer/helper de la feature,
sin nuevos effects, estado global ni ampliación de boundaries.

## Entrega y riesgos pendientes

La primera auditoría independiente Sol/medium resultó **FAIL, un hallazgo MEDIUM**:
el helper rechazaba silenciosamente kg completos no descendentes. Con referencia
70 kg, descenso sugerido 56 kg y siguiente descenso manual 40 kg, escribir 70,
80 o 35 kg dejaba 56 kg en el estado en lugar del texto introducido.

Corrección acotada: se eliminó el rechazo semántico de entrada. El reducer conserva
el texto y fija la carga manual; sólo recalcula sugerencias y deja intactas las
anclas manuales. La validación existente bloquea guardado/autoguardado ante cargas
iguales, ascendentes o que cruzan la siguiente carga manual. No cambian fórmula,
UI ni defaults. La regresión nueva cubre `70`, `80`, `35`, `40`, ` 80 `, `70,0` y
`35.0`, la referencia manual siguiente y el writer real: guarda primero una base
válida y confirma que la edición inválida no genera una segunda escritura. Antes
del fix la reproducción fallaba por conservar 56 kg; después pasa.

Reauditoría independiente GPT-5.6 Sol, exigencia media, read-only: **PASS**.
El auditor cerró el hallazgo MEDIUM de R1 y no detectó otros hallazgos. Verificó
el patch R2, los nueve hashes y el delta entre rondas; ejecutó independientemente
63 pruebas de reducer, siete de autoguardado, cuatro de URL y cuatro de UI: PASS.
Los gates completos anteriores corresponden al implementador; no se atribuyen
al auditor. Después del PASS sólo se reconcilió esta nota, sin cambiar código.

Preview, Before/After final y QA iPhone 15 Pro Max: pendientes exclusivamente del
dueño. Debe revisar orden de campos/unidades, teclado/scroll, editar la cuarta
serie, cambiar reps de cada descenso, ajustar una carga manual, recuperar un
borrador y comprobar persistencia y exclusión de otras series.

No hubo navegador, QA/PROD remoto, SQL, cambio de entorno, commit ni push.
Este fix no necesita una nueva migración. Resultado técnico local: **PASS**.
Código y auditoría: **PASS**, listo para commit/push manual del dueño a la rama
de Preview. Entrega integral: **REQUIERE MÁS PRUEBAS**. Debe verificarse el nuevo
despliegue del SHA publicado y después realizar QA manual; no autoriza merge ni
producción. El Preview anterior no contiene esta mejora sin publicar.
