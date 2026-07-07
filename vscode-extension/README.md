# Database Nexus Replicator para VS Code

Extension local para trabajar con la skill, plugin y chatbox del proyecto Database Nexus.

## Comandos

- `Database Nexus: Abrir skill del asistente`
- `Database Nexus: Abrir plugin del asistente`
- `Database Nexus: Abrir chatbox integrado`
- `Database Nexus: Insertar consulta sugerida`
- `Database Nexus: Validar skill, plugin y chatbox`
- `Database Nexus: Describir archivo de base de datos`
- `Database Nexus: Generar script de replicacion`
- `Database Nexus: Abrir app local`

## Proposito

La extension deja visible en VS Code la integracion pedida para el proyecto:

- una skill `.md` adaptada al replicador de datos,
- un plugin del proyecto que consume esa skill,
- un chatbox integrado en el dashboard,
- consultas sugeridas para replicacion entre bases de datos.
- un resumen rapido desde click derecho para archivos `.sql`, `.sqlite`, `.sqlite3`, `.db`, `.json`, `.ndjson` y `.csv`,
- un generador de scripts SQL para copiar datos entre tablas sin ejecutar nada automaticamente.

## Click derecho en archivos

En el explorador de VS Code, haz click derecho sobre un archivo soportado y ejecuta `Database Nexus: Describir archivo de base de datos`.

- En `.sql` detecta tablas declaradas con `CREATE TABLE`, columnas e inserts.
- En `.sqlite`, `.sqlite3` y `.db` usa el comando `sqlite3` si esta instalado en el equipo.
- En `.json`, `.ndjson` y `.csv` muestra campos/columnas y conteos aproximados.

## Generar script de replicacion

Ejecuta `Database Nexus: Generar script de replicacion`, elige motor, tabla origen, tabla destino, columnas y modo (`insert`, `upsert` o `replace`). La extension abre un archivo SQL temporal para revisarlo y correrlo manualmente en el motor correspondiente.

El script asume que origen y destino son accesibles desde la misma conexion o servidor. Para bases en servidores distintos, usa Database Nexus o adapta el script con FDW, linked servers, dumps, staging tables u otra estrategia propia del motor.

## Desarrollo

Desde VS Code, abre este repositorio y ejecuta la configuracion de depuracion `VS Code Extension`. Se abrira una nueva ventana de VS Code con la extension cargada.
