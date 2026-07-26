# Islautopia Intercom Card — nota de contexto

Este repo es la mitad "frontend" de la misión de integración con Home Assistant del ecosistema
IG Doorbell. El diseño completo (incluida la parte que afecta a esta card) vive en el repo
hermano:

- `C:\Proyectos_espressif\ig_hassio_addons\ig_hassio_addons\CLAUDE.md` — resumen operativo.
- `C:\Proyectos_espressif\ig_hassio_addons\ig_hassio_addons\ARCHITECTURE.md` — diseño concreto
  (sección 5: rediseño de esta card — nuevo modo `native` hablando el protocolo WebRTC propio del
  doorbell, ICE-Lite+DTLS-SRTP+RTP directo o vía relay, credenciales servidas por la nueva
  integración `custom_components/islautopia_doorbell` vía la API interna de WebSocket de HA).
- `C:\Proyectos_espressif\ig_hassio_addons\ig_hassio_addons\COORDINATION.md` — preguntas abiertas
  a la sesión líder de firmware.

Fuente de verdad de la interfaz del propio doorbell (WebRTC, señalización, `pair_app`,
`app_turn_credentials`, etc.): `C:\Proyectos_espressif\IG_Doorbell\API_CONTRACT.md`. No la
dupliques aquí.

**Estado actual (2026-07-10): modo `native` es el ÚNICO modo — el modo `go2rtc` legacy se retiró
por completo, ver entrada Q22-bis más abajo.** `dist/islautopia-intercom-card.js` sigue siendo un
único fichero committeado (sin build tooling — se mantuvo así a propósito, ver `ARCHITECTURE.md`
§5). `device_id` es obligatorio (habla el protocolo propio del doorbell — SSE/POST local por
HTTPS real, con fallback a WS remoto vía el relay; credenciales/host servidos por la integración
`islautopia_doorbell` — repo `islautopia-doorbell-integration` — vía `hass.connection.
sendMessagePromise`, nada pegado a mano en YAML); apertura de puerta primaria = mensaje nativo
`open`/`open_result`, con `unlock_entity`+`callService` disponible como alternativa explícita.
Sintaxis verificada con `node --check` — **no probado contra una instancia real de HA + doorbell
real** (no disponible en esta sesión).

Patrones de UX conservados de la versión anterior: pista de audio dummy + hot-swap `replaceTrack`
sin renegociar SDP, cierre limpio de conexión al salir de la pestaña, editor visual Lovelace,
i18n (9 idiomas), memoria de volumen en `localStorage`. Publicado en HACS
(`Islautopia/islautopia-intercom-card`, tags `v1.0.0`/`v1.0.1`).

**Editor: device picker nativo con `ha-selector` (2026-07-09).** El campo `device_id` ya no es un
input de texto donde el usuario tenga que copiar/pegar el ID — el editor monta un
`<ha-selector>` (el mismo componente que usa el propio Home Assistant en sus formularios),
filtrado a `selector: {device: {filter: {integration: 'islautopia_doorbell'}}}`, así que solo
lista doorbells ya emparejados con esa integración, por nombre. Requiere que la integración
registre el dispositivo en el device registry de HA (hecho en
`islautopia-doorbell-integration/custom_components/islautopia_doorbell/__init__.py::
async_setup_entry`, `device_registry.async_get_or_create(...)` con
`identifiers={(DOMAIN, device_id)}`). El picker devuelve el ID interno de HA (una UUID opaca),
NO nuestro `device_id` propio — `findOurDeviceIdForHaDeviceId()`/`findHaDeviceIdForOurDeviceId()`
en el editor traducen entre los dos vía ese mismo `identifiers`, y la config de la card sigue
guardando siempre nuestro `device_id` propio (estable, derivado de la MAC), nunca el ID interno
de HA (menos estable a largo plazo). Fallback a un `<input>` de texto oculto si por lo que sea
`ha-selector` no estuviera disponible en el frontend (defensivo, no debería pasar en la práctica).

**Señalización local ahora exige credencial (2026-07-09).** `/webrtc/signal`/`/webrtc/signal/post`
locales dejaron de aceptar conexiones sin autenticar (hueco de seguridad real, cerrado por el
líder). `tryLocalSignaling()`/`sendNativeSignal()` añaden `?token=<credencial de pair_app>` como
query param a ambas URLs (`EventSource` no admite cabeceras propias, de ahí el query string en
vez de `Authorization`) — es la MISMA credencial de `this._connInfo.credential` que ya se pedía
para el WS remoto, sin ningún secreto ni llamada nueva. Sin este `?token=`, el modo `native` local
da `401` desde esa fecha en adelante. Ver `COORDINATION.md` Q9.

