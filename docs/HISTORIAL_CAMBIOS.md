# Historial detallado de cambios - Organizatech

Fecha de generacion: 2026-05-17

Este documento resume las peticiones realizadas durante el desarrollo de Organizatech y los cambios implementados por version funcional.

## 2026-05-13 - Base de aplicacion

- Se definio construir Organizatech con TypeScript, Next.js, Supabase y PostgreSQL.
- Se planteo una PWA mobile-first para reducir riesgo tecnico y facilitar dashboards.
- Se traslado la logica del Excel v2.1 hacia calculos reutilizables en TypeScript.
- Se preparo persistencia local para modo demo.
- Se agregaron pruebas de calculos de progreso.

## 2026-05-13 - Navegacion mobile-first

- Se elimino la barra inferior.
- Se incorporo menu hamburguesa.
- Se agrego cierre con X.
- Se hizo el menu visible aunque el usuario estuviera abajo haciendo scroll.
- Se hizo el menu lateral scrollable.
- Se dejo el fondo externo del drawer transparente.
- Se agrego boton rojo de cierre de sesion.

## 2026-05-13 - Dashboard principal

- Se elimino el mensaje tecnico de datos locales.
- Se renombro el grafico principal como Vista progreso semanal.
- Se ajustaron tarjetas de volumen, reps y ejercicios.
- Se agregaron flechas y colores para valores positivos, negativos o neutros.
- Se corrigio la logica de calendario para que el panel principal muestre la rutina del dia actual.
- Se movio Analitica al panel principal.
- Se movio Analisis inteligente al panel principal como bloque prioritario.
- Se eliminaron Graficos y Resumen como secciones independientes.
- Se agrego carrusel semanal en el panel principal para navegar Lunes a Domingo.
- Se corrigio la fecha mostrada al cambiar de dia en el carrusel semanal.
- Se creo la seccion Registro de entrenamiento para centralizar creacion y edicion de rutinas.
- Se retiro Editar rutina semanal del panel principal.
- Se ajusto el entorno local para limpiar service workers y evitar fallas de chunks antiguos en localhost.

## 2026-05-14 - Rutinas por dia

- Se permitio crear rutinas separadas por dia.
- Se corrigio que Martes sobrescribiera Lunes.
- Se agrego edicion de rutina semanal.
- Se permitio agregar nuevos dias despues de crear la primera rutina.
- Se permitio registrar ejercicios con 0 kg para peso corporal.
- Se agrego selector rapido para navegar entre rutinas ya registradas.

## 2026-05-14 - Registro guiado de entrenamiento

- Se creo vista de entrenamiento del dia.
- Se listan ejercicios a realizar con series, reps y kg objetivo.
- Se registra ejercicio por ejercicio.
- Se elimino el combobox de ejercicio en el registro de series.
- El ejercicio activo se selecciona tocando la tarjeta en Ejercicios a realizar.
- Los campos de peso, RIR y series parten vacios para registrar lo realizado.
- Se agrego ayuda contextual para RIR.
- Se hizo dinamico el numero de casillas de series segun las series objetivo.

## 2026-05-15 - Comparacion semanal

- Se renombro Comparacion a Comparacion semanal.
- Se reorganizo la experiencia:
  1. seleccionar rutina o dia;
  2. ver comparacion semanal;
  3. ver ejercicios comparados;
  4. comparar ejercicio por semana.
- La comparacion se restringio por dia:
  - Lunes con Lunes;
  - Martes con Martes;
  - Miercoles con Miercoles.
- Se agregaron chips escalables para semana 1, semana 2 y futuras semanas.
- Se agrego comparacion de rutina registrada contra semanas reales.
- Se corrigieron duplicados al cargar datos de prueba.
- Se integro informacion util de Historial dentro de Comparacion semanal.
- Se elimino Historial como seccion independiente.

## 2026-05-16 - Ciclos de entrenamiento

- Se agrego seccion Ciclos de Entrenamiento.
- Se incorporaron Macrociclo, Mesociclo, Microciclo y Sesion de entrenamiento.
- Se reemplazaron tarjetas informativas por flujo guiado con combobox.
- Se agrego descripcion breve del ciclo seleccionado.
- Se agrego descripcion breve del objetivo seleccionado.
- Se permitio configurar:
  - objetivo del macrociclo;
  - duracion del macrociclo;
  - objetivo del mesociclo;
  - duracion del mesociclo;
  - dias de entrenamiento;
  - foco semanal;
  - foco de sesion.

## 2026-05-17 - Flujo completo de registro de rutina

- Se elimino el selector superior duplicado de dias.
- Los dias seleccionados en planificacion definen los dias que se deben completar.
- Se agrego progreso de dias completados.
- Se dejo un solo boton principal:
  - Guardar y continuar;
  - Finalizar registro de rutina.
- Se corrigio el bug donde guardar Lunes enviaba directamente al entrenamiento aunque faltaran otros dias.
- Si faltan dias, la app permanece en creacion de rutina y avanza al siguiente dia pendiente.
- Solo al completar todos los dias seleccionados se pasa al check-in previo al entrenamiento.
- Se elimino la opcion de copiar rutina desde otro dia para simplificar.

## 2026-05-17 - Check-in previo al entrenamiento

- Se agrego pantalla previa antes del entrenamiento.
- Preguntas:
  - motivacion de 1 a 7;
  - hidratacion de 1 a 7;
  - sueño de 1 a 7;
  - energia fisica de 1 a 7.
- Se agrego opcion Omitir por hoy.
- Si el usuario omite, se registra internamente como usuario no quiso registrar.

## 2026-05-17 - Correcciones de metricas

- Se cambio KG totales de la rutina para que sume el peso objetivo una vez por ejercicio.
- Ejemplo:
  - sentadilla 100 kg;
  - cuadriceps 100 kg;
  - KG totales de la rutina: 200 kg.
- Se mantiene volumen real para calculos internos y comparaciones.
- Se aplico la misma logica de KG totales de la rutina en dashboard, entrenamiento guiado y comparacion semanal cuando la metrica corresponde a carga objetivo de rutina.
- Se dejo el volumen de trabajo etiquetado aparte como peso por repeticiones realizadas.
- Se actualizo el texto visible de metricas y graficos para separar "KG totales de la rutina" de "Volumen de trabajo".
- Se separo el peso actual de las diferencias:
  - kg actual;
  - diferencia de reps;
  - diferencia de kg.
- Se evito mostrar progreso falso cuando el usuario iguala el peso objetivo.

## Verificaciones realizadas

Durante el desarrollo se ejecuto regularmente:

```bash
npm run typecheck
npm run test
npm run build
```

## Pendientes sugeridos

- Persistir check-in en tablas dedicadas de Supabase.
- Agregar pruebas end-to-end del flujo completo de rutina.
- Definir autenticacion real con Supabase Auth.
- Agregar borrado seguro o archivo de rutinas.
- Agregar exportacion de progreso por ciclo.
