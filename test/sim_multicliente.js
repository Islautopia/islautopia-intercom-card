// Simulacion aislada del estado multicliente/calidad de la card, sin navegador ni HA.
//
//   node test/sim_multicliente.js dist/islautopia-intercom-card.js
//
// Por que existe (2026-07-26): este repo no tiene ni build ni tests (decision explicita, ver
// CLAUDE.md), y toda la verificacion historica ha sido `node --check` + lectura del codigo. El
// turno de palabra tiene demasiados estados (pidiendo / concedido / denegado / revocado por el
// portero / firmware que no contesta) como para fiarse solo de leerlo: esto ejercita la maquina
// de estados REAL del fichero de dist (no una copia) contra dobles minimos de DOM. NO sustituye
// a una prueba en navegador con un portero de verdad - no toca WebRTC, ni SSE, ni el relay.
// Carga el fichero real de dist/, captura la clase via customElements.define, y ejercita
// handleNativeSignal()/toggleIntercom() contra dobles de DOM minimos.
const fs = require('fs');
const vm = require('vm');
const path = process.argv[2];
const src = fs.readFileSync(path, 'utf8');

let CardClass = null;
function fakeEl() {
  const s = new Set();
  return {
    classList: {
      toggle(c, v) { if (v === undefined) v = !s.has(c); v ? s.add(c) : s.delete(c); },
      add(c) { s.add(c); }, remove(...cs) { cs.forEach((c) => s.delete(c)); },
      contains(c) { return s.has(c); }, _set: s,
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll() { return []; },
    style: {}, textContent: '', title: '', innerHTML: '',
  };
}

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  performance: { now: () => Date.now() },
  setTimeout, clearTimeout, setInterval, clearInterval,
  HTMLElement: class {},
  WebSocket: { OPEN: 1 },
  document: { createElement: () => fakeEl(), addEventListener() {}, removeEventListener() {} },
  window: { addEventListener() {}, removeEventListener() {} },
  customElements: {
    get: () => undefined,
    define: (name, cls) => { if (name === 'islautopia-intercom-card') CardClass = cls; },
  },
};
sandbox.window.customCards = [];
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
if (!CardClass) { console.error('FALLO: no se pudo capturar la clase'); process.exit(1); }

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  OK   ${label}`);
  else { console.log(`  FALLO ${label}`); failures += 1; }
}

function newCard() {
  const c = Object.create(CardClass.prototype);
  c._hass = { language: 'es', states: {} };
  c.config = { device_id: 'abc', unlock_duration: 3 };
  c.sent = [];
  c.sendNativeSignal = (m) => c.sent.push(m);
  c._mark = () => {};
  c._flashes = [];
  c._flashStatusLine = (k) => c._flashes.push(k);
  c._resetStatusLine = () => {};
  c._updateMotionPill = () => {};
  c._setLiveState = (s) => { c._live = s; };
  c._startAudioSendDiagnostics = () => {};
  c._stopAudioSendDiagnostics = () => {};
  // _recordLifeSignal NO se sustituye: el caso 8 (vigilante de vida en audio_only) depende de su
  // comportamiento real.
  // DOM doubles
  c.intercomButton = fakeEl();
  c.intercomIcon = fakeEl();
  c.micLabel = fakeEl();
  // play() y volume forman parte del doble desde 2026-08-03: el control de sonido de §1.10
  // (_setAudioOn) llama a play() al desmutear, porque desmutear sin activacion del usuario puede
  // hacer que el navegador PAUSE el elemento en vez de lanzar un error.
  c.videoEl = { muted: true, volume: 1, play: () => Promise.resolve() };
  c.volIcon = fakeEl();
  c.sndBtn = fakeEl();
  c.audioPill = fakeEl();
  // Estos tres nacen con display:none en el HTML real de render() - reproducirlo aqui, o la
  // simulacion "encontraria" visible algo que en la card de verdad esta oculto de partida.
  c.clientsPill = fakeEl(); c.clientsPill.style.display = 'none';
  c.clientsCount = fakeEl();
  c.qualityCtl = fakeEl(); c.qualityCtl.style.display = 'none';
  c.qualityBtn = fakeEl();
  c.qualityIcon = fakeEl();
  c.qualityLabel = fakeEl();
  c.qualityMenu = fakeEl();
  // getUserMedia real no existe aqui: _startIntercom cae en su catch. Se sustituye por un doble
  // que solo marca el estado logico, que es lo que esta simulacion quiere verificar.
  c._startIntercom = async () => {
    c.intercomActive = true; c._listenOnly = false; c.videoEl.muted = false;
    c._setLiveState('open'); c._paintMicState();
  };
  // Estado inicial identico al de setConfig()
  Object.assign(c, {
    intercomActive: false, _slot: null, _talkHeld: false, _talkPending: false, _talkTimer: null,
    _talkGrantedAt: 0, _talkUnsupported: false, _listenOnly: false, _talkerSlot: -1,
    _clients: null, _quality: 'auto', _qualityEffective: null, _qualitySupported: null,
    _qualityProbeTimer: null, _qualityProbeAttempts: 0, _qualityMenuOpen: false,
    localAudioStream: null, dummyAudioTrack: { id: 'dummy' }, audioTransceiver: null, pc: {},
  });
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n== 1. Turno concedido (firmware nuevo) ==');
  let c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 1, talker: -1 });
  check('slot aprendido de session_info', c._slot === 1);
  check('contador de clientes = 2', c._clients === 2);
  check('pildora de clientes visible', c.clientsPill.style.display === 'flex');
  check('pildora resaltada con >1 cliente', c.clientsPill.classList.contains('multi'));
  await c.toggleIntercom();
  check('talk_request enviado', c.sent.some((m) => m.type === 'talk_request'));
  check('micro AUN cerrado (esperando permiso)', c.intercomActive === false);
  check('boton en estado "pidiendo"', c.intercomButton.classList.contains('requesting'));
  await c.handleNativeSignal({ type: 'talk_granted', slot: 1 });
  check('micro abierto tras talk_granted', c.intercomActive === true);
  check('turno marcado como nuestro', c._talkHeld === true);
  await c.handleNativeSignal({ type: 'talk_state', slot: 1, talker: 1 });
  check('talk_state con nuestro slot no cierra el micro', c.intercomActive === true);

  console.log('\n== 2. Turno denegado -> solo escucha ==');
  c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 0, talker: 1 });
  check('boton marcado "ocupado por otro"', c.intercomButton.classList.contains('busy-other'));
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_denied', slot: 0, reason: 'channel_busy' });
  check('micro NO abierto', c.intercomActive === false);
  check('modo solo-escucha activo', c._listenOnly === true);
  check('altavoz desmuteado (se oye al portero)', c.videoEl.muted === false);
  check('aviso claro al usuario', c._flashes.includes('talk_denied_msg'));
  check('boton NO deshabilitado', c.intercomButton.getAttribute('disabled') === undefined);
  await c.toggleIntercom();
  check('segunda pulsacion sale de solo-escucha', c._listenOnly === false);
  check('talk_release enviado al salir', c.sent.some((m) => m.type === 'talk_release'));

  console.log('\n== 3. El portero nos quita el turno (5s de silencio / otro usuario) ==');
  c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 2, talker: -1 });
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 2 });
  c._talkGrantedAt = 0; // salta la gracia anti-carrera de 1.5s
  await c.handleNativeSignal({ type: 'talk_state', slot: 2, talker: -1 });
  check('micro cerrado al perder el turno', c.intercomActive === false);
  check('queda en solo-escucha, no desconectado', c._listenOnly === true);
  check('motivo "silencio" explicado', c._flashes.includes('talk_silence'));
  c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 0, talker: -1 });
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 0 });
  c._talkGrantedAt = 0;
  await c.handleNativeSignal({ type: 'talk_state', slot: 0, talker: 3 });
  check('motivo "otro usuario" explicado', c._flashes.includes('talk_taken'));

  console.log('\n== 4. Gracia anti-carrera (talk_state viejo justo tras el granted) ==');
  c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 0, talker: -1 });
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 0 });
  await c.handleNativeSignal({ type: 'talk_state', slot: 0, talker: -1 }); // stale
  check('el micro recien abierto NO se cierra por un talk_state viejo', c.intercomActive === true);

  console.log('\n== 5. FIRMWARE ANTIGUO: nadie contesta a talk_request ==');
  c = newCard();
  c._slot = 0;
  await c.toggleIntercom();
  check('sigue esperando a los 100ms', c.intercomActive === false && c._talkPending === true);
  await wait(3200);
  check('micro abierto igualmente tras 3s', c.intercomActive === true);
  check('marcado como firmware sin turno', c._talkUnsupported === true);
  check('avisado una vez al usuario', c._flashes.includes('talk_legacy'));
  check('sin pildora de clientes (nunca llego session_info)', c.clientsPill.style.display === 'none');
  await c.toggleIntercom();
  check('apagado limpio', c.intercomActive === false);
  const sentBefore = c.sent.length;
  await c.toggleIntercom();
  check('2a pulsacion INSTANTANEA (sin nuevo talk_request)',
    c.intercomActive === true && !c.sent.slice(sentBefore).some((m) => m.type === 'talk_request'));

  console.log('\n== 6. Calidad: sonda, confirmacion y cambios automaticos ==');
  c = newCard();
  c._slot = 0;
  c._probeQualitySupport();
  check('sonda "auto" enviada al arrancar', c.sent.some((m) => m.type === 'quality' && m.mode === 'auto'));
  check('selector OCULTO hasta confirmar', c.qualityCtl.style.display === 'none');
  await c.handleNativeSignal({ type: 'quality_state', slot: 0, mode: 'auto', reason: 'user' });
  check('selector visible tras el primer quality_state', c.qualityCtl.style.display === 'block');
  check('marcado como soportado', c._qualitySupported === true);
  c._sendQuality('low');
  check('cambio manual enviado', c.sent.some((m) => m.type === 'quality' && m.mode === 'low'));
  await c.handleNativeSignal({ type: 'quality_state', slot: 0, mode: 'low', reason: 'user' });
  check('modo efectivo actualizado', c._qualityEffective === 'low');
  await c.handleNativeSignal({ type: 'quality_state', slot: 0, mode: 'low', reason: 'auto_loss' });
  check('cambio automatico explicado con su motivo', c._flashes.includes('q_auto_loss'));
  await c.handleNativeSignal({ type: 'quality_state', slot: 0, mode: 'audio_only', reason: 'auto_bandwidth' });
  check('motivo de ancho de banda explicado', c._flashes.includes('q_auto_bw'));

  console.log('\n== 7. Calidad con FIRMWARE ANTIGUO (nadie contesta) ==');
  c = newCard();
  c._slot = 0;
  c._probeQualitySupport();
  await wait(8600); // 2 intentos x 4s
  check('reintento antes de rendirse', c.sent.filter((m) => m.type === 'quality').length === 2);
  check('marcado como NO soportado', c._qualitySupported === false);
  check('selector oculto, sin boton muerto', c.qualityCtl.style.display === 'none');
  check('sin molestar al usuario con avisos', c._flashes.length === 0);

  console.log('\n== 8. Vigilante de vida en audio_only (no debe reconectar en bucle) ==');
  c = newCard();
  c._qualityEffective = 'audio_only';
  c._lastLifeSignalAt = 1;
  c._prevPacketsReceived = null;
  let audioPkts = 100;
  c.pc = { getStats: async () => [
    { type: 'inbound-rtp', kind: 'video', packetsReceived: 500 },   // congelado a proposito
    { type: 'inbound-rtp', kind: 'audio', packetsReceived: (audioPkts += 50) },
  ] };
  c.pc.getStats = async () => { const arr = [
    { type: 'inbound-rtp', kind: 'video', packetsReceived: 500 },
    { type: 'inbound-rtp', kind: 'audio', packetsReceived: (audioPkts += 50) },
  ]; return { forEach: (f) => arr.forEach(f) }; };
  let reconnects = 0;
  c._scheduleReconnect = () => { reconnects += 1; };
  await c._checkLifeWatchdog();
  await c._checkLifeWatchdog();
  check('el audio cuenta como señal de vida en audio_only', reconnects === 0);
  // Mismo modo audio_only pero con el audio TAMBIEN parado: el vigilante debe seguir haciendo su
  // trabajo (la relajacion es de que contador se mira, no de que ya no se vigile nada).
  audioPkts = 999; // congelado: (audioPkts += 50) ya no aplica porque se reasigna abajo
  c.pc.getStats = async () => { const arr = [
    { type: 'inbound-rtp', kind: 'video', packetsReceived: 500 },
    { type: 'inbound-rtp', kind: 'audio', packetsReceived: 999 },
  ]; return { forEach: (f) => arr.forEach(f) }; };
  await c._checkLifeWatchdog();                              // toma linea base
  c._lastLifeSignalAt = c._lastLifeSignalAt - 21000;         // simula 21s sin progreso
  await c._checkLifeWatchdog();
  check('en audio_only con el audio TAMBIEN parado si reconecta', reconnects > 0);

  reconnects = 0;
  c._qualityEffective = 'full';
  c._prevPacketsReceived = null;
  await c._checkLifeWatchdog();                              // toma linea base (video 500)
  c._lastLifeSignalAt = c._lastLifeSignalAt - 21000;         // simula 21s sin progreso
  await c._checkLifeWatchdog();
  check('con video congelado en modo full SI reconecta', reconnects > 0);

  console.log('\n== 9. Reset por sesion (nada se hereda de la anterior) ==');
  c = newCard();
  c._clients = 3; c._talkerSlot = 2; c._qualitySupported = true; c._quality = 'low';
  c._talkUnsupported = true; c._listenOnly = true;
  c._resetMulticlientState();
  check('contador olvidado', c._clients === null);
  check('turno olvidado', c._talkerSlot === -1 && c._listenOnly === false);
  check('calidad vuelve a auto/sin confirmar', c._quality === 'auto' && c._qualitySupported === null);
  check('se vuelve a sondear el soporte de turno', c._talkUnsupported === false);

  console.log('\n== 10. Mensajes ajenos (fan-out del relay en el camino remoto) ==');
  c = newCard();
  c._slot = 0;
  await c.handleNativeSignal({ type: 'talk_granted', slot: 1 }); // no lo hemos pedido nosotros
  check('un talk_granted NO solicitado no abre el micro', c.intercomActive === false);
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 0 });
  check('el talk_granted propio si abre el micro', c.intercomActive === true);
  const flashesBefore = c._flashes.length;
  await c.handleNativeSignal({ type: 'talk_denied', slot: 1, reason: 'channel_busy' });
  check('un talk_denied ajeno no cierra el micro', c.intercomActive === true);
  check('ni molesta con un aviso', c._flashes.length === flashesBefore);

  console.log('\n== 11. Ajustes de contrato del 2026-07-26 ==');
  c = newCard();
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 0, talker: 1 });
  await c.handleNativeSignal({ type: 'talk_state', slot: 3, talker: 1 });
  check('un talk_state ajeno NO sobrescribe nuestro slot', c._slot === 0);
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 2 }); // granted para OTRO slot
  check('talk_granted con slot ajeno no abre el micro', c.intercomActive === false);
  check('la peticion propia sigue en vuelo', c._talkPending === true);
  await c.handleNativeSignal({ type: 'talk_denied', slot: 0, reason: 'channel_busy' });
  check('solo escucha tras la denegacion', c._listenOnly === true);
  await c.handleNativeSignal({ type: 'talk_state', slot: 0, talker: -1 });
  check('avisa de que el canal quedo libre', c._flashes.includes('talk_free_retry'));
  check('pero NO reabre el micro solo', c.intercomActive === false);
  const flashesAfterHint = c._flashes.length;
  await c.handleNativeSignal({ type: 'talk_state', slot: 0, talker: -1 });
  check('no repite el aviso en cada talk_state', c._flashes.length === flashesAfterHint);

  // ============================================================================================
  // 12. RESOLUCION DE CONTRATO DEL 2026-07-26, comun a card/Android/iOS. Estos casos existen para
  //     que nadie revierta las guardias "simplificando": cada uno falla si se quita una regla.
  // ============================================================================================
  console.log('\n== 12. Validacion del destinatario del turno (regla comun a los 3 clientes) ==');

  // (a) Slot propio DESCONOCIDO y peticion PROPIA en vuelo => se ACEPTA, a conciencia.
  //
  //     ESTE CASO CAMBIO DE SIGNO el 2026-07-29 (commit "los cuatro fallos vistos en el iPhone
  //     real") y la simulacion se quedo sin actualizar hasta el 2026-08-03: las dos
  //     comprobaciones de este bloque llevaban desde entonces en rojo describiendo una regla que
  //     el codigo ya no sigue, y una suite roja de serie deja de avisar de nada.
  //
  //     Por que se relajo, con el razonamiento entero en _handleTalkGranted(): por el camino
  //     REMOTO la oferta no lleva `slot` (el relay enruta por device_id), asi que el slot propio
  //     no se conoce hasta el primer session_info. Rechazar ahi descartaba nuestro PROPIO
  //     talk_granted, se agotaban los 3s y la card acusaba de "firmware anterior" a un portero al
  //     dia - visto en un iPhone real. Y no protegia nada: al agotarse los 3s el micro se abria
  //     igual, solo que mas tarde y mintiendo.
  c = newCard();
  c._slot = null;
  await c.toggleIntercom();
  check('con peticion en vuelo pero slot propio desconocido, se ACEPTA (ver _handleTalkGranted)', c._talkPending === true);
  await c.handleNativeSignal({ type: 'talk_granted', slot: 1 });
  check('  -> el micro se abre, apoyandose en que la peticion era nuestra', c.intercomActive === true);

  // (b) La validacion NO debe ser circular: `talk_granted` no puede enseñarnos nuestro propio
  //     slot (si pudiera, msg.slot === this._slot seria cierto SIEMPRE y no validaria nada). Es
  //     el fallo que tenia la app Android (`_mySlot ??= msg.slot` dentro del propio handler).
  //     Esta regla NO se relajo, y es la que sigue sosteniendo el caso (c).
  check('  -> y talk_granted NO nos ha enseñado un slot propio', c._slot === null);
  await c.handleNativeSignal({ type: 'session_info', clients: 2, slot: 0, talker: -1 });
  check('solo session_info (u offer) fija el slot propio', c._slot === 0);

  // (c) Con el slot ya conocido, el ajeno se rechaza y el propio se acepta. Card nueva: aqui se
  //     comprueba el filtro por slot, no el arrastre de estado del caso anterior.
  c = newCard();
  c._slot = 0;
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted', slot: 1 });
  check('talk_granted ajeno rechazado con slot propio conocido', c.intercomActive === false);
  await c.handleNativeSignal({ type: 'talk_granted', slot: 0 });
  check('talk_granted propio aceptado', c.intercomActive === true);

  // (d) Asimetria deliberada: un mensaje SIN `slot` (firmware intermedio) se acepta apoyandose
  //     solo en _talkPending - rechazarlo dejaria el micro inservible contra ese firmware.
  c = newCard();
  c._slot = 0;
  await c.toggleIntercom();
  await c.handleNativeSignal({ type: 'talk_granted' }); // sin campo slot
  check('mensaje sin slot (firmware intermedio) sigue aceptandose', c.intercomActive === true);

  // ============================================================================================
  // 13. GIRO DE LA IMAGEN (API_CONTRACT.md §1.9). El fallo que motivo todo esto se vio en el
  //     aparato real: la camara va montada girada 90° a proposito y la card pintaba la imagen
  //     tumbada, porque nunca leyo el campo `rot` de session_info.
  // ============================================================================================
  console.log('\n== 13. Giro de la imagen (§1.9) ==');
  function cardConMarco() {
    const card = newCard();
    card.feedWrap = fakeEl();
    card.feedWrap.clientWidth = 400;
    card.feedWrap.clientHeight = 711;
    card.videoEl.style = {};
    card._rot = 0;
    card._rotConfirmed = false;
    card.content = fakeEl();
    return card;
  }

  c = cardConMarco();
  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 0, talker: -1, rot: 90 });
  check('rot=90 leido de session_info', c._rot === 90);
  check('  -> el marco pasa a vertical (9/16)', c.feedWrap.style.aspectRatio === '9/16');
  check('  -> el video se gira 90° en sentido horario', /rotate\(90deg\)/.test(c.videoEl.style.transform));
  // Con 90/270 hay que INTERCAMBIAR ancho y alto, o la imagen girada no cubre el hueco.
  check('  -> caja con ancho y alto intercambiados', c.videoEl.style.width === '711px' && c.videoEl.style.height === '400px');

  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 0, talker: -1, rot: 180 });
  check('rot=180 gira sin intercambiar medidas', c.videoEl.style.transform === 'rotate(180deg)' && c.videoEl.style.width === '');

  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 0, talker: -1, rot: 0 });
  check('rot=0 no gira nada', c.videoEl.style.transform === '' && c.feedWrap.style.aspectRatio === '16/9');

  // Un valor raro se ignora en vez de pintarse: pintar torcido sin que nada lo explique es peor
  // que no girar (mismo criterio que el firmware, que tampoco lo guarda).
  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 0, talker: -1, rot: 45 });
  check('un rot no admitido se ignora', c._rot === 0);

  // Firmware anterior a §1.9: sin campo `rot` no se toca nada de lo ya conocido.
  c = cardConMarco();
  c._rot = 90; c._rotConfirmed = true;
  await c.handleNativeSignal({ type: 'session_info', clients: 1, slot: 0, talker: -1 });
  check('session_info sin rot no altera el giro conocido', c._rot === 90);

  // ============================================================================================
  // 14. VER NO ES ESCUCHAR (API_CONTRACT.md §1.10)
  // ============================================================================================
  console.log('\n== 14. El altavoz del cliente arranca mudo (§1.10) ==');
  c = newCard();
  c._audioOn = false; c._audioOnBeforeMic = false; c.videoEl.muted = true;
  check('arranca mudo', c.videoEl.muted === true && c._audioOn === false);
  c._setAudioOn(true, 'usuario');
  check('el usuario abre el sonido -> suena', c.videoEl.muted === false && c._audioOn === true);
  check('  -> y el icono lo dice', c.volIcon.getAttribute('icon') === 'mdi:volume-high');
  c._setAudioOn(false, 'usuario');
  check('y puede volver a silenciarlo', c.videoEl.muted === true && c.volIcon.getAttribute('icon') === 'mdi:volume-off');

  // Escuchar y hablar son ejes independientes: al cerrar el micro, el sonido vuelve a como estaba
  // ANTES de abrirlo - si solo estabas mirando en silencio, sigues mirando en silencio.
  c = newCard();
  c._audioOn = true; c._audioOnBeforeMic = false; c.intercomActive = true; c.videoEl.muted = false;
  await c._stopIntercom();
  check('al cerrar el micro el sonido vuelve a como estaba', c._audioOn === false && c.videoEl.muted === true);

  // El timbre es el UNICO motivo por el que el sonido se enciende solo.
  c = newCard();
  c._audioOn = false; c.videoEl.muted = true;
  c.config.ring_entity = 'binary_sensor.timbre';
  c._hass.states['binary_sensor.timbre'] = { state: 'off' };
  c._updateRingState();
  check('primera lectura del timbre: no dispara nada', c._audioOn === false);
  c._hass.states['binary_sensor.timbre'] = { state: 'on' };
  c._updateRingState();
  check('alguien llama al timbre -> suena solo', c._audioOn === true && c.videoEl.muted === false);

  // Un binary_sensor que YA estaba en 'on' al abrir el dashboard no es una llamada de ahora.
  c = newCard();
  c._audioOn = false; c.videoEl.muted = true;
  c.config.ring_entity = 'binary_sensor.timbre';
  c._hass.states['binary_sensor.timbre'] = { state: 'on' };
  c._updateRingState();
  check('un timbre que ya estaba sonando al abrir no desmutea', c._audioOn === false);

  // ============================================================================================
  // 15. ABRIR LA PUERTA EXIGE CONFIRMACION (API_CONTRACT.md §1.8)
  // ============================================================================================
  console.log('\n== 15. Doble pulsacion para abrir (§1.8) ==');
  function cardConPuerta() {
    const card = newCard();
    card.unlockButton = fakeEl();
    card.unlockIcon = fakeEl();
    card.unlockLabel = fakeEl();
    card._doorArmedAt = 0;
    card._doorArmTimer = null;
    card.abierta = false;
    card.triggerNativeOpen = () => { card.abierta = true; };
    return card;
  }

  c = cardConPuerta();
  c._onDoorPress();
  check('la primera pulsacion NO abre', c.abierta === false);
  check('  -> el boton queda armado y se ve', c._doorArmedAt > 0 && c.unlockButton.classList.contains('confirming'));

  // Regla 2: un doble toque RAPIDO no vale. Un movil en el bolsillo o un dedo que rebota producen
  // exactamente eso.
  c._onDoorPress();
  check('un doble toque rapido (<300ms) NO abre', c.abierta === false);

  // Pasado el minimo, la segunda pulsacion si abre.
  c._doorArmedAt = Date.now() - 400;
  c._onDoorPress();
  check('la segunda pulsacion, ya separada, abre', c.abierta === true);
  check('  -> y el boton deja de estar armado (regla 3)', c._doorArmedAt === 0 && !c.unlockButton.classList.contains('confirming'));

  // Regla 1, la que de verdad protege: la confirmacion CADUCA. Sin esto, una pulsacion accidental
  // deja la puerta armada y la siguiente -igual de accidental- la abre.
  c = cardConPuerta();
  c._onDoorPress();
  await new Promise((r) => setTimeout(r, 3200));
  check('la confirmacion caduca sola a los ~3s', c._doorArmedAt === 0 && !c.unlockButton.classList.contains('confirming'));
  c._doorArmedAt = 0;
  c._onDoorPress();
  check('  -> y tras caducar, una pulsacion vuelve a solo armar', c.abierta === false);

  console.log(failures === 0 ? '\nTODO OK\n' : `\n${failures} COMPROBACIONES FALLIDAS\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