**Guardas de idempotencia en `customElements.define`/`window.customCards` (2026-07-09).**
Encontrado en pruebas reales: con el recurso antiguo de HACS y el nuevo `/local/...` cargados a
la vez en el navegador (caso real: probar cambios locales sin publicar antes una release HACS
nueva), el segundo `customElements.define('islautopia-intercom-card', ...)` lanzaba una excepción
("has already been used with this registry") — y, más grave que el ruido en consola, según el
orden de carga podía quedar activa la copia VIEJA de HACS en vez de la que se estaba probando.
Las dos llamadas a `customElements.define` (editor + card) ahora comprueban
`customElements.get(...)` antes, con un `console.warn` explícito de cuál copia gana si hay
colisión — evita el crash, pero **no sustituye a la solución real**: durante cualquier prueba de
cambios sin publicar, mantener activo un solo recurso Lovelace de esta card a la vez (desactivar/
quitar el de HACS, o el manual, no ambos). Ver `COORDINATION.md` Q11.

**Liberación de slot al cerrar/recargar la pestaña (2026-07-10).** Verificado contra el código
real (no de memoria) que la card NO replicaba el patrón `pagehide`+`sendBeacon` que ya usa el
dashboard web del propio doorbell — solo tenía `disconnectedCallback()` (Custom Elements), fiable
al cambiar de vista de Lovelace pero no garantizado en cierre de pestaña/recarga completa.
Corregidos dos bugs reales: (1) `disconnectedCallback()` no mandaba `bye` para el camino LOCAL
antes de cerrar (solo lo hacía el remoto) — corregido; (2) nuevo listener `pagehide` a nivel de
`window` (`_registerUnloadHandler()`/`_unregisterUnloadHandler()`), con `navigator.sendBeacon()`
para el camino local (un `fetch()` en marcha se cancela al desaparecer la página, `sendBeacon` no)
y `nativeWS.send()` síncrono para el remoto (sendBeacon no aplica a WebSocket). Deliberadamente
SIN `visibilitychange` — cambiar de pestaña del navegador sin cerrarla no debe cortar la sesión,
sería peor UX que la actual. Ver `COORDINATION.md` Q18.

**Vigilante de señales de vida + reconexión automática (2026-07-10).** Diseño simétrico con el
timeout de abandono del firmware (bajado de 45s a 20s) — la card ya no espera pasivamente,
`_startLifeWatchdog()` sondea `pc.getStats()` cada 5s (progreso real de `packetsReceived` en el
inbound-rtp de vídeo, no el estado de ICE del navegador, poco fiable/no ajustable a 20s exactos) y
`_scheduleReconnect()` reconecta si pasan 20s sin señal de vida (mensajes de señalización durante
la negociación, o progreso de vídeo una vez conectado). **Criterio agresivo, decisión explícita
del usuario** (mismo criterio al que llegó `android_app` de forma independiente): tanto `failed`
COMO `disconnected` en `pc.onconnectionstatechange` disparan reconexión inmediata sin esperar el
resto del cronómetro — a sabiendas de que `disconnected` puede ser transitorio, a validar en real
contra la cobertura 4G/5G mala del usuario (pendiente, fase "bajo fuego real"). Reintentos
indefinidos con backoff (2s/4s/8s, tope 15s), sin límite de intentos (producto de seguridad
doméstica). Nuevo `_teardownConnectionObjects()` centraliza la limpieza (usado por
`disconnectedCallback()`, `startWebRTC()` y `_scheduleReconnect()`, sin duplicar código) — un
`bye` recibido del propio dispositivo también dispara reconexión ahora, en vez de solo pintar el
badge en rojo. Verificado con `node --check` y una simulación aislada en Node de la fórmula de
backoff y el parseo de `getStats()` — sin acceso a navegador/HA real en esta sesión. Ver
`COORDINATION.md` Q19.

