# Agente Hub

Un hub personal que muestra el estado de tus agentes en una barra compacta. Esta primera versión funciona localmente en Windows con Node.js 20+ y no necesita dependencias npm.

## Iniciar

1. Instala Node.js 20 o posterior.
2. Ejecuta `npm start` en este directorio.
3. Abre [http://127.0.0.1:43821](http://127.0.0.1:43821).

Para desarrollar la ventana nativa flotante, instala Rust y ejecuta `npm install` seguido de `npm run desktop`. Para generar instaladores de Windows, ejecuta `npm run desktop:build`; requiere Rust y las herramientas de compilación Tauri. Las instalaciones empaquetadas también requieren Node.js para iniciar el servicio local.

La barra permanece pegada al borde derecho, se expande al pasar el cursor y permite cambiar tema, lado, widgets y tiempo de aviso desde ⚙. Los eventos y preferencias se guardan localmente en `%APPDATA%/AgenteHub/data.json` (o `~/.config/agente-hub/data.json`). No se sincronizan ni se suben al repositorio.

## Enviar eventos

El servidor solo escucha en `127.0.0.1`. Al iniciarse imprime una clave local de ingestión; envíala como `Authorization: Bearer <clave>` junto con el evento:

```powershell
$headers = @{ Authorization = "Bearer TU_CLAVE" }
$body = @{
  agent = "Mi agente"
  session = "tarea-123"
  status = "needs_help" # working | done | needs_help | failed
  message = "Necesito que revises el acceso"
  project = "Mi proyecto"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:43821/api/events -Headers $headers -ContentType "application/json" -Body $body
```

`POST /api/events` acepta `{agent, session, status, message?, project?, source?}`. La misma combinación de agente, sesión, estado y mensaje no se duplica si llega repetida en un minuto. `GET /api/state` devuelve el estado y `GET /api/stream` ofrece Server-Sent Events.

### Cursor CLI

El endpoint `POST /api/cursor/run` inicia una sesión `cursor-agent` en un directorio indicado y procesa el flujo NDJSON de `--output-format stream-json`. Requiere Cursor CLI instalado y autenticado. Enviar `{"prompt":"...","cwd":"C:\\ruta\\proyecto"}`; opcionalmente `agent` y `project`. La clave va en `Authorization`.

### Devin

En Ajustes, introduce el ID de organización y una clave de servicio Devin. El hub consulta la API de sesiones cada 30 segundos. Las credenciales quedan solo en el archivo local. La solicitud de uso de la API y sus permisos pertenecen a tu cuenta de Devin.

### Codex, Grok y otros

Para cualquier agente que pueda ejecutar un script, usa el endpoint común anterior para informar `working`, `done`, `needs_help` o `failed`. El hub no observa aplicaciones externas por sí mismo. La detección automática de sesiones Codex mediante `app-server` y conectores adicionales pueden añadirse detrás del mismo formato común.

## Seguridad y privacidad

- El servidor solo acepta conexiones de loopback y requiere la clave aleatoria local para modificar estado.
- No se guardan prompts ni contenido de conversaciones, solo el último mensaje de estado.
- `data/` está excluido de Git; nunca compartas el archivo local porque puede incluir claves API.
- El instalador es una ventana Tauri transparente y siempre visible; la versión web es útil para desarrollo y diagnóstico.

## Desarrollo

`npm test` ejecuta las pruebas de estado y API usando el runner integrado de Node. No se requieren paquetes externos.
