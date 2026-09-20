# Cumplimiento del ciclo y permanencia — evidencia de dominio

Este lote aporta sólo `coach-cycle-metrics.ts` y su test. No monta UI, consulta datos,
procesa pagos, modifica ciclos ni crea/cierra episodios. La fuente autorizada aporta
los hechos; estas funciones no demuestran ownership o consentimiento.

## Consumidores existentes, sin conexión nueva

Los contratos de presentación se inspeccionaron read-only en el worktree de
integración `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01`:

- `src/features/coach-clients/components/coach-clients-view.ts:29`:
  `CoachClientRowView.progressRatio` para la fila activa.
- `src/features/coach-dashboard/components/coach-renewal-detail-view.ts:18`:
  `facts.consistencyLabel` para presentar progreso, no faltas ni predicción.
- `src/features/coach-dashboard/components/coach-dashboard-view.ts:114`:
  `CoachRenewalsView.retentionLabel` para la permanencia media.

El read model existente ya separa `completedSessions` y `plannedSessions` en
`src/features/coach-clients/model/coach-client.ts:10`. No se cambia ese contrato ni
se crea un consumer productivo en este lote.

## Progreso: numerador y denominador independientes

`calculateCoachCycleProgress` recibe el plan y `completedSessions` explícito. Devuelve
los dos conteos y su fracción matemática, sin etiquetas ni redondeo de presentación.

- Plan: fechas civiles `startsOn` / `endsOn`, intervalo **inclusivo**, y códigos
  semanales seleccionados `TrainingDayCode`. Cuenta cada ocurrencia dentro del
  ciclo completo, incluidas las fechas futuras del plan. No usa semanas estimadas.
- La fuente debe entregar el conteo completo, autorizado y deduplicado de sesiones
  realizadas para ese mismo ciclo. No se vuelve a filtrar según el día real de
  ejecución: mover una sesión de lunes a martes no resta una sesión realizada.
- Una modificación del plan base es distinta de mover la ejecución de una sesión;
  el caller debe suministrar el plan correcto de ese ciclo, no otra versión/scope.
- La fracción es progreso de una meta, no porcentaje de faltas ni probabilidad de
  finalizar. `9 / 6 = 1.5` es válido si hubo sesiones extra. No se convierte en null
  ni se recorta a 1. El consumer visual podrá recortar geometría sin alterar hechos;
  eso está fuera de este módulo.
- `null` o un conteo inválido conserva el numerador desconocido. Un cero explícito
  sí es cero. Plan inválido/ausente conserva denominador null, no cero fabricado.
- Un plan explícitamente vacío, o sin ocurrencias seleccionadas en el intervalo,
  tiene denominador 0; la fracción queda null, nunca Infinity/NaN ni 100% inventado.
- Días repetidos, aliases no canónicos o más de siete entradas invalidan el plan;
  no se deduplica silenciosamente. No hay fallback a lunes.

No se recibe reloj/fecha actual: el paso del tiempo no transforma días futuros en
faltas ni crea sesiones realizadas. Fechas civiles de la fuente deben estar en la
zona de producto acordada; no se truncan timestamps UTC para convertirlos en días.

## Permanencia: sólo episodios finalizados

`calculateCoachAverageTenureDays` recibe una colección completa y autorizada de
episodios, deduplicada por su fuente. El modelo no descubre ni deduplica identidades.

- Cada episodio `ended` aporta `ordinal(endedOn) - ordinal(startedOn)` días civiles
  transcurridos. Un vínculo cerrado el mismo día aporta 0. La media puede ser
  fraccionaria; no se redondea ni se convierte en meses de 30 días.
- Esto no es un conteo inclusivo de días de asistencia ni bloques de 24 horas:
  atravesar DST no cambia el número de fechas civiles transcurridas.
- Episodios `active` quedan fuera del numerador y denominador. No se simula cierre
  con hoy ni se extrapola su duración. Su fecha inicial ausente no sesga la media
  de los finalizados.
- Sin colección o sin finalizados devuelve null. Si algún finalizado tiene fechas
  incompletas, inválidas o invertidas, toda la media queda null: excluirlo de forma
  silenciosa sesgaría la muestra.
- El estado finalizado es un hecho explícito de la fuente, no inferido del reloj.
  El caller debe garantizar que es real y vigente en su snapshot autorizado.

## Convenciones canónicas inspeccionadas

- Se reutiliza el tipo `TrainingDayCode` de `src/lib/progress/types.ts:5`.
- El orden lunes-domingo coincide con
  `src/lib/training/cycle-calendar-week.ts:5` y el mapeo de
  `src/lib/training/cycle-scoped-planned-date.ts:68`.
- El intervalo civil inclusivo y la repetición semanal coinciden con
  `src/lib/training/cycle-scoped-planned-date.ts:12`. El test compara resultados
  con ese helper existente en rangos parciales, bisiestos, DST y cambio de año.
- Sus parsers son privados (`cycle-scoped-planned-date.ts:39` y
  `cycle-calendar-week.ts:83`). Usan `Date.UTC` más roundtrip, que no acepta los
  años `0001–0099` por su tratamiento especial de años de dos dígitos.
- La convención estricta de calendario `YYYY-MM-DD`, años `1–9999`, existencia
  gregoriana y bisiestos está comprobada en
  `src/features/calendar-reminders/model/calendar-date.ts:53` y `:93`. No se importa
  ese runtime de otra feature ni se modifica ningún helper compartido.
- No existe entre los helpers lib inspeccionados un ordinal estricto exportado
  adecuado para ambas métricas. El módulo mantiene un ordinal local pequeño con
  aritmética gregoriana, sin Date, reloj ni conversión de zona; las pruebas verifican
  extremos `0001–9999`, siglos, bisiestos y concordancia con el helper cycle-scoped.

## Límites y validación

- Progreso: trabajo limitado a siete días seleccionados; no enumera cada fecha del
  intervalo. El máximo intervalo admitido contiene 3.652.059 días civiles, todavía
  entero exacto. Numerador exige entero seguro no negativo; no hay topes comerciales.
- Permanencia: O(n) episodios recibidos y O(1) memoria adicional. La suma comprueba
  overflow antes de acumular. El caller debe limitar el volumen/materialización de
  su fuente; no se crea aquí un límite de alumnos ni un fetch de historial ilimitado.
- Tests: null/0, conteos inválidos y extra, intervalos inclusivos/parciales, días
  repetidos/malformados, fechas estrictas y límites, cambio de ejecución, ciclo
  futuro, exclusión de activos, media fraccionaria y ausencia de mutación.
- Registrar `src/features/coach-dashboard/model/coach-cycle-metrics.test.ts` una sola
  vez en la suite DOMAIN es responsabilidad del lote de integración ROOT. Este lote
  no modifica package.json ni hashes de contratos compartidos.
- La validación focal y estática no sustituye la auditoría independiente posterior
  ni QA manual del dueño. No se afirma integración productiva ni cobertura end-to-end.

## Integración local y auditoría

Los tres archivos se integraron byte-idénticos en ROOT. El focal se registró una
sola vez en la suite DOMAIN:130 pruebas PASS. Lote18 integrado con invitaciones
y adaptador pasó npmtest pre/main/post, lint, build, typecheck y diff-check.
Auditoría independiente GPT-5.6 Sol, exigencia media: PASS sin hallazgos; el auditor
ejecutó personalmente focal combinado49/49 y comprobó integridad del inventario.
Evidencia: `/tmp/organizatech-coach-invitations-integrated.GOScwN/sol-audit-r2.md`.
Esto no valida fuentes reales autorizadas, montaje, QA manual ni producto completo.
