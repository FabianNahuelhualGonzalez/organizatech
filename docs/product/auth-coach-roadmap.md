# Roadmap AUTH-COACH y superficies relacionadas

- Estado de este documento: activo
- Fecha de actualización: 2026-08-16
- Contrato normativo: [`auth-coach-product-contract.md`](./auth-coach-product-contract.md)

Este roadmap registra progreso y dependencias. No altera las decisiones del
contrato de producto y no autoriza implementar una etapa futura.

## Estado general

| Etapa | Estado | Resultado o condición pendiente |
|---|---|---|
| Nuevo Login y Registro AUTH-01 | QA del dueño aprobada; no producción | Mantener Draft PR y no promover hasta el cierre coordinado |
| Accesos desde la página web | Flujo incluido en el alcance aprobado | Verificación final antes de producción |
| Nuevo diseño Entrenemos TRAIN-UI-01 | QA del dueño aprobada; no producción | Mantener integración sin promoción productiva |
| Login y registro con Google | Pendiente | Tarea independiente con OAuth, seguridad y QA propios |
| Registro de membresía Coach | Implementado; migración Coach verificada en QA | Reauditoría Claude y cierre coordinado pendientes |
| Autorización multipportal | Corrección Usuario implementada localmente | Reauditoría independiente, segunda migración en QA y pruebas materiales con dos identidades |
| PostgreSQL/RLS AUTH-COACH-01 | Coach QA PASS; Usuario pendiente de QA | Aplicar manualmente la migración `user_registrations` en QA y verificar catálogo, ACL y anti-BOLA |
| Código de vinculación Coach-alumno | Especificado; no implementado | Diseños del dueño y tarea/backend propios |
| Un Coach activo por alumno | Especificado; no implementado | Restricción concurrente en PostgreSQL y pruebas materiales |
| Autosupervisión | Especificada; no implementada | Debe consumir el único cupo activo |
| Desvinculación automática a 48 horas | Especificada; no implementada | Tabla de relaciones, transición atómica, Cron, notificaciones y QA |
| Portal Coach | Shell provisional implementado localmente | Requiere auditoría read-only y QA visual manual; funciones futuras siguen bloqueadas |
| Chat Coach-alumno | Especificado parcialmente | Falta diseño y semántica de eliminación |
| Documentos compartidos | Especificado parcialmente | Falta política excepcional de retiro, Storage y QA de permisos |
| Producción | Bloqueada | Requiere cierre técnico, auditoría, Preview, QA manual y autorización expresa |

## Fase actual — AUTH-COACH-01

### Objetivo

Crear y autorizar membresías Usuario y Coach independientes para la misma
identidad Auth y separar sus destinos mediante un portal Coach provisional, sin
implementar todavía la relación con alumnos ni funciones futuras.

### Incluye

- formulario de registro Coach con `professional_title`;
- payload cerrado y ownership derivado por backend;
- registro Coach autoritativo;
- tabla y registro Usuario autoritativos, separados del perfil común;
- backfill acotado para las cuentas Usuario legacy existentes;
- acceso Usuario/Coach resuelto desde su membresía backend correspondiente;
- destino Coach independiente con inicio, menú cerrado y perfil propio de solo lectura;
- transporte tipado de la fila Coach autoritativa sin una segunda consulta;
- logout local con invalidación de resoluciones y estado Coach;
- plantillas y semántica futura de correo documentadas para `AUTH-COACH-02`, sin envío;
- rechazo de Coach-only al portal Usuario con el mensaje aprobado;
- rechazo de Usuario sin membresía Coach;
- aislamiento ante cambios de sesión A → B;
- migraciones y contratos de RLS/ACL separados para `coach_registrations` y
  `user_registrations`;
- contrato de producto y roadmap versionados.

### No incluye

- vínculo Coach-alumno;
- códigos de invitación;
- desvinculación o Cron;
- funciones Coach posteriores al shell provisional;
- implementación o envío de correos Coach;
- chat, PDF o documentos compartidos;
- Google;
- ejecución SQL remota.

### Gates requeridos antes de commit

1. `npm run lint`
2. `npm run typecheck -- --incremental false`
3. `npm test`
4. `npm run build`
5. `git diff --check`
6. Reauditoría Claude read-only con PASS
7. Inventario exacto y staging vacío antes de que el dueño prepare el commit

### Gates requeridos antes de cierre

1. Commit y push ejecutados por el dueño
2. Draft PR y Preview
3. Segunda migración aplicada exclusivamente en PostgreSQL/Supabase QA autorizado
4. Verificación material de catálogo, RLS, ACL, RPC, tres estados de membresía,
   dos identidades y anti-BOLA
5. QA manual del dueño
6. Sin promoción a producción hasta autorización expresa

## Próximas fases propuestas

### AUTH-GOOGLE-01 — OAuth Google

Implementar creación e inicio de sesión mediante Google sin debilitar la separación
de membresías ni conceder Coach desde metadata OAuth.

### AUTH-COACH-02 — Correos de membresía Coach

Implementar las dos plantillas aprobadas desde un evento backend idempotente,
con entrega exactamente una vez, reintentos sin duplicación y sin revertir la
membresía ante fallas de entrega. Debe conservarse la confirmación normal de
Supabase Auth para identidades nuevas.

### COACH-LINK-01 — Vinculación Coach-alumno

Implementar relaciones históricas, un solo Coach activo, autosupervisión, códigos
de un uso y activación atómica.

### COACH-UNLINK-01 — Desvinculación y plazo

Implementar desvinculación inmediata del Coach, solicitud del alumno, plazo de
48 horas, cancelación, bloqueo, auditoría y automatización programada.

### COACH-PORTAL-01 — Alumnos y perfil editable

Implementar edición autorizada del perfil Coach y búsqueda restringida a alumnos
autorizados, siguiendo diseños permanentes aprobados por el dueño.

### COACH-TRAINING-01 — Supervisión del entrenamiento

Implementar dashboard, comparación, ciclo actual, historial, PDF y modificaciones
con auditoría y control de concurrencia.

### COACH-COMMS-01 — Chat y documentos

Implementar conversaciones por relación y documentos privados compartidos por
archivo, con suspensión y restauración de permisos según el estado de vinculación.

## Decisiones aún necesarias

- vencimiento del código de vinculación;
- copy y plantillas de notificación;
- semántica de eliminación del chat;
- retiro excepcional de documentos;
- permisos y operación de soporte;
- enlaces permanentes a los frames Figma;
- definición visual y QA de cada pantalla Coach.

Ninguna decisión pendiente se implementará por inferencia.
