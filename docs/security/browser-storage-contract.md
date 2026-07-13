# Contrato de almacenamiento en navegador

Organizatech usa almacenamiento del navegador solo para autenticación administrada por Supabase, modo demo, recuperación temporal de flujos y preferencias operativas acotadas. Las claves propias nunca usan correo, teléfono, nombre u otros datos personales como identificador.

## Scopes

- `supabase:<uuid>`: una cuenta autenticada. El UUID proviene exclusivamente de Supabase Auth.
- `demo`: repositorio local sin backend.

Una cuenta Supabase no lee claves globales legacy ni usa el repositorio demo como fallback. Las claves legacy sin propietario demostrable solo pueden migrarse una vez a `demo`; después se eliminan.

## Inventario

| Clave/prefijo | Storage | Scope | Contenido | TTL | Motivo | Limpieza |
| --- | --- | --- | --- | --- | --- | --- |
| `sb-<project-ref>-auth-token` | localStorage administrado por Supabase | Proyecto Supabase | Sesión Auth estándar | Administrado por Supabase | Mantener sesión autenticada | `supabase.auth.signOut()` |
| `organizatech:exercises:demo` | localStorage | demo | Ejercicios locales completos | Sin TTL | Demo no tiene backend | Logout demo o reemplazo del repositorio local |
| `organizatech:entries:demo` | localStorage | demo | Pesos, reps, RIR y notas locales | Sin TTL | Demo no tiene backend | Logout demo o reemplazo del repositorio local |
| `organizatech:training-sessions:demo` | localStorage | demo | Sesiones locales completas | Sin TTL | Demo no tiene backend | Logout demo o reemplazo del repositorio local |
| `organizatech:training-plan:<scope>` | localStorage | demo o Supabase UUID | Plan de entrenamiento | Sin TTL durante la sesión de cuenta | Recuperar configuración de UI | Logout del scope |
| `organizatech:cycle-history:<scope>` | localStorage | demo o Supabase UUID | Historial local de ciclos | Sin TTL durante la sesión de cuenta | Historial demo y snapshot de UI | Logout del scope |
| `organizatech:active-flow:<scope>` | localStorage | demo o Supabase UUID | Pantalla y flujo activo | 24 h | Recuperar navegación interrumpida | Expiración, logout o cambio de ciclo |
| `organizatech:routine-draft:<scope>` | localStorage | demo o Supabase UUID | Rutina en edición | 48 h | Recuperar edición interrumpida | Guardado, cancelación, expiración o logout |
| `organizatech:workout-draft:<scope>` | localStorage | demo o Supabase UUID | Readiness, pesos, reps e IDs del intento activo | 24 h | Recuperar entrenamiento y reintentar el enlace readiness | Finalización completa, expiración, cancelación o logout |
| `organizatech:seen-notifications-v2:<scope>` | localStorage | demo o Supabase UUID | Máximo 60 pares `id`/`seenAt` | Sin TTL | Mantener estado visto | Logout del scope |
| `organizatech:password-recovery-flow` | sessionStorage | No aplica | Envelope `version`, `startedAt`, `expiresAt` | 60 min | Mantener recovery en la pestaña actual | Expiración, cancelación, finalización, sesión inválida o logout |
| `organizatech-v1` | Cache API | Global | Shell público: página, manifest e icono | Versión del service worker | Soporte básico offline | Actualización o limpieza del service worker |

## Reglas de seguridad

- Supabase Auth conserva su adaptador y claves estándar. La aplicación no duplica manualmente access tokens ni refresh tokens.
- El modo demo puede persistir entrenamiento completo porque no dispone de backend. Los usuarios autenticados cargan entrenamiento desde Supabase y no leen esas claves.
- El workout draft es temporal. Si existe `pendingReadinessLink` tras un fallo real, se conserva para reintentar sin duplicar la sesión; al confirmar el enlace se elimina.
- Las notificaciones guardan solo identificador y fecha de lectura, nunca título, resumen o contenido completo.
- No se guardan teléfono, apellido, fecha de nacimiento, género, avatar URL, perfil completo ni resultados completos del Coach.
- El logout elimina una allowlist exacta del scope actual y el recovery state. Nunca usa `localStorage.clear()` ni `sessionStorage.clear()` y no elimina claves de otras cuentas o proyectos.
