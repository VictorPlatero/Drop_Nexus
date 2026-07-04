# Database Nexus

Cada usuario dispone de un espacio aislado. Las bases importadas y sus configuraciones se conservan durante 24 horas y luego se eliminan automáticamente.

SaaS multi-tenant para configurar, supervisar y ejecutar replicaciones por lotes entre PostgreSQL, MySQL, MariaDB, SQL Server, SQLite y MongoDB.

## Requisitos

- Node.js 20 o superior
- Acceso de red a Supabase y a las bases externas configuradas
- No requiere disco persistente en Render; los catálogos comprimidos se guardan en PostgreSQL/Supabase

## Desarrollo local

La conexión de Supabase entregada está configurada en `backend/.env`, archivo ignorado por Git. Antes de publicar el proyecto, rota esa contraseña porque fue compartida como texto.

```bash
npm run install:all
npm run dev:backend
```

En otra terminal:

```bash
npm run dev:frontend
```

Frontend: `http://localhost:5173`  
API: `http://localhost:3000/api/status`

El backend inicializa de forma idempotente las columnas e índices requeridos y crea el administrador al arrancar.

## Visual Studio Code

El repositorio incluye una configuración portable en `.vscode/` para Windows, Linux y macOS.

- Al abrir el proyecto, VS Code sugerirá extensiones para Tailwind, variables `.env`, formato y pruebas HTTP.
- Las tareas usan `npm.cmd` en Windows y `npm` en Linux/macOS.
- Desde **Terminal > Run Task** puedes ejecutar `Install all dependencies`, `Dev backend`, `Dev frontend`, `Typecheck` y `Build`.
- Desde **Run and Debug** puedes iniciar `Backend dev` o `VS Code Extension`.
- La carpeta `vscode-extension/` contiene una extension local de VS Code con comandos para abrir la skill `.md`, el plugin, el chatbox, insertar consultas sugeridas y validar la integracion del asistente.

## Variables

| Variable | Requerida | Descripción |
|---|---:|---|
| `DATABASE_URL` | Sí | URL PostgreSQL de metadatos Supabase |
| `JWT_SECRET` | Sí | Secreto de al menos 32 caracteres |
| `ENCRYPTION_KEY` | Sí | Preferiblemente 64 caracteres hex para AES-256-GCM |
| `OPENAI_API_KEY` | No | Clave secreta para activar el asistente externo del chatbox |
| `OPENAI_MODEL` | No | Modelo del asistente, por defecto `gpt-5.5` |
| `FRONTEND_URL` | No | Orígenes CORS separados por coma |
| `PORT` | No | Puerto del API, por defecto `3000` |
| `ADMIN_EMAIL` | No | Email del admin inicial |
| `ADMIN_PASSWORD` | No | Contraseña del admin inicial |
| `ADMIN_NAME` | No | Nombre del admin inicial |
| `SQLSERVER_RESTORE_HOST` | Para `.bak` | Servidor SQL Server temporal con permisos `RESTORE DATABASE` |
| `SQLSERVER_RESTORE_PORT` | No | Puerto del servidor de restauración, por defecto `1433` |
| `SQLSERVER_RESTORE_USER` | Para `.bak` | Usuario SQL Server de restauración |
| `SQLSERVER_RESTORE_PASSWORD` | Para `.bak` | Contraseña del usuario de restauración |
| `SQLSERVER_BACKUP_DIR` | Para `.bak` | Carpeta compartida, escribible por la app y visible con la misma ruta para SQL Server |
| `SQLSERVER_DATA_DIR` | Para `.bak` | Carpeta donde SQL Server puede crear los archivos temporales restaurados |
| `SQLSERVER_RESTORE_ENCRYPT` | No | Usa `true` si la conexión de restauración requiere cifrado |
| `SQLSERVER_RESTORE_TRUST_CERT` | No | Confía en el certificado; por defecto `true` |
| `SQLSERVER_RESTORE_TIMEOUT_MS` | No | Tiempo máximo de restauración; por defecto 300000 ms |
| `MAX_DATABASE_FILE_SIZE_MB` | No | Tamaño máximo por archivo; por defecto 500 MB |