**Bug real en `triggerUnlock()` para `unlock_entity` de dominio `cover` (2026-07-10) —
CORREGIDO.** El README ya anunciaba `cover` como dominio soportado (verjas/portones), pero el
código caía al `else` genérico y llamaba a `cover.turn_on` — servicio que NO EXISTE en el dominio
`cover` de HA (verificado contra la documentación real antes de tocar nada: `cover` usa
`open_cover`/`close_cover`/`stop_cover`, nunca `turn_on`/`turn_off`; llamarlo lanza
`ServiceNotFound`). Cualquier usuario con una entidad `cover` real configurada habría visto
fallar la apertura en silencio. Corregido: `cover` ahora usa `open_cover`/`close_cover`
explícitamente, igual que el resto de dominios. **Nota aparte, sin cambio de código**: el
accionador de apertura que publica el propio firmware está migrando de dominio `button` a
`light`/`switch` (decisión de firmware_cloud) — no afecta a esta card en absoluto, ya que
`unlock_entity` es siempre una entidad elegida manualmente por el usuario (nunca auto-enlazada a
la del firmware) y el código ya trata `switch`/`light` de forma idéntica.

**Tres bugs reales reportados por el usuario, los tres CORREGIDOS (2026-07-10) — ver
`COORDINATION.md` Q22 en `ig_hassio_addons` para el análisis completo:**

1. **El vídeo no escalaba al ajustar el ancho de la card.** Esta card no usa Shadow DOM
   (`this.innerHTML` directo sobre el propio elemento) y el elemento personalizado
   (`<islautopia-intercom-card>`) nunca declaraba su propio `display`/`width` — los Custom
   Elements autónomos son `display: inline` por defecto (se dimensionan a su contenido, no al
   contenedor) salvo que se declare lo contrario explícitamente; nadie lo hace por ti. Todo el
   CSS interno relativo (`width:100%` en `.intercom-container`/`.video-wrapper`/`video`) era
   correcto, pero resolvía "100%" contra un elemento que nunca crecía. Corregido: `this.style.
   display='block'; this.style.width='100%'` en `setConfig()` + regla CSS de respaldo
   `islautopia-intercom-card { display:block; width:100% }` en `injectStyles()`. **Landmine para
   el futuro**: si se añade Shadow DOM algún día, esto necesitará revisarse (un `:host` real
   sustituiría a la regla por nombre de etiqueta, que solo funciona en DOM ligero).

2. **Sospecha del usuario sobre el backchannel de audio (mic navegador → altavoz doorbell) sin
   audio real pese a que la UI mostraba "mic activo".** El patrón pista-muda+`replaceTrack()` en
   sí (`toggleIntercom()`/`buildNativePeerConnection()`) es correcto y equivalente al del
   dashboard web ya verificado (`main/webtask.c` en `IG_Doorbell`, Fase 9) — NO era la causa.
   Causa real: `_teardownConnectionObjects()` (punto único de cierre, usado también por el
   vigilante de reconexión de Q19) cerraba `pc`/señalización pero nunca reseteaba el estado del
   interfono — tras CUALQUIER reconexión (incluida una espontánea por el criterio agresivo
   `disconnected`→reconectar), el nuevo `RTCPeerConnection` nace con una pista muda nueva pero la
   UI seguía mostrando "mic activo" indefinidamente, sin volver a enganchar el micrófono real.
   Corregido: `_teardownConnectionObjects()` ahora para el `localAudioStream` real y resetea
   `intercomActive`/el botón a "apagado" en cualquier teardown — un reconecto NO reactiva el mic
   solo, el usuario debe volver a pulsar (decisión explícita: visible y predecible, no una
   auto-reactivación silenciosa que añadiría otra carrera).

3. **Flash breve de "❌ Error" en carga fría del dashboard antes de asentarse en el estado
   correcto.** `startNativeSession()` trataba la ausencia momentánea de `this._hass.connection`
   (carrera real de arranque: HA puede insertar el elemento antes de que el setter `hass` se
   haya invocado con una instancia hidratada) como error TERMINAL sin ningún reintento — a
   diferencia de cualquier otro fallo de esa función. El elemento se remonta poco después con
   `hass` ya listo (de ahí que pareciera "asentarse solo": un segundo intento con mejor suerte
   tapaba el primero, la función en sí nunca se corregía). Corregido: reintento en silencio cada
   250ms hasta ~5s antes de rendirse de verdad.

Verificación en los tres casos: `node --check` (sintaxis) + lectura/razonamiento estructurado del
código — **sin acceso a navegador/HA real en esta sesión** (mismo límite que Q19). Pendiente
confirmación visual/en-hardware por el líder/usuario; checklist exacto de qué comprobar en cada
caso está en `COORDINATION.md` Q22.

