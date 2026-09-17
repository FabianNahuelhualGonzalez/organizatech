# Invitaciones: intención ligada a la generación observada

## Estado

EN VALIDACIÓN. No listo para commit/QA; auditoría independiente pendiente.
Evidencia local: `/tmp/organizatech-coach-generation-contract.TTFczc/`.
Sin navegador, credenciales, correo, Supabase remoto ni producción.

## Alcance técnico

Tres RPC nuevas y métodos de repositorio separados permiten reenviar/regenerar
con `invitationId`, `expectedGeneration` y `requestId` exactos. El servidor comprueba
la generación dentro de la misma transacción que la reserva. El cliente no intenta
simular esa condición mediante una lectura seguida de un write incondicional.
Las ocho operaciones anteriores y sus migraciones permanecen intactas.

Receipt exacto: `requestId`, `action`, `state`, `invitationId`,
`expectedGeneration`, `generation`, `reservedAt`. Reenviar conserva G; regenerar
produce G+1. Reserva no significa correo aceptado/entregado ni consentimiento del
alumno. Se conserva un replay cancelado como cancelado, no como éxito de envío.
Lectura ausente devuelve null; recibos antiguos/incompatibles no se adoptan.

Sin estados UI/copy/campos visibles nuevos. No conecta las pantallas todavía.
El futuro controller debe fijar la intención, reconciliar requestId ante incertidumbre
y no reintentar automáticamente ni cambiar de generación en nombre del usuario.

## Validación y compatibilidad

Allowlist exacta antes de Auth y nuevamente en el adaptador RPC. Ownership/código/
payload/episodeId se rechazan. Generación es número entero PostgreSQL, no string,
en el intervalo 1..2147483647. Regenerar MAX llega al servidor y devuelve conflicto
por agotamiento; nunca se acepta un receipt que desborde el rango.

La captura existente conserva verificación de identidad, generación de sesión,
presupuesto único, AbortSignal y supresión de respuestas tardías. No usa estado Auth
mutable ni reintentos implícitos. Los errores del servidor se convierten a códigos
técnicos existentes, sin detalles privados. Los pagos mantienen argumentos string;
no se amplía su contrato por el nuevo argumento numérico de invitaciones.

## Gates y límites

Pruebas focales iniciales 62/62 PASS. Typecheck inicial PASS después de corregir
el tipo PromiseLike de tres aserciones de prueba. DATA4 integradas con hashes
exactos; SQL transaccional y 34 checks reales PG17.5 PASS desde ROOT. Invitaciones
367, pagos84 y dominio144 PASS. La primera suite general detectó registro faltante
de la nueva migración en el contrato Coach (4 fallos derivados); se añadió sólo
su constante/ruta a esa allowlist, sin quitar aserciones ni probes. Se repetirá
toda la batería secuencial antes de la auditoría. Inventario final17: nuevas10 y
shared7; 230 archivos previos no compartidos conservados, root/lock/5SQL intactos.
Pruebas locales sintéticas no equivalen a PostgREST/Auth real, correo, QA manual ni
migración QA. La nueva migración requiere inventario/versiones/autorización propios;
no modifica la autorización pendiente de las cinco migraciones anteriores.
