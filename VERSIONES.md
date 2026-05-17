# Organizatech - Documento de versiones y modificaciones

Fecha de documento: 2026-05-16

## Version actual

Organizatech es una PWA mobile-first construida con Next.js, TypeScript, Supabase y PostgreSQL, pensada para registrar rutinas por dia, guardar entrenamientos por semana y comparar progreso de forma simple.

## Base inicial del proyecto

- Se construyo la aplicacion en TypeScript con Next.js.
- Se organizo la arquitectura para funcionar como PWA mobile-first.
- Se preparo la integracion con Supabase y PostgreSQL.
- Se creo persistencia local como modo demo cuando Supabase no esta configurado.
- Se traslado la logica del Excel v2.1 a calculos reutilizables en TypeScript.
- Se agregaron pruebas para validar calculos de progreso, volumen, repeticiones y estado de objetivos.

## Autenticacion y estructura visual

- Se creo pantalla de login.
- Se creo pantalla de registro.
- Se agrego estado de sesion demo local.
- Se agrego boton rojo de cierre de sesion.
- Se adapto el diseño a una estetica oscura, mobile-first y consistente con los mockups.
- Se elimino la barra inferior de navegacion.
- Se reemplazo la navegacion por menu hamburguesa.
- Se agrego una X animada para cerrar el menu.
- Se hizo que el menu sea visible aunque el usuario este abajo en la pagina.
- Se hizo scrollable el menu lateral.
- Se dejo el lado externo del menu transparente para ver la app detras.
- Se ajusto el topbar para ocultarse al bajar y reaparecer al hacer scroll hacia arriba.

## Menu principal

- Se movieron las secciones al menu lateral.
- Se agregaron secciones principales iniciales: Panel principal, Entrenamiento, Comparacion semanal, Analitica, Perfil, Graficos, Resumen y Analisis inteligente.
- Se eliminaron Graficos y Resumen como secciones independientes porque no seran utilizadas.
- Se elimino Analisis inteligente como seccion independiente del menu.
- El menu lateral queda enfocado en Panel principal, Entrenamiento y Comparacion semanal.
- Se elimino Historial como seccion independiente del menu.
- Se rescato la informacion util de Historial y se integro dentro de Comparacion semanal.

## Creacion y edicion de rutinas

- Se creo flujo inicial para registrar rutina si no existen entrenamientos.
- Se incorporo la seccion Ciclos de Entrenamiento al crear o editar rutinas.
- Se agregaron conceptos de Macrociclo, Mesociclo, Microciclo y Sesion de entrenamiento.
- Se reemplazaron las tarjetas informativas por un flujo guiado con combobox:
  - Seleccion del ciclo de entrenamiento.
  - Descripcion breve del ciclo seleccionado.
  - Objetivo principal.
  - Descripcion breve del objetivo seleccionado.
  - Duracion.
  - Dias de entrenamiento.
- Se elimino el selector superior duplicado de dia de entrenamiento.
- Los dias del bloque de planificacion ahora agregan el dia al plan y seleccionan el dia que se esta configurando.
- Se agrego configuracion editable de ciclos:
  - Macrociclo: objetivo principal y duracion de 6 a 11 meses.
  - Mesociclo: objetivo, duracion de 3 a 6 semanas y dias de entrenamiento.
  - Microciclo: enfoque semanal.
  - Sesion: foco del entrenamiento del dia.
- Se permite seleccionar dia de entrenamiento: Lunes a Domingo.
- Cada dia mantiene su propia rutina y ejercicios sin sobrescribir otros dias.
- Se corrigio el problema donde al cargar Martes se sobrescribia Lunes.
- Se agrego edicion de rutina semanal.
- Se permite agregar o modificar dias despues de crear la primera rutina.
- Los dias con rutina quedan marcados visualmente.
- Los dias sin rutina quedan deshabilitados/prohibidos en comparaciones.
- Se permite guardar rutinas con peso 0 kg para ejercicios de peso corporal.
- Al guardar un dia, la app vuelve automaticamente a la rutina de ese dia y muestra confirmacion visible.
- Se cambio el mensaje inferior poco visible por un aviso superior claro.

## Entrenamiento guiado

- Se construyo pantalla de entrenamiento del dia.
- Se muestra el nombre de la rutina y el dia correspondiente.
- Se muestran metricas objetivo del entrenamiento: volumen total, total reps y ejercicios.
- Se agrego selector rapido de dias/rutinas con flechas y botones.
- Se puede pasar de Lunes a Martes y viceversa sin volver al editor.
- Se reemplazo la seccion de ejercicios a realizar por tarjetas mas claras.
- Cada ejercicio muestra orden, nombre, series, reps, kg objetivo y estado.
- Se agrego registro de series ejercicio por ejercicio.
- El boton Registrar serie registra el ejercicio actual completo.
- Al completar todos los ejercicios se habilita Guardar entrenamiento.
- Se guardan registros por semana para permitir comparacion futura.