**Rediseño visual alineado con el mockup Figma + retirada completa del modo `go2rtc` legacy
(2026-07-10) — ver `COORDINATION.md` Q22-bis en `ig_hassio_addons` para el detalle completo.**

1. **Lenguaje visual del mockup Figma** (mismo que `android_app`/`ios_app`, decisión explícita del
   usuario): paleta exacta (`--ig-lime #78C800`, `--ig-cyan #00C4D4`, `--ig-blue #1976D2`,
   `--ig-surf1/2/3` para fondos oscuros), escopada como custom properties en `.intercom-container`
   (nunca en `:root` — esta card no usa Shadow DOM, así que `:root` filtraría al documento entero
   de HA). Marco de vídeo (`.feed-wrap`) con esquinas redondeadas ~22px y HUD superpuesto DENTRO
   del propio vídeo: `.live-tag` (punto + texto, sustituye al antiguo `.status-badge` suelto —
   pulsa en rojo solo en estado `live`/`open`, color distinto por estado vía `data-state`),
   `.audio-pill` cian (solo con el mic activo), `.motion-pill` ámbar (solo con `motion_entity`
   configurada y en `on` — **nunca visible con el mic activo**, regla explícita del usuario,
   aplicada en `_updateMotionPill()`). Botones de acción asimétricos (`.btn.mic` 80px protagonista
   con anillo de pulso vía `.pulsering` cuando está activo, `.btn.door` 60px secundario — tamaños
   exactos, ver pasada de precisión más abajo). Línea de
   estado nueva bajo el vídeo (`.status-line`, distinta del `.live-tag` — esa es sobre el ESTADO DE
   CONEXIÓN, esta es sobre el ESTADO DE LA PUERTA): cuenta atrás real en verde
   ("Puerta abierta · Cerrando en Ns", `_startDoorCountdown()`) al abrir, gris "Sistema operativo"
   en reposo. Chips de modo (`.mode-row`, opcional vía config `mode_entity`, un `select.*`
   arbitrario) con icono+color por modo (`MODE_META`) — el matching de la etiqueta real de HA a
   un modo conocido (normal/ausente/noche/custom) es por *substring* case-insensitive
   (`_modeKeyFor()`), deliberadamente tolerante porque el string exacto que publicará
   firmware_cloud para la entidad de modo no estaba cerrado en el momento de este cambio; una
   opción no reconocida se pinta igual (chip genérico sin tintar), nunca oculta la fila entera.
   Elementos del mockup que NO se copiaron (decisión explícita, no se aplican a una card de HA):
   selector de dispositivo con desplegable (una card = un dispositivo), cabecera de branding
   (logo+notificaciones — HA ya tiene su propia navegación), fila de accesos a
   Grabaciones/Ajustes como "pantallas" (la card no navega a pantallas propias).

2. **Modo `go2rtc`/`gateway` legacy RETIRADO POR COMPLETO** (decisión explícita del usuario —
   **rompe compatibilidad** para cualquier instalación que siguiera usando `stream:`/
   `go2rtc_url:` en vez de `device_id:`, ver aviso en `README.md`). Eliminado de
   `dist/islautopia-intercom-card.js`: `this.mode` (nativo es el único modo posible ahora),
   `connectGo2RTCWebSocket()`, `this.vlcWS`, los inputs `stream`/`go2rtc_url` del editor visual,
   las claves de idioma `ed_stream`/`ed_url` en los 9 idiomas. `setConfig()` ahora exige
   `device_id` directamente (antes aceptaba `stream` como alternativa). `startWebRTC()`
   simplificado a llamar siempre a `startNativeSession()`. Aprovechado el mismo aviso de
   `getUserMedia()` fallido en `toggleIntercom()` para añadir un `console.warn` (antes se tragaba
   el error en silencio, sin ningún rastro ni en consola).

Verificado con `node --check` (sintaxis OK tras cada edición) — **sin acceso a navegador/HA real
en esta sesión**, no se ha podido confirmar visualmente el resultado. Checklist de verificación
para el líder/usuario en `COORDINATION.md` Q22-bis.

**Pasada de precisión con valores EXACTOS del código fuente real (2026-07-10, mismo día) — el
líder pasó del mockup reconstruido/capturas a los valores literales del código fuente de
`android_app`/`ios_app`.** Ajustes sobre lo ya construido en Q22-bis:

