# Política del composition root

## Propósito y alcance

Esta política mantiene `src/components/organizatech-app.tsx` como composition root de Organizatech. Su función es ensamblar la aplicación sin convertirse en propietario de features, reglas de negocio o infraestructura de datos.

Aplica a toda persona, agente, refactor o tarea que agregue, retire o reubique responsabilidades relacionadas con el root. Las reglas resumidas y ejecutables para agentes están también en [`AGENTS.md`](../../AGENTS.md).

## Responsabilidades permitidas

`organizatech-app.tsx` se limita a:

- declarar providers y boundaries verdaderamente globales;
- seleccionar y componer pantallas;
- conectar controllers ya definidos mediante contratos tipados;
- coordinar sesión y navegación cuando la responsabilidad sea transversal a varias features;
- realizar el wiring mínimo entre esos contratos, sin reimplementar su lógica.

Que una responsabilidad sea usada por una pantalla no la vuelve global. Debe permanecer en su feature mientras pertenezca a un solo owner funcional, aunque tenga varios consumidores internos.

## Responsabilidades prohibidas

`organizatech-app.tsx` no debe contener:

- UI extensa o implementación visual propia de una feature;
- reglas de negocio o cálculos de dominio;
- repositories, queries ni acceso directo a persistencia;
- normalización o construcción de payloads de formularios;
- parsing, migración o sanitización de storage;
- modelos derivados que puedan vivir en selectors o módulos de dominio;
- estado, handlers o lógica propios de Profile, Training Plan, Active Workout, Progress, Notifications u otra feature;
- adaptadores genéricos creados sólo para ocultar que el root conserva ownership de una feature.

Una extracción no está completa si el archivo nuevo depende de estado interno del root, recibe objetos crudos sin contrato o devuelve mutaciones que mantienen el ownership real en `organizatech-app.tsx`.

## Ubicación y ownership por defecto

| Responsabilidad | Ubicación por defecto | Regla de ownership |
| --- | --- | --- |
| Feature, controller, estado y UI específica | `src/features/<feature>/` | Una feature es dueña de su lifecycle, intents, estado transitorio y coordinación interna |
| UI compartida y estable | `src/ui/` | Debe tener consumidores reales, API acotada y no conocer reglas de features |
| Infraestructura o dominio reutilizable | `src/lib/` | Debe ser independiente de pantallas y exponer contratos explícitos |
| Composición transversal | `src/components/organizatech-app.tsx` | Sólo wiring, providers/boundaries globales, sesión, navegación y selección de pantallas |

El estado utilizado por una sola feature permanece feature-local. No se debe crear un store universal ni mover estado al root por conveniencia. Compartir estado exige:

1. múltiples consumidores reales;
2. una fuente canónica identificada;
3. un contrato tipado y acotado;
4. lifecycle, reset por identidad y ownership definidos;
5. evidencia de que no introduce un segundo canon.

Las dependencias entre features deben evitarse. Si dos features necesitan la misma capacidad estable, se extrae un contrato compartido a `src/lib/` o una primitive de UI a `src/ui/`; una feature no debe importar detalles internos de otra.

## Seguridad de writes y datos

Mover una responsabilidad fuera del root no puede debilitar sus límites de seguridad:

- todo write usa una allowlist explícita de campos;
- formularios y componentes no envían objetos crudos a repositories o mutations;
- `user_id`, `owner_id`, `profile_id` y campos equivalentes nunca son editables desde el frontend;
- la identidad efectiva se deriva de la sesión autenticada y el servidor vuelve a validar ownership;
- los contratos compartidos no exponen tokens, secretos ni campos mutables de ownership;
- los cambios conservan guards de lifecycle, freshness y operation owner existentes;
- no se eliminan fallbacks legacy como efecto lateral de una extracción.

Un refactor de composición no autoriza cambios de RLS, Supabase remoto, variables de entorno ni schemas. Esos cambios requieren alcance y autorización separados.

## Protocolo para cambios del root

Todo cambio que toque `organizatech-app.tsx` debe registrar en la descripción del PR:

