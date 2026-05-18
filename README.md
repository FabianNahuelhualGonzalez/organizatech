# Organizatech

Organizatech es una PWA mobile-first para planificar rutinas de entrenamiento, registrar series reales y comparar progreso semana a semana. El proyecto esta construido con Next.js, TypeScript, Supabase y PostgreSQL, con modo local para pruebas cuando Supabase no esta configurado.

## Objetivo

Organizatech ayuda al usuario a:

- crear rutinas por dia;
- definir ciclos de entrenamiento;
- registrar peso, series, repeticiones y RIR;
- comparar rutina objetivo contra semanas registradas;
- visualizar progreso por dia, semana y ejercicio;
- recibir analisis inteligente dentro del panel principal.

## Stack

- Next.js
- TypeScript
- React
- Supabase
- PostgreSQL
- Recharts
- Lucide React

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```

## Flujo principal

1. El usuario crea una rutina inicial.
2. Selecciona ciclo, objetivo, duracion y dias de entrenamiento.
3. Configura la rutina de cada dia seleccionado.
4. Al finalizar el registro de rutina, pasa al check-in previo al entrenamiento.
5. Registra sus series reales por ejercicio.
6. La app compara progreso contra la rutina base o semanas anteriores.

## Documentacion

- [Documento de versiones](./VERSIONES.md)
- [Historial detallado de cambios](./docs/HISTORIAL_CAMBIOS.md)

## Supabase

El esquema base se encuentra en:

- `supabase/schema.sql`
- `supabase/migrations/20260513_add_exercise_day.sql`

Si Supabase no esta configurado, la aplicacion usa persistencia local en el navegador.

## Verificacion

El proyecto se valida con:

```bash
npm run typecheck
npm run test
npm run build
```