- Tamaños de botón corregidos de 76px/56px (aproximados) a **80px/60px exactos**.
- Paleta completada con los 4 tokens que faltaban: `--ig-bg #070D1A` (antes `#05070c`
  aproximado, ahora usado en `.intercom-container`/`ha-card`), `--ig-text #E8F0FE` (antes texto
  del HUD en `#fff` plano), `--ig-faint #334155` y `--ig-blue-dark #1565C0` (ambos definidos como
  custom properties disponibles pero SIN un hueco semántico claro en el diseño actual de la
  card — no se han forzado a un uso artificial solo por existir en la paleta; documentado aquí
  por si aparece un sitio natural para ellos más adelante).
- **Dos piezas del HUD que faltaban por completo**, añadidas para la paridad visual real que pide
  el usuario (app→HASS→app como el mismo producto):
  - Reloj superpuesto arriba-dcha (`#hud-time-hm`/`#hud-time-date`, fuente monoespaciada,
    hora:minuto grande + fecha pequeña) — `_updateHudClock()`, `setInterval` de 1s arrancado en
    `render()` y parado en `disconnectedCallback()`. Es la hora del propio navegador (decorativo,
    igual que cualquier overlay de cámara de seguridad), no un dato del dispositivo.
  - Barras de señal esquina inferior-dcha (`.hud-sig`, 4 barras). **Adaptación deliberada, no
    imitación literal**: el mockup las usa para RSSI WiFi del propio dispositivo, un dato que
    esta card no tiene forma de conocer (no hay entidad HA para ello) — en vez de inventar un
    número falso, las barras reflejan el `data-state` real de la conexión WebRTC (mismo atributo
    que ya pinta `.live-tag`, propagado también a `.feed-wrap` desde `_setLiveState()`): todas
    encendidas en vivo, parcial en `connecting`, primera en rojo si `error`. Honesto sobre lo que
    la card puede saber de verdad, en el mismo lugar/estilo visual que el mockup.
  - El control de volumen (funcionalidad real de la card, sin equivalente en el mockup de la app)
    se reubicó junto a las barras de señal en la esquina inferior-dcha (`.hud-bottom-right`) en
    vez de competir por el hueco exacto de la píldora "Audio activo" (que sí es 1:1 con el
    mockup, esquina inferior-izq).

Verificado igual que el resto: `node --check` tras cada edición, sin navegador/HA real disponible.

**Bug real CORREGIDO (2026-07-10, mismo día): dos puntos de fallo de `startNativeSession()`
dejaban la card en "Error" para siempre, sin ningún reintento** — investigado a partir de un
reporte real del líder (una card en HA real, "IG DoorBell p4 v2", mostrando "Error" persistente,
sospecha de un `device_id` de pruebas antiguo/desactivado). Confirmado por lectura del código
(sin acceso a esa instancia real): es el único sitio de todo el fichero donde un fallo NO
programaba una reconexión, a diferencia de `nativeWS.onclose`, `'sessions_full'`,
`connectionState` `failed`/`disconnected`, el vigilante de 20s, y `bye` recibido — todos esos SÍ
llaman a `_scheduleReconnect()` (y los dos que no lo hacen explícitamente, `nativeWS.onclose` y
`sessions_full`, ya están cubiertos porque `_startLifeWatchdog()` arranca antes que ellos y
acabaría reconectando de todos modos al llegar a los 20s sin señal de vida). Los dos puntos
corregidos SÍ podían ejecutarse ANTES de que el vigilante de vida arrancara (que solo arranca
tras `buildNativePeerConnection()`), así que no tenían ninguna red de seguridad:

1. `hass.connection` sigue sin aparecer tras ~5s de reintento silencioso (línea ~762) — antes
   `return` terminal con badge a "Error"; ahora también llama a `_scheduleReconnect()`.
2. El `catch` que envuelve `get_connection_info`/`buildNativePeerConnection()`/señalización
   (línea ~792) — antes solo ponía el badge a "Error"; ahora también llama a
   `_scheduleReconnect()` tras el mensaje de error. Cubre exactamente el caso sospechado: si
   `get_connection_info` falla (p.ej. porque ese `device_id` ya no tiene una entrada
   válida/emparejada en la integración `islautopia_doorbell` — coherente con un dispositivo de
   pruebas antiguo/desactivado) o `startRelaySignaling()` rechaza (el relay no abre la conexión,
   dispositivo no autorizado), la card ahora reintenta con el mismo backoff de siempre en vez de
   quedarse muerta. Si el dispositivo de verdad ya no existe, esto simplemente reintenta en bucle
   en segundo plano (mismo principio ya establecido en Q19: mejor seguir intentándolo en silencio
   que un "Error" permanente sin ninguna vía de recuperación salvo recargar la página a mano).

