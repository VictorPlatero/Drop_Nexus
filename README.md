# Database Nexus

Cada usuario dispone de un espacio aislado. Las bases importadas y sus configuraciones se conservan durante 24 horas y luego se eliminan automáticamente.

SaaS multi-tenant para configurar, supervisar y ejecutar replicaciones por lotes entre PostgreSQL, MySQL, MariaDB, SQL Server, SQLite y MongoDB.

## Requisitos

- Node.js 20 o superior
- Acceso de red a Supabase y a las bases externas configuradas
- Para SQLite en Render, un disco persistente si el archivo debe sobrevivir despliegues

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

## Variables

| Variable | Requerida | Descripción |
|---|---:|---|
| `DATABASE_URL` | Sí | URL PostgreSQL de metadatos Supabase |
| `JWT_SECRET` | Sí | Secreto de al menos 32 caracteres |
| `ENCRYPTION_KEY` | Sí | Preferiblemente 64 caracteres hex para AES-256-GCM |
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

## Seguridad y operación

- JWT de 7 días y rate limit de 100 solicitudes/minuto/IP.
- Contraseñas externas cifradas con AES-256-GCM y nunca devueltas al cliente.
- Archivos SQLite validados, almacenados de forma aislada por usuario y sujetos al límite de carga configurable.
- Scripts SQL Server compatibles con separadores `GO`, identificadores `[schema].[tabla]` e `INSERT` con o sin `INTO`.
- Respaldos SQL Server `.bak` restaurados temporalmente cuando se configura un servidor y una carpeta compartida.
- Consultas de valores parametrizadas e identificadores escapados por motor.
- Aislamiento de configuraciones por `user_id`; el admin solo obtiene una vista sin credenciales.
- Timeout de conexión de 5 segundos, máximo 10 configuraciones por usuario y lotes de 5000 filas.
- Los trabajos activos se mantienen en memoria. Detener o reiniciar una instancia marca el proceso operativo como interrumpido; para ejecución distribuida de larga duración conviene añadir una cola persistente.
- En Render, `render.yaml` monta `/var/data/sqlite` como disco persistente para conservar las bases SQLite subidas.

## Nota sobre replicación

La implementación realiza una copia incremental por offset durante una ejecución. No es CDC. Si se requiere replicación continua con garantías exact-once, el siguiente nivel arquitectónico es usar WAL/binlog/change streams y una cola persistente.
