# Fotos de progreso: preparación Cloudinary QA

Estado: código local, sin migración aplicada ni integración visible. La auditoría y la autorización específica del dueño preceden a cualquier cambio en QA. PDF y otros archivos quedan fuera de esta fase.

## Diseño

- `POST /api/progress/photos` recibe **sólo** `file` y `pose` (`frente`, `perfil`, `espalda`) con JWT de Alumno. El servidor verifica usuario y vínculo activo con Supabase antes de leer el archivo y el RPC de registro repite el gate después de Cloudinary.
- Se valida extensión, MIME, bytes de firma y límite de 20 MiB. La llamada firmada a Cloudinary la hace sólo el backend con `allowed_formats=jpg,png,webp,heic`, `type=authenticated`, `transformation=fl_force_strip`, `discard_original_filename=true` y un ID UUID v4 generado por servidor. La transformación entrante reemplaza el original almacenado y elimina EXIF/IPTC/XMP.
- El backend verifica la firma de respuesta y registra el ID opaco de Cloudinary mediante un RPC SECURITY DEFINER que comprueba HMAC, `auth.uid()`, vínculo activo y límites. El secreto HMAC vive en Vault, nunca en el repositorio ni en el navegador. Supabase guarda ownership, check, reporte y revocación.
- `GET /api/progress/photos/:assetId` lee por proxy sin redirección ni URL de Cloudinary. Un Coach debe enviar `reportId`; el RPC comprueba el ítem exacto y el episodio activo en cada solicitud. Las respuestas llevan `Cache-Control: private, no-store`.

## Configuración posterior del dueño, sólo en QA

1. Tras auditoría, aplicar la migración nueva `20260924130000_progress_cloudinary_photo_ingest.sql` a QA. No alterar la migración Fase 1.
2. Crear un entorno Cloudinary **QA separado**. Deshabilitar acceso público al original y derivados; confirmar que el tipo `authenticated` se respeta y que ninguna configuración o preset sobrescribe `type`, `allowed_formats` o `transformation`. No habilitar unsigned uploads. Verificar con una foto de prueba con GPS/EXIF que el recurso almacenado carece de EXIF/IPTC/XMP.
3. Configurar en el backend QA, como variables **server-only**, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` y `PROGRESS_PHOTO_ATTESTATION_KEY` (aleatorio, al menos 32 caracteres). Nunca usar prefijo `NEXT_PUBLIC_` para estas variables. La URL y anon key de Supabase ya existentes siguen siendo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`; el backend usa el JWT del usuario y jamás `service_role`.
4. Guardar exactamente el mismo valor de `PROGRESS_PHOTO_ATTESTATION_KEY` como secreto `progress_photo_attestation_key` en Supabase Vault **QA**. Realizarlo por canal seguro; no pegar el valor en SQL versionado, tickets, logs o este documento.
5. Ejecutar QA manual de Alumno vinculado, Alumno desvinculado, Coach con reporte, Coach ajeno, desvinculación posterior, PDF, MIME/extensión falsos, tamaño mayor a 20 MiB y metadatos GPS/EXIF. Confirmar que nunca aparece URL de Cloudinary ni firma en respuestas o logs.

## Riesgos y gates

- La migración Fase 1 debe estar aplicada en QA antes que esta migración. Este worktree no consulta ni modifica el estado remoto.
- Si falla el registro, el backend intenta eliminar el recurso recién cargado. Una caída entre la carga y el registro, o un fallo de ese borrado, puede dejar un recurso `authenticated` huérfano. Antes de habilitar UI o pasar a PROD, definir y validar una reconciliación/limpieza segura de esos recursos en QA.
- La petición multipart se cuenta por bytes reales y se limita a 21 MiB, incluidos encabezados multipart. Se materializa en memoria en el runtime Node. Validar en QA el límite de carga del despliegue antes de habilitar tráfico real.