No resuelve la posibilidad de que "IG DoorBell p4 v2" sea, en efecto, un dispositivo real ya
descontinuado (eso solo se puede confirmar mirando la lista de dispositivos emparejados en la
integración `islautopia_doorbell`, fuera del alcance de esta sesión) — pero si lo es, con este
fix la card debería dejar de mostrar un "Error" fijo para siempre y en su lugar seguir
reintentando visiblemente (badge "Conectando...") en bucle, que es el comportamiento correcto
tanto si el dispositivo vuelve algún día como si no.

**Backchannel HASS→altavoz mudo, CONFIRMADO y CORREGIDO con datos reales de Playwright
(2026-07-11) — ver `COORDINATION.md` Q24/Q24-bis para el análisis completo.** Dato crítico del
usuario: dashboard web del propio dispositivo y apps Android/iOS SÍ tienen audio bidireccional
real — descartó firmware/protocolo desde el principio, era un bug específico del JS de esta card.

Comparación línea a línea contra el dashboard confirmó por datos reales (no solo teoría) la causa:
la respuesta SDP que generaba esta card decía **`a=recvonly`** en la línea de audio, pese a que
`audioTransceiver.direction` se leía como `sendrecv` en ese mismo instante — el dispositivo,
como offerer, nunca esperaba audio del navegador. El orden del código (pista muda +
`direction:'sendrecv'` antes de `createAnswer()`) ya era correcto, así que no era un problema de
secuencia. La única diferencia de código real que quedaba sin explicar frente al dashboard (mismo
orden de creación en ambos: vídeo primero, audio después): la card usaba
`pc.addTransceiver(dummyTrack, {direction:'sendrecv'})` explícito; el dashboard usa
`pc.addTrack(dummyTrack)`. Por especificación WebRTC deberían ser equivalentes — los datos reales
de Playwright dijeron que no. **Corregido**: cambiado a `pc.addTrack(dummyTrack)`, recuperando el
transceiver con `pc.getTransceivers().find(t => t.sender === audioSender)` para no tocar el resto
del código. **Nota honesta**: no hay una explicación definitiva de POR QUÉ divergen en la
práctica pese a ser teóricamente equivalentes — documentado como "corregido con evidencia
empírica real", no "entendido a fondo del todo" (posible matiz de la implementación real de
Chromium no descrito con precisión en la spec). Si reaparece, `chrome://webrtc-internals` en una
sesión real sería el siguiente paso de profundización.

Instrumentación de diagnóstico (`DIAG audio` en consola) que hizo posible aislar esto se mantiene
en el código — útil para cualquier regresión futura del mismo tipo: log en la creación del
transceiver, en el manejo de la oferta SDP (dirección negociada + línea `m=audio` real), en
`toggleIntercom()` (getUserMedia/replaceTrack paso a paso), y sondeo de `outbound-rtp`
(`_startAudioSendDiagnostics()`) cada 3s mientras el mic está activo.

**Verificación real completada parcialmente (2026-07-11)**: el líder repitió la prueba con
Playwright contra HA real. **Negociación SDP CONFIRMADA corregida**: `currentDirection=sendrecv`
(antes `null`/desajuste) y la respuesta dice `a=sendrecv` (antes `a=recvonly`) — el fix
`addTransceiver()`→`addTrack()` funciona de verdad. **`bytesSent`/audio real NO se pudo
verificar**: el entorno de prueba accede a HA por `http://192.168.42.138:8123` (IP LAN plana, no
HTTPS) — `navigator.mediaDevices` es `undefined` ahí (`isSecureContext:false`), así que
`getUserMedia()` falla ANTES de llegar a usar nada de este fix, independientemente de si el fix
es correcto. Confirmado como limitación del sandbox de pruebas (no del producto real, que se
sirve por Nabu Casa/HTTPS o por la app). **Estado**: negociación SDP CERRADA; entrega de audio
end-to-end pendiente de un entorno con TLS real — no cerrado del todo. Yo tampoco tengo forma de
completar esta última pieza (cero acceso a navegador en esta sesión, ni siquiera Playwright).

**No hacer commit/push sin autorización explícita.** Trabaja directo en esta carpeta, sin
worktree aislado.
