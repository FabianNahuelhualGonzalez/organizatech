# Documentos médicos PDF — contrato privado del Alumno

Estado: implementación local sobre `origin/qa` `11083e9`. No se aplicó a Supabase QA ni PROD, no hay UI visible y no se configuró ningún worker remoto.

## Límite de confianza

`progress-document-staging` es un bucket privado de `application/pdf` y 25 MiB. El Alumno autenticado con registro y vínculo activo llama `begin_own_medical_document_upload()` sin argumentos. SQL crea una reserva de una hora y una ruta de dos UUID opacos. El navegador sólo puede insertar esa ruta una vez, con MIME PDF y sin upsert; no tiene UPDATE ni DELETE. `finalize_own_medical_document_upload(upload_id)` exige que la reserva sea propia, esté pendiente, tenga objeto en Storage y conserve el vínculo activo. No publica el asset.

El bucket final privado `progress-medical-documents` conserva los límites de fase 1. Ningún rol de navegador puede insertar, actualizar o borrar allí, incluso si otra policy permisiva se agrega. Los grants de tablas `private` siguen revocados para `authenticated` y `anon`. Los predicados restrictivos de Storage se ejecutan también para los roles técnicos de Fotos y Documentos; cada uno puede evaluar el predicado ajeno, pero sólo su propia identidad activa y sus rutas registradas permiten operaciones. [Supabase documenta que Storage usa RLS y admite roles personalizados](https://supabase.com/docs/guides/storage/schema/custom-roles).

El proceso de Documentos usa una cuenta Auth técnica y rol `progress_document_publisher`, separados del principal de Fotos. El único Custom Access Token Hook existente conserva el rol de Fotos y asigna el nuevo rol únicamente al principal de Documentos activo. Rechaza que un mismo UUID técnico esté activo en ambos registros. Tokens normales conservan sus claims y ambos roles técnicos quedan limitados a 15 minutos; cada RPC y policy comprueba el estado actual del principal, de modo que revocarlo invalida su acceso antes de que venza el token. El hook sigue siendo invoker, con acceso exclusivo de `supabase_auth_admin`. [Supabase describe el hook y sus permisos](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

## Verificación y publicación

Una pasada de `scripts/run_medical_document_publisher.ts` inicia una sesión Auth nueva usando credenciales técnicas guardadas exclusivamente en el servidor del worker. Verifica los claims firmados, reclama una reserva propia del flujo y descarga staging con límite de bytes reales. `verifyMedicalDocument` comprueba `application/pdf`, cabecera `%PDF-`, marcador final `%%EOF`, tamaño entre 1 byte y 25 MiB y análisis completo con `pdfinfo` de Poppler. Exige páginas válidas, documento no cifrado y ausencia de JavaScript declarado. `pdfinfo -` lee desde stdin sin crear un archivo temporal con datos médicos ([manual de Poppler](https://manpages.debian.org/bookworm/poppler-utils/pdfinfo.1.en.html)). El worker aislado debe tener `pdfinfo` instalado y actualizado; si falta o falla, no publica.

El worker sube los mismos bytes verificados a una ruta final diferente, generada por SQL, sin upsert. Los descarga otra vez y compara longitud y contenido en tiempo constante. Borra staging mediante Storage API antes de llamar `publish_verified_medical_document`; la RPC vuelve a comprobar principal, estado, plazo, vínculo activo, objeto final, MIME y tamaño registrado por Storage, y ausencia del objeto staging. Recién entonces inserta un `progress_assets` disponible con `kind = medical_document`. `display_name = Documento médico` y `document_category = otro` son valores fijos del servidor; el cliente no suministra ownership, Coach, bucket, ruta, asset, MIME, bytes ni metadata de publicación.

Un fallo marca la reserva para limpieza. La pasada siguiente reclama hasta tres reservas vencidas o fallidas con lease corto y borra únicamente rutas registradas que aún no son assets publicados. La eliminación usa Storage API para eliminar bytes físicos. Ejecutar un solo worker a la vez, con pasadas periódicas y sin registrar documentos, rutas ni credenciales. El script no instala scheduler ni despliega servicios.

## Lectura y envío explícito

`list_own_medical_documents` y `get_own_medical_document` filtran por `auth.uid()` y asset disponible, incluso después de perder el vínculo. El gateway tipado sólo descarga la ruta devuelta por el detalle autorizado; Storage reevalúa RLS. Un Coach no ve un documento recién subido. El Alumno puede enviar uno explícitamente con el RPC de fase 1 `create_own_progress_report('medical_document', [assetId], ...)`, que valida ownership y vínculo activo. Storage concede lectura al Coach destinatario sólo mientras ese vínculo permanezca activo; la revocación corta el acceso al objeto. Sin vínculo, tampoco se admiten reservas, encolado ni nuevos reportes.

## Gate de QA pendiente

1. Auditar la migración y ejecutar primero en QA con autorización específica; confirmar schema, grants, policies, Auth Hook y bucket en Supabase real. No aplicar a PROD antes de QA PASS.
2. Crear una cuenta Auth técnica exclusiva de Documentos en QA, no registrada como Alumno ni Coach. Guardar sus credenciales sólo en el servidor del worker, registrar su UUID como principal `active` y verificar que Fotos conserva su principal separado. Para revocar, cambiar su fila a `revoked`, cerrar sesiones y rotar contraseña.
3. Instalar y mantener `pdfinfo` de Poppler en el worker aislado. Verificar inicio de sesión por pasada, claims, descarga, publicación y limpieza con un PDF real; probar MIME falso, bytes con cabecera falsificada, archivo de 25 MiB y uno de 25 MiB + 1 byte. Verificar que el worker falla cerrado si falta `pdfinfo`.
4. Probar con dos Alumnos y dos Coaches: staging propio y ajeno, asset propio y ajeno por ID/ruta, PDF no enviado, reporte explícito al Coach correcto, pérdida del vínculo, lectura histórica del Alumno, denegación inmediata al Coach y bloqueo de nuevas cargas/envíos. Repetir con un JWT técnico emitido antes de revocar el principal.
5. La QA manual, visual y funcional corresponde al dueño de producto. El gateway no está conectado a UI; para una futura UI hará falta aprobación de producto independiente.

El runner PostgreSQL local usa un cluster temporal y datos sintéticos. No sustituye la prueba de Storage/Auth real en QA ni valida cómo ese servicio materializa los bytes físicos. La verificación focal de PDF usa Poppler cuando está disponible y PDFKit sólo como parser local de prueba en macOS; el worker usa exclusivamente Poppler.