1. **Responsabilidad que entra:** nombre, owner y por qué es verdaderamente transversal; usar `Ninguna` si no aplica.
2. **Responsabilidad que sale:** destino, owner nuevo y contrato preservado; usar `Ninguna` si no aplica.
3. **Lógica agregada:** justificación concreta de por qué es wiring y no lógica de feature o dominio.
4. **Dependencias:** imports nuevos, consumidores reales y confirmación de que no se creó dependencia cruzada entre features.
5. **Estado y writes:** fuente canónica, lifecycle/reset y allowlists/ownership aplicables.
6. **Impacto visual:** clasificación y evidencia exigidas por [`docs/visual-governance.md`](../visual-governance.md).

Se prefieren cambios pequeños, módulos con un owner claro y contratos que puedan probarse de forma aislada. Un cambio de gran tamaño debe dividirse por responsabilidades, sin mezclar infraestructura, migración de ownership y conexión visual.

## Gobernanza visual

La existencia o creación de infraestructura no autoriza su montaje, importación productiva, activación ni conexión a la UI. Ningún componente, Card, Button, resumen, Modal, Drawer o texto visible nuevo puede conectarse sin aprobación explícita del dueño de producto.

Todo cambio visible debe cumplir la política canónica de [`docs/visual-governance.md`](../visual-governance.md), incluyendo:

- declaración exacta del cambio visible;
- captura o wireframe previo y aprobación previa explícita;
- capturas Before/After;
- Preview revisable;
- QA mobile con iPhone 15 Pro Max como referencia;
- aprobación final explícita del dueño de producto.

El incidente del resumen duplicado se registra únicamente en la [política de gobernanza visual](../visual-governance.md#incidente-de-referencia-resumen-duplicado); este documento adopta sus aprendizajes sin duplicar el relato ni incorporar datos personales.

`ShareWorkoutCard` y los módulos `workout-share` deben permanecer desconectados de la UI. Una tarea de infraestructura, composición, controller, ownership o limpieza no autoriza montarlos, importarlos desde una pantalla productiva ni eliminarlos incidentalmente. Cualquier cambio de ese estado requiere una tarea separada y aprobación explícita del dueño de producto.

## Enforcement y evolución

Esta fase establece política, checklist y revisión humana. No implementa enforcement automático y no debe sustituirse por límites rígidos de número de líneas, snapshots completos del archivo ni hashes frágiles.

Sin adelantar la ejecución de P3-41–P3-45 ni renumerar o modificar sus IDs, se propone que P3-45 añada contratos automatizados de boundaries/imports que validen al menos:

- que el root no importe repositories, storage adapters ni implementación interna de features;
- que las features no dependan de detalles internos de otras features;
- que `ShareWorkoutCard` y `workout-share` no adquieran importadores productivos ni conexiones visibles;
- que los límites admitan excepciones explícitas, pequeñas y revisables cuando exista una dependencia transversal legítima.

La automatización futura complementará esta política; no reemplazará la revisión de ownership, seguridad ni gobernanza visual.

## Checklist de revisión

- [ ] El root contiene sólo composición, providers/boundaries globales, controllers ya definidos, sesión o navegación transversal.
- [ ] La responsabilidad que entra y la que sale están declaradas, incluso cuando sean `Ninguna`.
- [ ] Toda lógica agregada está justificada como wiring mínimo.
- [ ] El estado de una sola feature permanece feature-local y no se creó un store universal.
- [ ] Los módulos nuevos son pequeños, tienen owner claro y no introducen dependencias cruzadas entre features.
- [ ] Selectors, modelos derivados, parsing de storage, formularios, repositories y queries permanecen fuera del root.
- [ ] Los writes usan allowlists explícitas y no aceptan ownership controlado por el cliente.
- [ ] Los fallbacks legacy y guards de lifecycle/freshness/operation owner se preservan.
- [ ] No se conectó UI por efecto lateral de infraestructura o refactor.
- [ ] Si existe cambio visible, están completos Before/After, Preview, QA mobile y aprobaciones de producto.
- [ ] `ShareWorkoutCard` y `workout-share` permanecen desconectados.
- [ ] El diff no introduce límites de líneas ni hashes frágiles como enforcement.
- [ ] No se adelantaron ni renumeraron P3-41–P3-45.

Si una casilla aplicable no puede confirmarse, el cambio queda bloqueado hasta reducir el alcance, aportar evidencia o registrar una decisión arquitectónica y, cuando corresponda, de producto.