## Panel principal

- Se renombro el grafico principal como Vista progreso semanal.
- Se eliminaron mensajes tecnicos como "Datos guardados en este dispositivo" de la vista principal.
- Se ajustaron tarjetas de volumen, reps y ejercicios para verse mas compactas.
- Se agregaron indicadores positivos y negativos con color y flechas.
- Se corrigio la logica de calendario del panel principal:
  - Si es Lunes, muestra rutina de Lunes.
  - Si es Miercoles, muestra rutina de Miercoles.
  - El panel ya no arrastra la ultima rutina visitada por el usuario.
- Se corrigio el caso donde el panel mostraba "jalon" aunque correspondia otro dia.
- Se integro Analisis inteligente directamente en el panel principal.
- El bloque de Analisis inteligente aparece entre los primeros bloques del dashboard para darle prioridad visual.

## Logica de progreso

- Se calcula volumen como repeticiones totales por peso.
- Se calcula diferencia de reps contra objetivo o semana anterior segun corresponda.
- Se calcula diferencia de kg.
- Se clasifica cada ejercicio en:
  - Cumplimos.
  - Mantenemos esfuerzo.
  - No cumplimos.
- Se corrigio el error donde "Ejercicios +1" representaba objetivos cumplidos en vez de ejercicios nuevos.
- Se corrigio la comparacion de semana 1 para comparar contra objetivo de rutina y no contra cero.
- Se agregaron indicadores por valor:
  - kg positivo en verde.
  - reps negativas en rojo.
  - valores iguales en amarillo.
- Se agregaron badges secundarios:
  - Subimos kg.
  - Bajamos kg.
  - Subimos reps.
  - Bajamos reps.
  - Mismo kg.
  - Mismas reps.

## Comparacion semanal

- La seccion Comparacion se renombro a Comparacion semanal.
- Se reordeno la experiencia:
  1. Seleccionar rutina o dia.
  2. Ver cabecera de comparacion semanal.
  3. Ver ejercicios comparados.
  4. Comparar ejercicio por semana.
- La comparacion siempre se realiza por dia/rutina:
  - Lunes compara Lunes contra Lunes.
  - Martes compara Martes contra Martes.
  - Miercoles compara Miercoles contra Miercoles.
- Se agregaron chips escalables por semana:
  - Semana 1.
  - Semana 2.
  - Semana 3, 4, 5 y las que existan.
- El chip Rutina registrada muestra los datos objetivo actuales de la rutina.
- Los chips de semana muestran datos registrados para esa semana.
- Se agrego deduplicacion por semana + ejercicio para evitar duplicados si se cargan datos de prueba mas de una vez.
- Se agrego boton para cargar datos de prueba de semana 1 y semana 2.
- Se agrego selector de ejercicio personalizado, reemplazando el combo nativo del navegador.
- Se agrego bloque Comparar ejercicio por semana:
  - descripcion simple para el usuario.
  - selector de ejercicio.
  - observacion clara del progreso.
  - grafico de evolucion semanal del volumen.
- Se elimino el uso de badges en el detalle individual del ejercicio para reducir ruido visual.

## Graficos, resumen y analitica

- Se agregaron graficos con Recharts.
- Se creo vista de evolucion de repeticiones.
- Se creo vista de reps por ejercicio.
- Se agrego analitica de progreso.
- Se agrego resumen semanal.
- Se agrego analisis inteligente automatico con insights de carga, volumen, consistencia y fatiga.
- Posteriormente se eliminaron Graficos y Resumen como pantallas independientes.
- La analitica se integro al panel principal.
- El analisis inteligente se movio al panel principal como bloque prioritario.

## Supabase y PostgreSQL

- Se agrego esquema SQL base para perfiles, rutinas, ejercicios, sesiones y entradas de ejercicio.
- Se agrego columna `day` a ejercicios.
- Se agrego migracion `supabase/migrations/20260513_add_exercise_day.sql`.
- Se dejo compatibilidad cuando la columna `day` aun no existe, usando notas como respaldo temporal.
- Se mantiene modo local si Supabase no esta conectado.

## Verificacion

Se validaron los cambios principales con:

- `npm run test`
- `npm run typecheck`
- `npm run build`

## Pendientes sugeridos

- Aplicar migracion en Supabase si la base real aun no tiene `day`.
- Definir autenticacion real completa con Supabase Auth.
- Agregar borrado/archivo seguro de ejercicios sin perder historial.
- Crear flujo para limpiar datos demo.
- Agregar tests de interfaz para los flujos principales.
