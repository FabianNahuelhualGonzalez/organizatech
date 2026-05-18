# Organizatech - Documento de versiones y modificaciones

Fecha de documento: 2026-05-17

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
- Se agrego boton Volver con flecha en secciones internas para mejorar la navegacion.

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
- Se agrego gestion de ciclo activo dentro de Registro de entrenamiento.
- Si ya existe un ciclo registrado, Registro de entrenamiento muestra resumen del ciclo actual y acceso a Crear nuevo ciclo de entrenamiento.
- Se compacto el resumen del ciclo activo en una sola tarjeta con duracion, dias, ejercicios, volumen, reps y semanas.
- Se simplifico el texto de Crear nuevo ciclo de entrenamiento para reducir ruido visual.
- Se amplio Historial ciclo de entrenamiento con fecha de inicio/finalizacion, ejercicios que subieron reps o peso, ejercicios estancados, resumen de animo y dos sugerencias.
- Se corrigieron textos con caracteres raros en descripciones del registro de entrenamiento.
- Al crear un nuevo ciclo se muestra un popup de confirmacion; si el usuario acepta, se finaliza el ciclo actual y se guarda en Historial ciclo de entrenamiento.
- Se agrego la seccion Historial ciclo de entrenamiento en el menu lateral para listar Ciclo 1, Ciclo 2, Ciclo 3, etc.
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
- Se agrego flujo guiado para configurar rutinas por dia:
  - Progreso de dias completados.
  - Selector de dias planificados.
  - Guardar y continuar al siguiente dia.
  - Finalizar registro de rutina al completar el ultimo dia.
- Se elimino la opcion de copiar rutina desde otro dia para simplificar el flujo.
- Se agrego check-in previo al entrenamiento con motivacion, hidratacion, sueño y energia fisica.
- Se permite omitir el check-in y se registra internamente como usuario no quiso registrar.
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
- Se eliminaron valores predeterminados del registro de series para que el usuario escriba lo realizado.
- Se elimino el selector de ejercicio del registro de series; el ejercicio activo se elige desde Ejercicios a realizar.
- Se agrego ayuda contextual para explicar RIR.
- Se hizo dinamico el numero de casillas de series segun las series objetivo registradas en la rutina.
- Se corrigio el caso donde un ejercicio de 5 series mostraba solo 4 casillas de registro.
- Al completar todos los ejercicios se habilita Guardar entrenamiento.
- Se guardan registros por semana para permitir comparacion futura.

## Panel principal

- Se agrego un resumen motivacional en el panel principal con lectura breve del avance semanal.
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
- Se agrego un carrusel semanal en el panel principal para recorrer Lunes a Domingo con flechas.
- Los dias con rutina quedan marcados y el dia calendario actual queda destacado.
- Se corrigio la deteccion del dia inicial del panel para que siempre parta desde el dia calendario real.
- Se corrigio la fecha del carrusel semanal: al pasar de Lunes a Martes tambien cambia del 18-05 al 19-05, y asi con el resto de la semana.
- Se elimino el boton Editar rutina semanal del panel principal para dejarlo mas limpio.
- Se creo la seccion Registro de entrenamiento en el menu lateral para crear o modificar rutinas.
- Se reemplazaron las flechas grandes del carrusel del panel principal por scroll horizontal con indicadores de posicion debajo de Ir a rutina.
- El carrusel del panel principal ahora muestra solo los dias con rutina registrada; si hay 2 dias muestra 2 posiciones, si hay 3 muestra 3 y como maximo 7.
- Se elimino la fila de chips de dias del panel principal y se dejo la navegacion semanal solo con puntos de posicion.
- En entorno local se desactiva y limpia el service worker para evitar pantallas rotas por chunks antiguos durante el desarrollo.

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
- Se corrigio la metrica objetivo de comparacion para usar KG totales de la rutina, sumando el peso objetivo una vez por ejercicio.
- Se dejo el volumen de trabajo separado y etiquetado como peso por repeticiones.
- Se renombro el volumen semanal y los previews de registro a "Volumen de trabajo" para no confundirlo con los KG totales de la rutina.
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
