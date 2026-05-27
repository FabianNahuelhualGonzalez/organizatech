# Ambientes de Organizatech

## Objetivo

Organizatech separa sus ambientes para evitar que pruebas de QA, Preview o desarrollo local afecten datos productivos.

La regla principal es:

- Produccion usa Supabase Produccion.
- Preview, Development y Local usan Supabase QA.

Esta separacion permite probar cambios, migraciones futuras y flujos completos sin tocar usuarios ni datos reales de produccion.

## Tabla de ambientes

| Ambiente | URL / uso | Supabase |
|---|---|---|
| Production | `https://organizatech.cl` | Supabase Produccion |
| Preview | Deploys Preview de Vercel | Supabase QA |
| Development | Ambiente Development de Vercel | Supabase QA |
| Local | Desarrollo en maquina local | Supabase QA |

## Variables de entorno

La app usa solo variables publicas de Supabase en frontend:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Estas variables deben configurarse por ambiente en Vercel.

Production:

```env
NEXT_PUBLIC_SUPABASE_URL=URL_SUPABASE_PRODUCCION
NEXT_PUBLIC_SUPABASE_ANON_KEY=ANON_KEY_SUPABASE_PRODUCCION
```

Preview y Development:

```env
NEXT_PUBLIC_SUPABASE_URL=URL_SUPABASE_QA
NEXT_PUBLIC_SUPABASE_ANON_KEY=ANON_KEY_SUPABASE_QA
```

Local:

```env
NEXT_PUBLIC_SUPABASE_URL=URL_SUPABASE_QA
NEXT_PUBLIC_SUPABASE_ANON_KEY=ANON_KEY_SUPABASE_QA
```

El archivo `.env.local` no debe subirse al repositorio.

## Reglas

- No usar variables Supabase como `All Environments` en Vercel si pueden mezclar Production, Preview y Development.
- No usar `service_role` en frontend.
- No subir `.env.local`.
- No copiar datos reales de produccion a QA.
- No probar migraciones contra produccion.
- No usar datos personales reales en QA.
- No desactivar RLS para resolver errores.
- No compartir claves ni tokens en issues, commits, documentacion publica o herramientas externas.

## Redirect URLs

### Supabase QA

QA debe aceptar solo URLs de prueba y desarrollo:

```text
https://*.vercel.app/**
http://localhost:3000/**
http://localhost:3066/**
https://qa.organizatech.cl/**  # futuro, solo si se habilita
```

QA no debe usar URLs productivas como redirect principal.

### Supabase Produccion

Produccion debe aceptar URLs productivas:

```text
https://organizatech.cl/**
https://www.organizatech.cl/**
```

No agregar URLs de Preview a Supabase Produccion salvo una excepcion temporal, controlada y documentada.

## Checklist para validar Preview

1. Abrir el deploy Preview de Vercel.
2. Crear un usuario QA con correo controlado.
3. Confirmar el correo si el flujo lo requiere.
4. Iniciar sesion.
5. Crear una rutina.
6. Crear ejercicios.
7. Registrar un entrenamiento.
8. Revisar dashboard y comparacion semanal.
9. Confirmar en Supabase QA que se crearon:
   - perfil,
   - rutina,
   - ejercicios,
   - sesiones,
   - entradas de ejercicios.
10. Confirmar en Supabase Produccion que esos datos QA no existen.

## Checklist para validar Produccion

1. Abrir `https://organizatech.cl`.
2. Iniciar sesion con un usuario real o cuenta controlada de produccion.
3. Confirmar que los datos productivos siguen disponibles.
4. Confirmar que no aparecen usuarios ni datos QA.
5. Crear datos solo si corresponde a una prueba productiva controlada.
6. Confirmar que Auth, login, logout y recuperacion de contrasena siguen funcionando.

## Riesgos conocidos

- Configurar variables Supabase como `All Environments` en Vercel puede mezclar ambientes.
- Preview apuntando a Supabase Produccion puede contaminar datos reales.
- Local apuntando a Supabase Produccion puede provocar pruebas sobre datos reales.
- Copiar datos productivos a QA puede exponer informacion sensible.
- Redirect URLs incompletas pueden romper login, confirmacion de correo o recuperacion de contrasena.
- Usar correos falsos en QA puede generar rebotes de email.
- Ejecutar migraciones no probadas en Produccion puede afectar datos reales.

## Proximo paso

Con QA y Produccion separados, el siguiente paso tecnico es iniciar Fase 2 Training en una rama nueva:

```text
feature/training-sessions-fuente-verdad
```

Esa fase debe hacer que `training_sessions` represente una sesion diaria real de entrenamiento y sea la fuente de verdad para dashboard, carrusel, resumen y comparacion semanal.

