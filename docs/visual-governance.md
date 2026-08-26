# Gobernanza de cambios visuales

## Propósito

Esta política evita que un cambio visible para usuarios llegue al repositorio o a producción sin aprobación explícita del dueño de producto. Aplica a toda persona, agente o automatización que proponga, implemente, revise o despliegue cambios.

Una auditoría técnica valida aspectos como calidad, seguridad, accesibilidad o ausencia de regresiones. **Una auditoría técnica no equivale a aprobación de producto** y nunca reemplaza los gates definidos aquí.

## Qué se considera un cambio visual

Es cambio visual cualquier alta, eliminación o modificación perceptible en la interfaz, incluyendo layout, estilos, jerarquía, contenido, orden, estados, interacciones o comportamiento visible.

Si el cambio agrega, elimina o modifica una **Card, Button, Section, Modal, Drawer o texto visible**, debe declararlo expresamente con ese nombre. No se aceptan descripciones genéricas como “ajustes de UI”, “mejoras visuales” o “refactor menor”.

## Clasificación visual

Todo PR debe marcar exactamente una clasificación principal:

1. **Sin cambio visible:** el diff no produce cambios perceptibles. Esta clasificación incluye infraestructura visual aislada únicamente cuando no se importa desde una pantalla productiva, monta, activa ni conecta a la UI.
2. **Cambio visual aprobado:** existe un efecto perceptible y están completas las aprobaciones y evidencias obligatorias de esta política.
3. **Cambio visual no aprobado — bloqueado:** existe o se pretende conectar un efecto perceptible sin completar las aprobaciones obligatorias. No puede avanzar a commit, PR ni merge.

La presencia de **infraestructura visual aislada y no montada** es una declaración secundaria, no una cuarta clasificación principal. Un PR de infraestructura desconectada debe marcar simultáneamente:

- clasificación principal: `Sin cambio visible`;
- declaración secundaria: `Contiene infraestructura visual aislada y no montada`.

La siguiente comprobación documental es obligatoria:

| Situación del diff | Clasificación principal | Declaración secundaria | Resultado de revisión |
| --- | --- | --- | --- |
| No contiene infraestructura visual ni efecto perceptible | Sin cambio visible | No contiene infraestructura visual aislada | Coherente |
| Contiene infraestructura visual, pero no la monta ni conecta | Sin cambio visible | Contiene infraestructura visual aislada y no montada | Coherente; debe aportar evidencia técnica de aislamiento |
| Monta o conecta un efecto perceptible con evidencia completa | Cambio visual aprobado | No contiene infraestructura visual aislada en este PR | Coherente; aplican todos los gates visuales |
| Monta o conecta un efecto perceptible sin aprobación completa | Cambio visual no aprobado — bloqueado | No contiene infraestructura visual aislada en este PR | Bloqueado por política |
| Mezcla infraestructura nueva y su conexión visible | No corresponde | No corresponde | Incoherente; separar en PRs distintos |

Para demostrar aislamiento, el autor debe listar los artefactos preparados y aportar evidencia técnica revisable de que ninguna pantalla productiva los importa, monta, activa o conecta. Si el diff produce cualquier efecto perceptible, deja de ser infraestructura aislada y debe clasificarse como cambio visual aprobado o cambio visual no aprobado y bloqueado.

## Evidencia obligatoria

La evidencia debe quedar en un medio trazable y accesible para quienes revisan el cambio. No se deben copiar secretos, datos personales, contenido productivo ni enlaces privados con credenciales.

Todo cambio visual debe incluir:

1. **Declaración exacta de alcance:** qué agrega, qué elimina y qué modifica, indicando pantalla, ubicación y cada elemento visual afectado. Si una categoría no tiene cambios, se declara `Ninguno`.
2. **Captura o wireframe previo:** propuesta visual revisable antes de implementar o conectar la UI.
3. **Aprobación previa explícita del dueño de producto:** enlace o referencia trazable, identidad/rol del aprobador, fecha y texto inequívoco de aprobación del alcance y del wireframe. Silencio, ausencia de objeciones, aprobación técnica o un emoji aislado no cuentan.
4. **Capturas Before/After:** misma pantalla, estado, viewport y tema cuando sea posible. Si no existe un estado anterior, `Before` debe mostrar el punto de inserción y explicarlo.
5. **Preview URL:** despliegue revisable asociado al cambio, sin credenciales ni tokens embebidos en la URL.
6. **QA mobile:** resultado documentado usando iPhone 15 Pro Max como referencia, cubriendo viewport, tema aplicable, interacción, scroll, teclado/áreas seguras cuando corresponda y ausencia de duplicación visual.
7. **Aprobación final explícita del dueño de producto:** evidencia trazable de que revisó el resultado en Preview y las capturas finales. Si el resultado difiere del wireframe aprobado, se requiere una nueva aprobación explícita.

## Gates bloqueantes

Los siguientes gates son obligatorios y no admiten aprobación implícita:

| Gate | Evidencia mínima | Resultado si falta |
| --- | --- | --- |
| Antes de implementar | Declaración exacta + captura/wireframe previo | No iniciar la conexión visual |
| Antes de commit | Aprobación previa explícita del dueño de producto sobre alcance + captura/wireframe | **Commit bloqueado** |
| Antes de abrir PR | Aprobación previa trazable + declaración completa en la plantilla | **PR bloqueado** |
| Antes de solicitar review/merge | Before/After + Preview URL + QA mobile + aprobación final explícita | **Review y merge bloqueados** |
| Antes de producción | PR aprobado y gates anteriores completos | **Despliegue/promoción bloqueados** |

Si se detecta un cambio visual no declarado o no aprobado en cualquier etapa, se detiene el flujo. No se debe marcar una casilla sin evidencia, usar `N/A` sin justificación verificable ni trasladar la validación pendiente a después del merge.

Estos gates son controles de proceso sujetos a verificación humana. Este documento y la plantilla de PR no afirman ni implementan enforcement automático; la ausencia de automatización no autoriza omitirlos.

## Infraestructura y conexión visual

La infraestructura/preparación visual y su conexión visible son fases separadas y deben viajar en PRs separados:

- **Fase 1 — infraestructura aislada:** modelos, utilidades, primitives o preparación que no se importe desde una pantalla productiva, monte, active ni conecte a la UI. El PR debe usar la clasificación principal “Sin cambio visible”, marcar la declaración secundaria “Contiene infraestructura visual aislada y no montada” y aportar evidencia técnica de aislamiento.
- **Fase 2 — conexión visual:** importación, montaje, activación, copy o cualquier efecto perceptible. Se trata como cambio visual completo y requiere todos los gates y aprobaciones de esta política.

La aprobación de la fase de infraestructura no autoriza la conexión visual. Tampoco se puede ocultar una conexión visual dentro de un refactor, hotfix, cambio de datos o tarea técnica.

## Responsabilidades

- **Autor:** declara todo el alcance y reúne evidencia; no hace commit, abre PR ni solicita merge si falta el gate correspondiente.
- **Revisor técnico:** comprueba coherencia, seguridad, accesibilidad, pruebas y que la evidencia corresponda al diff; no concede aprobación de producto.
- **Dueño de producto:** aprueba explícitamente la propuesta antes del commit y el resultado final antes del merge.
- **Responsable del merge:** verifica que no haya elementos visibles fuera de la declaración y que todos los gates tengan evidencia válida.

## Incidente de referencia: resumen duplicado

En agosto de 2026 se conectó una tarjeta de compartir al resumen de cierre de entrenamiento. La conexión creó una segunda presentación del resumen sin aprobación explícita de producto. El hotfix PR #61 retiró la conexión visual no aprobada y mantuvo la infraestructura aislada.

Aprendizajes incorporados:

- una preparación técnica no autoriza su montaje en producción;
- toda Card y todo Button nuevos deben declararse y aprobarse expresamente;
- la revisión debe comprobar duplicaciones en el contexto completo de la pantalla;
- infraestructura y conexión visual deben revisarse en fases y PRs separados;
- el gate de producto es independiente del resultado de la auditoría técnica.

Este registro describe únicamente el comportamiento y la remediación. No contiene datos de usuarios, secretos, credenciales ni información sensible.

## Registro trazable AUTH-HYBRID-01

- Clasificación principal: `Cambio visual aprobado`.
- Pantalla y ubicación: `Registro > Coach`, inmediatamente bajo el título
  `Crear cuenta Coach`.
- Aprobador: dueño de producto de Organizatech.
- Fecha y referencia: instrucción `AUTH-HYBRID-01 — Corrección del modelo Coach
  híbrido y cierre de auditoría`, 2026-08-25, en el hilo de trabajo asociado.
- Alcance aprobado: agregar un selector accesible de elección única con
  `Usar mi cuenta Usuario` y `Crear una cuenta Coach separada`; mostrar los campos
  autorizados por el flujo elegido; usar los CTA `Iniciar sesión y continuar`,
  `Activar cuenta Coach` y `Crear cuenta Coach` exactamente donde corresponda.
- Texto visible aprobado: `¿Ya tienes una cuenta Organizatech Usuario? Puedes usar
  esa misma cuenta para acceder también como Coach. Si prefieres mantener ambas
  cuentas separadas, crea tu cuenta Coach con otro correo.`
- Card, Modal, Drawer y Section nuevos: ninguno.
- Button: no se agrega otro control de envío; el CTA existente cambia su etiqueta
  según el flujo aprobado. Las dos opciones son controles de selección, no submit.

Wireframe textual aprobado:

```text
Crear cuenta Coach
( ) Usar mi cuenta Usuario
( ) Crear una cuenta Coach separada
¿Ya tienes una cuenta Organizatech Usuario? Puedes usar esa misma cuenta para acceder también como Coach. Si prefieres mantener ambas cuentas separadas, crea tu cuenta Coach con otro correo.
[campos autorizados según la opción]
[CTA aprobado según la opción]
```

No se ejecutaron Preview, navegador ni QA mobile porque AUTH-HYBRID-01 los prohíbe
expresamente. Por lo tanto, Before/After material, Preview URL y QA iPhone 15 Pro
Max continúan pendientes. El diseño y el copy ya fueron aprobados por el dueño; un
commit técnico realizado por el dueño puede utilizarse para generar Preview, pero
Preview, merge y producción permanecen bloqueados hasta que el dueño registre
`PASS` de QA visual/manual.
