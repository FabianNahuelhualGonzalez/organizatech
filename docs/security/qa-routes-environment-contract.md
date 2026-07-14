# Contrato de rutas QA y entornos

## Alcance

La ruta `/qa/training-cycles` es una herramienta interna. Su disponibilidad
depende de un gate ejecutado exclusivamente en servidor y en cada request. El
gate no reemplaza RLS, la sesión del cliente ni Vercel Deployment Protection.

Los diagramas internos y la antigua utilidad de limpieza de caché se conservan
como documentación en:

- `docs/internal/diagramas/`
- `docs/internal/limpiar-cache.html`

No deben volver a copiarse bajo `public/`.

## Variables

```dotenv
ENABLE_QA_TOOLS=false
QA_EXPECTED_SUPABASE_PROJECT_REF=
APP_PRODUCTION_HOSTS=
```

- `ENABLE_QA_TOOLS` debe ser exactamente `true` para habilitar la evaluación.
- `QA_EXPECTED_SUPABASE_PROJECT_REF` contiene el project ref QA esperado.
- `APP_PRODUCTION_HOSTS` contiene hosts productivos separados por comas, sin
  protocolo ni rutas. Debe incluir dominio principal, `www` y cualquier URL
  productiva de Vercel aplicable.
- `VERCEL_PROJECT_PRODUCTION_URL`, cuando existe, se incorpora automáticamente
  a la lista productiva.
- `NEXT_PUBLIC_SUPABASE_URL` sigue siendo pública por contrato del cliente, pero
  el gate solo acepta una URL HTTPS canónica de Supabase cuyo project ref
  coincida exactamente con el valor QA server-only.

`NEXT_PUBLIC_ENABLE_QA_TOOLS` y `NEXT_PUBLIC_SUPABASE_ENV` no autorizan rutas
QA y deben eliminarse de la configuración de Vercel cuando todavía existan.

## Matriz de entornos

| Entorno | Condiciones | Resultado |
| --- | --- | --- |
| Production | Cualquier configuración | `404` siempre |
| Host productivo | Cualquier `VERCEL_ENV` o flag | `404` siempre |
| Preview QA | `VERCEL_ENV=preview`, flag exacto, host no productivo y Supabase QA verificado | Permitido |
| Preview incompleto | Falta o mismatch de cualquier condición | `404` |
| Development | `NODE_ENV=development`, activación explícita, host no productivo y Supabase QA verificado | Permitido |
| Entorno desconocido | Cualquier combinación | `404` |

Valores ausentes, ambiguos o inválidos fallan cerrados. El rechazo usa el 404
estándar de Next y no expone variables, hostname ni motivos internos.

## Contrato de hostname

El servidor toma el primer valor de `x-forwarded-host` y usa `host` como
fallback. Normaliza lowercase, espacios, puerto y punto DNS final. La
comparación contra hosts productivos es exacta; no usa substring ni sufijos.
Si el host no puede validarse o no existe al menos un host productivo válido,
el gate rechaza el acceso.

## Contrato de Supabase QA

Solo se acepta `https://<project-ref>.supabase.co/`, sin credenciales, puerto,
path adicional, querystring ni fragment. El project ref extraído debe coincidir
exactamente con `QA_EXPECTED_SUPABASE_PROJECT_REF`. No se serializan al cliente
la URL, el ref esperado ni los valores del gate.

## Sesión y acciones

El cliente valida al usuario con Supabase antes de cargar datos o mostrar
controles mutables. `SIGNED_OUT` elimina el estado visible y la allowlist local.
Completar o cancelar exige confirmación y solo se ofrece para ciclos creados en
la sesión de navegador actual de la herramienta. Esta allowlist evita cambios
accidentales, pero no es autorización: RLS y ownership siguen siendo el
enforcement real.

## Configuración manual en Vercel

### Production

- `ENABLE_QA_TOOLS` ausente o `false`.
- `QA_EXPECTED_SUPABASE_PROJECT_REF` puede estar ausente.
- `APP_PRODUCTION_HOSTS` contiene todos los dominios productivos conocidos.
- Verificar por URL directa que `/qa/training-cycles` responde `404`.

### Preview QA

- `ENABLE_QA_TOOLS=true`.
- Definir el project ref QA esperado sin reutilizar valores de Production.
- Configurar todos los hosts productivos en `APP_PRODUCTION_HOSTS`.
- Confirmar que URL y anon key públicas corresponden a Supabase QA.
- Mantener Vercel Deployment Protection activa.

### Development

- Herramientas QA deshabilitadas por defecto.
- Activarlas manualmente solo para pruebas explícitas.
- Usar Supabase QA, nunca Production.

Un deployment Preview con herramientas QA activas no debe promoverse como
sustituto de un build productivo desde `main`.

## Smoke requerido

1. Production y dominio productivo: URL directa responde `404` aun con flag
   accidentalmente activo.
2. Preview sin flag, host o project ref válido: responde `404`.
3. Preview QA válido: carga la herramienta, pero no muestra acciones hasta
   validar sesión.
4. Usuario sin sesión: no ve datos ni controles mutables.
5. Usuario autenticado: puede crear un ciclo QA; solo ese ciclo ofrece completar
   o cancelar durante la visita actual.
6. Tras `SIGNED_OUT`: datos y controles desaparecen.
7. `/diagramas/index.html` y `/limpiar-cache.html` responden `404`.

## Riesgo residual

La autenticación de la herramienta sigue validándose en el cliente y no se
migra a cookies SSR en esta fase. Por eso el gate server-only y Deployment
Protection controlan la exposición de la ruta, mientras RLS protege los datos.