## Compilación

```bash
npm run build
npm start
```

En producción Fastify sirve `frontend/dist` y las APIs bajo `/api`.

## Render

1. Crea un Blueprint desde `render.yaml`.
2. Define `DATABASE_URL` y `ADMIN_PASSWORD` en los secretos solicitados.
3. Conserva `JWT_SECRET` y `ENCRYPTION_KEY` generados. Cambiar `ENCRYPTION_KEY` inutiliza contraseñas de conexiones ya cifradas.
4. Despliega. El health check usa `/api/status`.

No es necesario ejecutar migraciones manuales en Supabase: el backend crea y amplía sus tablas al iniciar. Las tablas auxiliares almacenan IDs de referencia como texto para ser compatibles tanto con proyectos antiguos que usan IDs enteros como con instalaciones nuevas basadas en UUID.

La importación `.bak` solo funciona si Render tiene acceso a un SQL Server externo y a una carpeta compartida visible con la misma ruta para ambos servicios. Sin esa infraestructura, utiliza scripts `.sql`; Render no incluye SQL Server dentro del servicio Node.

Los catálogos normalizados se comprimen y almacenan en Supabase/PostgreSQL, por lo que el servicio web no necesita Persistent Disk. Los archivos originales se usan temporalmente durante la importación y se eliminan al terminar. Las configuraciones antiguas que apuntan a `/opt/render/project/...` o `/var/data/...` deben eliminarse e importarse nuevamente una sola vez.

## Seguridad y operación

- JWT de 7 días y rate limit de 100 solicitudes/minuto/IP.
- Contraseñas externas cifradas con AES-256-GCM y nunca devueltas al cliente.
- Archivos SQLite validados, almacenados de forma aislada por usuario y sujetos al límite de carga configurable.
- Scripts SQL Server compatibles con separadores `GO`, identificadores `[schema].[tabla]` e `INSERT` con o sin `INTO`.
- Respaldos SQL Server `.bak` restaurados temporalmente cuando se configura un servidor y una carpeta compartida.
- Consultas de valores parametrizadas e identificadores escapados por motor.
- Aislamiento de configuraciones por `user_id`; el admin solo obtiene una vista sin credenciales.
- Timeout de conexión de 5 segundos, máximo 10 configuraciones por usuario y lotes de 5000 filas.
- El progreso de los trabajos se conserva en PostgreSQL y las ejecuciones interrumpidas se reanudan al arrancar.
- En Render, los catálogos de SQLite y de los demás formatos se conservan en Supabase/PostgreSQL.

## Nota sobre replicación

El replicador permite selección múltiple de tablas, mapeo y transformación de columnas, modos insertar/upsert/reemplazar/recargar, reintentos, progreso persistente, reanudación y ejecuciones programadas incrementales por offset.

Las ejecuciones incrementales por offset son adecuadas cuando el origen agrega filas de forma estable. No constituyen CDC ni garantizan exact-once si se eliminan o reordenan filas durante el proceso. Para ese nivel se requiere WAL, binlog o change streams y una cola persistente.

La propuesta principal se centra en la app de replicación: importar bases, seleccionar origen y destino, mapear tablas y columnas, validar el flujo y ejecutar réplicas con historial, reintentos y reportes.

Las bases importadas como archivo pueden descargarse después de ser modificadas por una réplica en formato Excel (`.xlsx`), SQLite (`.sqlite`) o JSON. La importación acepta SQLite, scripts SQL, MongoDB JSON/NDJSON, Excel/CSV y respaldos SQL Server `.bak` cuando se configura un SQL Server temporal de restauración con las variables `SQLSERVER_RESTORE_*`.
