# Proyección pura de una fila Coach

## Alcance y consumidor concreto

`projectCoachClientRow(client, metaLabel)` recibe un `CoachClient` ya autorizado y
produce una fila nueva congelada, o `null` si los campos consumidos de ese estado
son inválidos. No decide autorización, consentimiento, estado del vínculo,
listado, búsqueda, paginación ni acceso a actividad. No realiza I/O, formatea fechas,
crea etiquetas, modifica pagos ni monta UI.

Consumidor previsto, inspeccionado read-only en el entorno ROOT de integración:

- `src/features/coach-clients/model/coach-client.ts:9`: resumen de ciclo con
  conteos explícitos; `:17`, `:23` y `:31`: unión de estados y límites de identidad.
- `src/features/coach-clients/components/coach-clients-view.ts:16`: contrato
  canónico `CoachClientRowView`; `:43`: contenido con filas, vacío o mensaje.
- `src/features/coach-clients/components/coach-client-row.tsx:7`: componente
  `CoachClientRow`; `:12`: título con fallback al correo, `:19`: icono Mail cuando
  no hay iniciales, `:14`: geometría acotada, `:31`: etiqueta suministrada.
- `src/features/coach-clients/components/README.md:27`: límites de presentación;
  `:34`: datos ausentes, `:36`: privacidad de pendientes, `:43`: carga/error.
- Handoff original del dueño, fuera del worktree:
  `/Users/fabiannahuelhual/Desktop/handoff-vinculacion/reference.html:780` define
  `ini` con la primera inicial de hasta dos palabras;
  `/Users/fabiannahuelhual/Desktop/handoff-vinculacion/design-spec.md:189` exige
  avatar con iniciales. Sólo se inspeccionan como evidencia; no se copia HTML.

Esos componentes no están presentes en DOMAIN ni conectados a una pantalla
productiva. El retorno discriminado se infiere de las allowlists concretas; el
alias `CoachClientRowPresentation` no duplica el contrato UI. La integración ROOT
debe comprobar su asignabilidad al `CoachClientRowView` canónico. No se importan
archivos desde otro worktree ni se agrega un contrato UI provisional.

## Allowlist de salida

| Estado | Campos exactos |
| --- | --- |
| pending | `id`, `email`, `state`, `metaLabel` |
| inactive | base anterior más `name`, `initials` |
| active | base anterior más `name`, `initials`, `progressRatio` |

No se propagan ciclo, sesiones, código, ownership ni otros campos adicionales.
Pending ni siquiera lee nombre, iniciales, ciclo o código adjuntos. Inactive no
lee ciclo ni actividad: sólo conserva identidad histórica autorizada. Esto es
minimización de presentación, no un reemplazo del control de acceso del servidor.

`metaLabel` es un argumento obligatorio `string | null`, copiado sin cambios.
El caller debe entregar una etiqueta previamente autorizada para el estado:
metadata de invitación para pending e histórica para inactive, nunca actividad
actual ni identidad no consentida. Esta función no inspecciona el contenido de
texto libre ni decide si es lícito; tampoco deduce etiquetas desde los conteos.

`name` sólo procede de `displayName` autorizado, quitando espacios exteriores;
vacío o desconocido produce `null`. No se usa el helper legacy de nombre, porque
su fallback al correo no debe convertirse en identidad. `initials` deriva de ese
mismo nombre consentido, conforme al handoff: primer carácter de hasta dos
palabras, preservando mayúsculas/minúsculas sin conversión adicional. Los espacios
repetidos, tabs y separadores Unicode no generan palabras vacías; la iteración por
punto de código evita cortar pares sustitutos. No se añade normalización de texto
ni segmentación de grafemas compuestos. Si falta el nombre, `initials:null`
conserva el icono de respaldo del componente. No se consulta una cuenta a partir
del correo y los campos adicionales `name`/`initials` se ignoran.

Corrección de evidencia: la primera entrega buscó el handoff sólo en worktrees y
no aplicó su regla. El original sí está disponible en Desktop y la derivación de
iniciales autorizadas ahora sigue esa regla existente; no es diseño nuevo.

## Validez runtime y progreso

- Entrada esperada: objeto de datos `CoachClient`, no array; estado conocido;
  `id` y `email` string no vacíos tras trim. Se preservan sus valores originales;
  no se agrega una nueva política de formato de correo o identificador.
- Active e inactive exigen `displayName` string o `null`. Pending no lo lee: los
  campos prohibidos adicionales se descartan aun si contienen datos malformados.
- Active permite `cycle:null`. Un ciclo presente debe ser objeto con `id` no vacío,
  `description` string o `null`, y ambos conteos enteros seguros no negativos o
  `null`. Los campos requeridos ausentes son inválidos, no desconocidos explícitos.
- Cualquier campo consumido inválido devuelve `null` para la fila completa. No
  se construye una fila parcialmente falsa. Campos fuera del estado/allowlist
  no se validan ni rescatan; esto no es validación integral de una respuesta API.
- Conteos `null`, ciclo ausente o `plannedSessions = 0` conservan
  `progressRatio:null`. No se infieren sesiones realizadas ni se inventa `0/0`.
- Con ambos conteos conocidos y denominador positivo, se calcula
  `completedSessions / plannedSessions`, acotado a `[0, 1]` sólo para dibujar.
  Cero explícito produce ratio cero. Sesiones extra son válidas y producen uno.
  El modelo numérico del ciclo, sus conteos y su fracción original no se alteran;
  no se interpreta el ratio como probabilidad, cumplimiento futuro o faltas.

El contrato runtime se refiere a valores de datos ordinarios ya autorizados; no
ejecuta ni captura comportamiento arbitrario de proxies/accessors en campos
consumidos. Los campos prohibidos no se leen, probado con getters que arrojan.
`Object.freeze` basta para la salida: sólo contiene primitivas y no comparte
objetos anidados con la entrada. No se congela ni muta la entrada.

## Verificación y límites de entrega

Suite directa sin modificar el registro compartido:

```sh
./node_modules/.bin/tsx --test src/features/coach-clients/integration/coach-client-row-presentation.test.ts
```

La cobertura incluye allowlists por estado, PII adicional, actividad de bajas,
identidad ausente, iniciales según handoff, espacios repetidos y Unicode,
conteos nulos/cero/NaN/negativos/fraccionales/inseguros, objetivo
cero, sesiones extra, contratos malformados y salida congelada sin mutación.
El coordinador debe registrar esta suite en ROOT; `package.json` queda congelado
en DOMAIN. El incremento requiere auditoría independiente posterior y verificación
de integración. No constituye auditoría propia, QA manual, Preview, QA remoto ni
validación de flujo productivo. No se hace commit ni push.

Integración ROOT 09-09: patch corregido de iniciales transferido exacto. Único
delta de integración en el test: import type del CoachClientRowView canónico y
asignación tipada del retorno. Typecheck confirma asignabilidad sin duplicar
contrato. Suite registrada una vez en test:coach-dashboard-integration; 37
pruebas de integración (incluidas las 18 de fila), npm test completo, lint,
build, typecheck y diff secuenciales PASS. Auditoría independiente ROOT15
GPT-5.6 Sol medio PASS sin hallazgos bloqueantes; verificó el contrato canónico y
ejecutó 62 focales del lote y diff. Sólo este documento cambió tras su veredicto.
