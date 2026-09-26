// Simulacion aislada de la CARRERA DE REENTRADA de startWebRTC() y del reloj de inactividad,
// sin navegador ni Home Assistant ni portero.
//
//   node test/sim_carrera_reentrada.js dist/islautopia-intercom-card.js
//   node test/sim_carrera_reentrada.js --controles          <- ESTO es lo que hay que ejecutar
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
//  QUE MIDE, Y POR QUE NO SE PUEDE MEDIR LEYENDO EL CODIGO
//
//  El fallo que esto persigue (medido 2026-09-07 en la tablet del salon) es de los que NO se ven
//  leyendo: tres conexiones abiertas en 0,3 s tras un timbrazo y solo la ULTIMA cerrada. Depende
//  enteramente de en que orden se resuelven varias esperas, y ese orden no esta escrito en ningun
//  sitio del fichero. Aqui se reproduce con relojes controlados.
//
//  Se carga el fichero REAL de dist/ (no una copia) y NO se sustituye nada de lo que esta bajo
//  prueba: startWebRTC, startNativeSession, buildNativePeerConnection, tryLocalSignaling,
//  startRelaySignaling, _teardownConnectionObjects, _relevado y _armIdleWakeLockTimer se ejecutan
//  tal cual estan en el dist. Lo unico que se sustituye es la CAPA DE RED (WebSocket,
//  EventSource, fetch, RTCPeerConnection, AudioContext, el WebSocket de HA) y las hojas de UI que
//  no tienen nada que ver con esto (pintar pildoras, el estado del microfono, la puerta).
//
//  ⚠️ FASE 0 (2026-09-25): la card ya no tiene relay ni STUN/TURN. La señalizacion va SOLO por el
//  proxy de Home Assistant (EventSource sobre la URL firmada), asi que lo que se cuenta ahora son
//  EventSources y no WebSockets. El doble del EventSource entrega la oferta; la ventana de la
//  carrera la abre la espera de `get_local_signal_url` (antes: las credenciales TURN). Los casos
//  8-13 son las reglas nuevas: plazo desde la entidad, veto de llamada, live_pause -> gracia -> bye,
//  toque y timbrazo que reanudan, y ningun camino fuera de Home Assistant.
//
//  ⚠️ LO QUE ESTO NO ES: no habla con un portero, ni negocia ICE/DTLS, ni prueba que en Chromium
//  un IntersectionObserver vea lo que se espera. Un verde aqui NO es "funciona en el panel de
//  pared". Es "la maquina de estados de reentrada hace lo que dice hacer".
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
//  LOS CONTROLES, QUE SON LA MITAD SERIA DEL FICHERO (CLAUDE.md: "un instrumento sin prueba
//  negativa no es una medida floja: no es una medida")
//
//  Un banco que dijera OK siempre pasaria igual de bien. `--controles` lo desmonta por los dos
//  lados, y CADA control es del mismo tipo y en la misma forma que lo que se esta midiendo:
//
//   · CONTROL NEGATIVO -- el fichero de ANTES del arreglo (el commit 3983f68, nunca un nombre de
//     rama: ver la nota en COMMIT_PREVIO) tiene que FALLAR los casos 1 y 5. Si los pasara, este
//     banco no estaria viendo el fallo real.
//   · CONTROL POSITIVO A -- un mutante cuyo guardia NUNCA deja pasar (un `return` al entrar en
//     startWebRTC) tiene que FALLAR el caso 2. Sin este control, la forma mas facil de "arreglar"
//     una acumulacion de conexiones seria no conectar nunca, y todos los demas casos saldrian
//     verdes con la card en negro para siempre.
//   · CONTROL POSITIVO B -- un mutante con `_relevado()` siempre `false` (o sea: guardia de
//     reentrada si, contador de generacion no) tiene que FALLAR el caso 3. Esto es lo que
//     demuestra que las dos piezas hacen falta y que el caso 3 mide de verdad la segunda.
//   · CONTROL POSITIVO C -- un mutante que reproduce el fallo de antes (un toque actualiza la
//     marca sin rearmar el reloj) Y ADEMAS se salta la re-verificacion del plazo absoluto tiene
//     que FALLAR el caso 7, el de NO soltar el video mientras alguien toca. Son las dos mutaciones
//     a la vez a proposito: cada una de las dos defensas basta por si sola para tapar el fallo, y
//     con solo una de ellas mutada el caso 7 seguiria verde -- o sea que el control no distinguiria
//     nada. Que hagan falta las dos para romperlo es, de hecho, la prueba de que las dos defienden.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const pathmod = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Dobles de la capa de red. Cada uno lleva su contador: lo que se mide es CUANTOS se abren y
//  cuantos se cierran, que es exactamente la firma del fallo real ("de N se cierra una").
// ─────────────────────────────────────────────────────────────────────────────────────────────
function construirEntorno(reloj) {
  const censo = { ws: [], pc: [], es: [], iceServers: [], fetch: [] };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.cerrado = false;
      this.enviados = [];
      censo.ws.push(this);
      setTimeout(() => {
        if (this.cerrado) return;
        this.readyState = 1;
        if (this.onopen) this.onopen();
      }, reloj.wsOpenMs);
    }
    send(d) { this.enviados.push(d); }
    close() { this.cerrado = true; this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
  }
  FakeWebSocket.OPEN = 1;

  class FakePeerConnection {
    constructor(cfg) { this.cfg = cfg; this.cerrado = false; this.connectionState = 'new'; censo.pc.push(this); censo.iceServers.push(cfg && cfg.iceServers); }
    async setRemoteDescription() {}
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv' }; }
    async setLocalDescription() {}
    get remoteDescription() { return {}; }
    addTransceiver() { return { direction: 'recvonly', sender: {} }; }
    addTrack(t) { const s = { track: t, replaceTrack: async () => {} }; this._sender = s; return s; }
    getTransceivers() { return [{ sender: this._sender, direction: 'sendrecv' }]; }
    async getStats() { return new Map(); }
    close() { this.cerrado = true; }
  }

  class FakeEventSource {
    constructor(url) {
      this.url = url; this.cerrado = false; censo.es.push(this);
      // El portero asigna ranura y manda la oferta nada mas aceptar la SSE (§1.4).
      setTimeout(() => {
        if (this.cerrado || !this.onmessage) return;
        this.onmessage({ data: JSON.stringify({ type: 'offer', slot: 0, sdp: 'v=0' }) });
      }, reloj.esOfertaMs || 5);
    }
    close() { this.cerrado = true; }
  }

  class FakeAudioContext {
    constructor() { this.cerrado = false; }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [{ id: 'muda', stop() {} }] } };
    }
    close() { this.cerrado = true; }
  }

  return { censo, FakeWebSocket, FakePeerConnection, FakeEventSource, FakeAudioContext };
}

function cargarClase(src, entorno, oyentesDoc) {
  let CardClass = null;
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    HTMLElement: class {},
    WebSocket: entorno.FakeWebSocket,
    EventSource: entorno.FakeEventSource,
    RTCPeerConnection: entorno.FakePeerConnection,
    IntersectionObserver: class { observe() {} disconnect() {} },
    // La sonda de alcance del camino local: se rechaza, asi que el camino local se abandona en el
    // acto y toda la ventana de la carrera queda gobernada por `reloj.turnMs`, que es lo que se
    // quiere controlar. (En el aparato real esa ventana la abre la peticion TURN a Alemania.)
    fetch: (url) => { entorno.censo.fetch.push(url); return Promise.reject(new Error('sin red en la simulacion')); },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},                       // SIN wakeLock, como la webview del panel de pared
    document: {
      visibilityState: 'visible',
      createElement: () => ({ style: {}, setAttribute() {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } }),
      addEventListener(t, f) { (oyentesDoc[t] = oyentesDoc[t] || []).push(f); },
      removeEventListener() {},
      body: { classList: { add() {}, remove() {} } },
    },
    window: { addEventListener() {}, removeEventListener() {}, AudioContext: entorno.FakeAudioContext },
    customElements: { get: () => undefined, define: (n, c) => { if (n === 'islautopia-intercom-view') CardClass = c; } },
  };
  sandbox.window.customCards = [];
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  if (CardClass) CardClass.__doc = sandbox.document;   // los casos de visibilidad cambian visibilityState
  return CardClass;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Una card viva sin pasar por setConfig()/render(): mismo estado inicial, sin DOM.
//  Se sustituyen SOLO hojas de UI. Nada de la maquinaria de conexion.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function nuevaCard(CardClass, opciones) {
  const c = Object.create(CardClass.prototype);
  const o = opciones || {};
  c.config = { device_id: 'abc' };
  c._hass = {
    connection: {
      sendMessagePromise: (msg) => {
        if (msg.type === 'islautopia_doorbell/get_connection_info') {
          // Fase 0: sin credencial ni relay; las entidades que la card lee.
          const info = { device_id: 'abc', live_timeout_entity: o.plazoEntidad === undefined ? null : 'number.x_live_view_timeout', events_entity: 'event.x_events' };
          // El codigo de ANTES (control negativo) leia estos dos: se le dan para que siga su camino.
          info.relay_ws_url = 'wss://relay/ws'; info.credential = 'X';
          return new Promise((r) => setTimeout(() => r(info), o.infoMs || 0));
        }
        // La ventana de la carrera: antes la abria la peticion TURN, hoy la de la URL firmada.
        if (msg.type === 'islautopia_doorbell/get_turn_credentials' || msg.type === 'islautopia_doorbell/get_local_signal_url') {
          if (o.turnColgado) return new Promise(() => {});   // no resuelve NUNCA: caso del fusible
          const r0 = msg.type === 'islautopia_doorbell/get_turn_credentials' ? { urls: [] } : { signal_url: '/api/islautopia_doorbell/signal/abc?authSig=x' };
          return new Promise((r) => setTimeout(() => r(r0), o.turnMs || 0));
        }
        return Promise.reject(new Error('desconocido'));
      },
    },
    states: o.estados || {},
    callApi: (metodo, ruta, cuerpo) => { c._enviados.push(cuerpo); return Promise.resolve({}); },
  };
  c._enviados = [];
  if (o.plazoEntidad !== undefined) c._hass.states['number.x_live_view_timeout'] = { state: String(o.plazoEntidad) };
  Object.assign(c, {
    pc: null, nativeSSE: null, nativeWS: null, _slot: null,
    _connGen: 0, _arranqueEnVueloGen: null, _arranqueEnVueloAt: 0,
    _watchdogTimer: null, _reconnectTimer: null, _reconnectAttempt: 0, _reconnecting: false,
    _lastLifeSignalAt: null, _prevPacketsReceived: null,
    _idleReleaseMs: o.idleMs === undefined ? 0 : o.idleMs,
    _idleWakeLockTimer: null, _wakeLock: null, _fsActive: false,
    _pausa: null, _pausaGraciaTimer: null, _idleGraceMs: o.graciaMs === undefined ? 15000 : o.graciaMs,
    _livePauseWanted: false, _livePauseAck: null, _rescateTimers: [],
    _talkHeld: false, _talkPending: false,
    intercomActive: false, localAudioStream: null, dummyAudioTrack: null,
    _audioOn: false, _audioOnBeforeMic: false, _listenOnly: false,
    isConnected: true, content: true,
  });
  // Hojas de UI: nada de esto participa en la carrera ni en el reloj.
  c._mark = () => {};
  c._flashStatusLine = () => {};
  c._resetStatusLine = () => {};
  c._setLiveState = () => {};
  c._paintMicState = () => {};
  c._updateMotionPill = () => {};
  c._resetMulticlientState = () => {};
  c._disarmDoorConfirm = () => {};
  c._limpiarEsperaDePuerta = () => {};
  c._setAudioOn = () => {};
  c._stopAudioSendDiagnostics = () => {};
  c._startRetryCountdown = () => {};
  c._stopRetryCountdown = () => {};
  c._reportPairingRejected = () => {};
  c._probeQualitySupport = () => {};
  c._setDoorLabel = () => {};
  c._acquireWakeLock = async () => {};        // no hay navigator.wakeLock, igual que en la tablet
  c._releaseWakeLock = () => {};
  // _registerIdleActivityListeners NO se sustituye: el caso 7 depende de que exista el manejador
  // real de interaccion, que es el camino por donde entraba el fallo. Solo se le da un doble al
  // addEventListener del propio elemento.
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c._registerUnloadHandler = () => {};
  c._sueltas = [];
  return c;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Recoge una card al final de un caso SIN suponer que existen las funciones nuevas: los controles
// ejecutan tambien el codigo de antes, y ahi un metodo que falta debe verse como un caso en rojo,
// no tumbar el banco.
function limpiar(c) {
  for (const f of ['_cancelarPausa', '_teardownConnectionObjects', '_clearIdleWakeLockTimer']) {
    if (typeof c[f] === 'function') { try { c[f](); } catch (err) { /* recogida */ } }
  }
}

// El codigo de ANTES (control negativo) atiende ofertas de sesiones ya relevadas sobre un `pc` nulo
// y rechaza promesas que nadie espera. Eso es parte del fallo que el control debe VER por su efecto
// (conexiones acumuladas), no un motivo para que el banco entero se caiga sin informar.
let rechazosSinAtender = 0;
process.on('unhandledRejection', (e) => { rechazosSinAtender += 1; if (process.env.SIM_DEBUG) console.error('RECHAZO', e); });

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Los casos
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function ejecutar(src, mostrar) {
  const fallos = [];
  const oyentesDoc = {};
  const entorno = construirEntorno({ wsOpenMs: 5 });
  const CardClass = cargarClase(src, entorno, oyentesDoc);
  if (!CardClass) return { fallos: ['no se pudo capturar la clase'], total: 0 };

  let total = 0;
  const comp = (etiqueta, cond) => {
    total += 1;
    if (!cond) fallos.push(etiqueta);
    if (mostrar) console.log(`  ${cond ? 'OK   ' : 'FALLO'} ${etiqueta}`);
  };
  const seccion = (t) => { if (mostrar) console.log(`\n== ${t} ==`); };

  const vivos = (lista) => lista.filter((x) => !x.cerrado).length;

  // ── 1. EL FALLO MEDIDO ─────────────────────────────────────────────────────────────────────
  // Tres disparos en 0,3 s (timbrazo: visibilitychange + render + connectedCallback) con la
  // peticion TURN tardando 400 ms. Antes del arreglo: 3 WebSockets abiertos, 1 cerrado.
  seccion('1. Tres arranques en 0,3s tras un timbrazo (el fallo medido)');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 400 });
    c.startWebRTC('visibilitychange');
    await esperar(140);
    c.startWebRTC('render');
    await esperar(160);
    c.startWebRTC('connectedCallback');
    await esperar(900);
    comp(`EventSources VIVOS = 1 (abiertos ${e.censo.es.length}, vivos ${vivos(e.censo.es)})`, vivos(e.censo.es) === 1);
    comp(`RTCPeerConnection VIVAS = 1 (creadas ${e.censo.pc.length}, vivas ${vivos(e.censo.pc)})`, vivos(e.censo.pc) === 1);
    comp('  -> y el que queda vivo es el que la card tiene en this.nativeSSE', c.nativeSSE && !c.nativeSSE.cerrado);
    c._teardownConnectionObjects();
  }

  // ── 2. CONTROL DE NO BLOQUEAR: un arranque solo TIENE que conectar ─────────────────────────
  // Sin esto, "no se acumulan conexiones" lo cumpliria tambien una card que no conecta nunca.
  seccion('2. Un arranque normal SI conecta (control de no bloquear)');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 20 });
    await c.startWebRTC('unico');
    await esperar(200);
    comp('hay sesion viva: pc asignada y sin cerrar', !!c.pc && !c.pc.cerrado);
    comp('hay EventSource por el proxy de Home Assistant, abierto', !!c.nativeSSE && !c.nativeSSE.cerrado && c.nativeSSE.url.startsWith('/api/islautopia_doorbell/signal/'));
    comp('  -> y se contesto a la oferta por el proxy', c._slot === 0 && c._enviados.some((m) => m.type === 'answer' && m.slot === 0));
    c._teardownConnectionObjects();
  }

  // ── 3. RELEVO DURANTE UNA ESPERA (esto es lo que mide el contador de generacion) ───────────
  // El guardia de reentrada NO cubre este caso: aqui el arranque viejo ha sido desmontado por
  // debajo (lo que hace _scheduleReconnect), asi que el nuevo pasa con razon. Lo que impide la
  // fuga es que el viejo, al despertar, se de cuenta y cierre lo suyo.
  seccion('3. Desmontaje mientras un arranque espera (contador de generacion)');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 400 });
    c.startWebRTC('el que sera relevado');
    await esperar(120);
    c._teardownConnectionObjects();          // exactamente lo que hace _scheduleReconnect()
    c.startWebRTC('el relevo');
    await esperar(900);
    comp(`EventSources VIVOS = 1 (abiertos ${e.censo.es.length}, vivos ${vivos(e.censo.es)})`, vivos(e.censo.es) === 1);
    comp(`RTCPeerConnection VIVAS = 1 (creadas ${e.censo.pc.length}, vivas ${vivos(e.censo.pc)})`, vivos(e.censo.pc) === 1);
    comp('  -> el relevo SI quedo conectado (no se le comio el guardia)', !!c.nativeSSE && !c.nativeSSE.cerrado);
    c._teardownConnectionObjects();
  }

  // ── 4. FUSIBLE: un arranque colgado no puede dejar la card en negro para siempre ───────────
  seccion('4. Un arranque colgado se releva por fusible, no bloquea para siempre');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const opciones = { turnColgado: true };
    const c = nuevaCard(C, opciones);
    c.startWebRTC('el que se cuelga');
    await esperar(50);
    comp('mientras es joven, un segundo disparo se descarta', c._arranqueEnVueloGen !== null);
    c.startWebRTC('demasiado pronto');
    await esperar(50);
    comp('  -> y no ha abierto ninguna conexion de mas', e.censo.es.length === 0);
    // Se envejece el marcador en vez de esperar 12 s de reloj real: lo que se prueba es la regla
    // del fusible, no la puntualidad de setTimeout.
    c._arranqueEnVueloAt = Date.now() - 60000;
    // Y la red vuelve: si el relevo tambien se colgara, esta comprobacion no podria pasar NUNCA y
    // seria un caso imposible disfrazado de prueba -- de los que se leen como un fallo del producto.
    opciones.turnColgado = false;
    c.startWebRTC('tras el fusible');
    await esperar(200);
    comp('pasado el fusible, un disparo nuevo SI arranca', !!c.nativeSSE && !c.nativeSSE.cerrado);
    c._teardownConnectionObjects();
  }

  // ── 5. EL RELOJ DE INACTIVIDAD EXISTE SIN wakeLock ────────────────────────────────────────
  // `navigator` del sandbox NO tiene `wakeLock`, y la card nunca entra en pantalla completa:
  // exactamente el panel de pared donde v1.5.0/v1.5.1/v1.6.0 fallaron las tres.
  seccion('5. El reloj de inactividad se arma sin wake lock y sin pantalla completa');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 300 });
    await c.startWebRTC('unico');
    await esperar(100);
    comp('hay cuenta atras armada con la sesion en marcha', !!c._idleWakeLockTimer);
    c._teardownConnectionObjects();
    if (c._idleWakeLockTimer) clearTimeout(c._idleWakeLockTimer);
  }

  // ── 6. Y DISPARA: sin tocar nada, suelta el video ─────────────────────────────────────────
  seccion('6. Sin interaccion, el plazo vence y suelta el video');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 250, graciaMs: 50 });
    await c.startWebRTC('unico');
    await esperar(600);
    comp('la sesion se ha soltado sola', c.pc === null);
    comp('  -> el EventSource esta cerrado', e.censo.es.every((w) => w.cerrado));
    comp('  -> y queda en pausa colgada, esperando a alguien', !!c._pausa && c._pausa.fase === 'colgada');
  }

  // ── 7. CONTROL DE NO DISPARAR: tocando, NO puede soltar nunca ─────────────────────────────
  // Es el control que mas importa de los dos del reloj: cortarle el video a quien esta mirando
  // es peor fallo que dejar la pantalla encendida de mas.
  seccion('7. Con toques periodicos NO suelta jamas (control de no disparar)');
  {
    const e = construirEntorno({ wsOpenMs: 5 });
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 250 });
    await c.startWebRTC('unico');
    comp('el manejador real de interaccion esta registrado', typeof c._onIdleActivity === 'function');
    // Un dedo cada 100 ms con un plazo de 250, POR EL CAMINO REAL: se dispara el mismo
    // `_onIdleActivity` que registra la card, no `_armIdleWakeLockTimer` a mano. La diferencia no
    // es cosmetica -- es justo donde vivia el fallo (un toque actualizaba la marca sin rearmar), y
    // llamando al temporizador directamente el caso no tendria nada que detectar.
    // Si no hay manejador (el codigo de antes del arreglo no lo registra nunca) se salta el bucle:
    // el caso ya lo ha marcado como fallo arriba, y reventar aqui se llevaria por delante el resto
    // del banco -- un instrumento que se cae no informa, y en un control eso se lee como que no rompe.
    for (let i = 0; c._onIdleActivity && i < 12; i += 1) {
      await esperar(100);
      c._onIdleActivity();
    }
    // ⚠️ SE CUENTAN LAS SESIONES ABIERTAS, NO SE MIRA EL ESTADO FINAL, y la diferencia es todo el
    // caso. La primera version comprobaba `!!c.pc` al terminar, y eso lo pasaba tambien una card
    // que suelta el video a mitad y lo repone en el toque siguiente: `pc` vuelve a existir, la
    // comprobacion sale verde, y el usuario ha visto un recuadro negro igual. Contando cuantas
    // sesiones se han llegado a construir, "se solto y volvio" ya no se puede disfrazar de "nunca
    // se solto". (Encontrado precisamente porque el mutante de mas abajo pasaba este caso.)
    comp(`tras 1,2s de toques con plazo de 0,25s NO se solto ni una vez (sesiones construidas: ${e.censo.pc.length})`, e.censo.pc.length === 1 && e.censo.es.length === 1);
    comp('  -> la sesion sigue viva', !!c.pc && !c.pc.cerrado);
    comp('  -> y no se marco como soltada', !c._pausa);
    // Fase 0: vencer ya no cuelga en el acto (live_pause + gracia), asi que "se pauso y el toque
    // siguiente la reanudo" no deja rastro en pc/sesiones. Lo deja en lo que se mando al portero.
    comp('  -> y no se mando ni un live_pause', !(c._enviados || []).some((m) => m.type === 'live_pause'));
    c._teardownConnectionObjects();
    if (c._idleWakeLockTimer) clearTimeout(c._idleWakeLockTimer);
  }

  // ══ FASE 0 ════════════════════════════════════════════════════════════════════════════════
  // ── 8. El plazo lo manda la entidad de la integracion ─────────────────────────────────────
  seccion('8. El plazo sale de number.*_live_view_timeout (y 0 lo desactiva)');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 999000, plazoEntidad: 0.25, graciaMs: 20000 });
    await c.startWebRTC('unico');
    await esperar(500);
    comp('con la entidad a 0,25 s vence aunque el respaldo sea 999 s', !!c._pausa && c._pausa.fase === 'gracia');
    limpiar(c);
    const c2 = nuevaCard(C, { turnMs: 10, idleMs: 250, plazoEntidad: 0 });
    await c2.startWebRTC('unico');
    await esperar(500);
    comp('  -> y con la entidad a 0 no vence nunca', !c2._pausa && !!c2.pc);
    limpiar(c2);
  }

  // ── 9. Nunca con una llamada en curso ─────────────────────────────────────────────────────
  seccion('9. Con el micro abierto NO vence (§1.4-bis: never pause during a call)');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 250, graciaMs: 50 });
    await c.startWebRTC('unico');
    c.intercomActive = true;
    await esperar(800);
    comp('con el micro abierto 0,8 s y plazo de 0,25 s: ni pausa ni bye', !c._pausa && !!c.pc && !c.pc.cerrado);
    comp('  -> y no se mando live_pause', !c._enviados.some((m) => m.type === 'live_pause'));
    c.intercomActive = false;
    limpiar(c);
  }

  // ── 10. Al vencer: live_pause YA, bye tras la gracia (la ranura se libera) ─────────────────
  seccion('10. Vence: live_pause en el acto y bye tras la gracia');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 200, graciaMs: 300 });
    await c.startWebRTC('unico');
    const pc = c.pc;
    await esperar(350);
    comp('dentro de la gracia: live_pause enviado y la sesion sigue viva', c._enviados.some((m) => m.type === 'live_pause' && m.slot === 0) && c.pc === pc && !pc.cerrado);
    comp('  -> todavia sin bye', !c._enviados.some((m) => m.type === 'bye'));
    await esperar(400);
    comp('pasada la gracia: bye enviado (la ranura se libera ya, no a los 20 s)', c._enviados.some((m) => m.type === 'bye' && m.slot === 0));
    comp('  -> sesion cerrada y EventSource cerrado', c.pc === null && e.censo.es.every((x) => x.cerrado));
    comp('  -> y la card queda en pausa, esperando un toque', !!c._pausa && c._pausa.fase === 'colgada');
  }

  // ── 11. Un toque dentro de la gracia reanuda la MISMA sesion ──────────────────────────────
  seccion('11. Toque dentro de la gracia: live_resume, sin sesion nueva');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 200, graciaMs: 2000 });
    await c.startWebRTC('unico');
    await esperar(350);
    comp('esta en gracia', !!c._pausa && c._pausa.fase === 'gracia');
    if (c._onIdleActivity) c._onIdleActivity();
    await esperar(50);
    comp('tras el toque: live_resume enviado', c._enviados.some((m) => m.type === 'live_resume'));
    comp('  -> la misma sesion, ninguna nueva', e.censo.pc.length === 1 && !!c.pc && !c.pc.cerrado);
    comp('  -> y sin bye', !c._enviados.some((m) => m.type === 'bye'));
    limpiar(c);
  }

  // ── 12. Un timbrazo despierta la card colgada; un paquete no ───────────────────────────────
  seccion('12. Timbrazo (event_type ring) tras colgar: sesion nueva; un paquete no');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 150, graciaMs: 50 });
    c.config.ring_entity = undefined;
    c._hass.states['event.x_events'] = { state: 't0', attributes: { event_type: 'ring' } };
    await c.startWebRTC('unico');
    c._updateRingState();                       // primera lectura: no dispara
    await esperar(500);
    comp('colgada por inactividad', !!c._pausa && c._pausa.fase === 'colgada' && c.pc === null);
    c._hass.states['event.x_events'] = { state: 't1', attributes: { event_type: 'package' } };
    c._updateRingState();
    await esperar(100);
    comp('un paquete NO la despierta', !!c._pausa && c._pausa.fase === 'colgada' && e.censo.pc.length === 1);
    c._hass.states['event.x_events'] = { state: 't2', attributes: { event_type: 'ring' } };
    c._updateRingState();
    await esperar(60);
    comp('un timbrazo SI: sesion nueva', !c._pausa && e.censo.pc.length === 2 && !!c.pc);
    limpiar(c);
  }

  // ── 13. Ningun camino fuera de Home Assistant ─────────────────────────────────────────────
  seccion('13. Sin STUN/TURN, sin relay, sin fetch al portero: solo Home Assistant');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10 });
    await c.startWebRTC('unico');
    await esperar(100);
    comp('RTCPeerConnection sin iceServers', e.censo.iceServers.length === 1 && Array.isArray(e.censo.iceServers[0]) && e.censo.iceServers[0].length === 0);
    comp('  -> ningun WebSocket', e.censo.ws.length === 0);
    comp('  -> ningun fetch directo', e.censo.fetch.length === 0);
    comp('  -> y la SSE es la del proxy de HA', e.censo.es.every((x) => x.url.startsWith('/api/islautopia_doorbell/')));
    limpiar(c);
  }

  // ══ REGLA DE IÑAKI 2026-09-25: FUERA DE LA VISTA, PAUSA; AL VOLVER, EN EL MISMO ESTADO ══════
  const ocultar = (C, c, v) => { C.__doc.visibilityState = v; c._onVisibilityForStream && c._onVisibilityForStream(); };

  // ── 14. Ocultarse: live_pause YA, sesion viva; volver: live_resume, la misma sesion ─────────
  seccion('14. Oculta -> live_pause inmediato; visible -> live_resume en la misma sesion');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 999000, graciaMs: 5000 });
    c._registerVisibilityStreamHandler && c._registerVisibilityStreamHandler();
    await c.startWebRTC('unico');
    await esperar(80);
    const pc = c.pc;
    ocultar(C, c, 'hidden');
    await esperar(30);
    comp('al ocultarse: live_pause enviado en el acto y la sesion sigue', c._enviados.some((m) => m.type === 'live_pause') && c.pc === pc && !pc.cerrado);
    comp('  -> sin bye todavia', !c._enviados.some((m) => m.type === 'bye'));
    ocultar(C, c, 'visible');
    await esperar(30);
    comp('al volver: live_resume, misma sesion, ninguna nueva', c._enviados.some((m) => m.type === 'live_resume') && c.pc === pc && e.censo.pc.length === 1);
    limpiar(c); C.__doc.visibilityState = 'visible';
  }

  // ── 15. Oculta CON llamada: pausa, pero nunca cuelga; al volver se pide otra vez el turno ───
  seccion('15. Oculta con el micro abierto: live_pause, sin bye; al volver, talk_request');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 999000, graciaMs: 100 });
    c._registerVisibilityStreamHandler && c._registerVisibilityStreamHandler();
    c._stopIntercom = function () { this.intercomActive = false; this._talkHeld = false; };
    c._requestTalkTurn = function () { this.sendNativeSignal({ type: 'talk_request' }); };
    await c.startWebRTC('unico');
    await esperar(80);
    c.intercomActive = true; c._talkHeld = true;
    ocultar(C, c, 'hidden');
    await esperar(400);
    comp('con llamada: live_pause y SIN bye pasada la gracia', c._enviados.some((m) => m.type === 'live_pause') && !c._enviados.some((m) => m.type === 'bye') && !!c.pc);
    ocultar(C, c, 'visible');
    await esperar(30);
    comp('  -> al volver: live_resume y se vuelve a pedir el turno (mismo estado)', c._enviados.some((m) => m.type === 'live_resume') && c._enviados.some((m) => m.type === 'talk_request'));
    limpiar(c); C.__doc.visibilityState = 'visible';
  }

  // ── 16. Oculta sin llamada: tras la gracia, bye (la ranura se libera) ───────────────────────
  seccion('16. Oculta sin llamada: bye tras la gracia');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 999000, graciaMs: 100 });
    c._registerVisibilityStreamHandler && c._registerVisibilityStreamHandler();
    await c.startWebRTC('unico');
    await esperar(80);
    ocultar(C, c, 'hidden');
    await esperar(300);
    comp('sin llamada: bye pasada la gracia', c._enviados.some((m) => m.type === 'bye') && c.pc === null);
    ocultar(C, c, 'visible');
    await esperar(80);
    comp('  -> y al volver, sesion nueva', e.censo.pc.length === 2 && !!c.pc && !c._pausa);
    limpiar(c); C.__doc.visibilityState = 'visible';
  }

  // ── 17. El bucle medido en la tablet: reinsertar la card en pausa NO abre sesion ───────────
  seccion('17. connectedCallback de un portero en pausa por inactividad: no arranca');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 150, graciaMs: 50 });
    await c.startWebRTC('unico');
    await esperar(400);
    comp('colgada por inactividad', !!c._pausa && c._pausa.fase === 'colgada');
    const antes = e.censo.pc.length;
    const c2 = nuevaCard(C, { turnMs: 10, idleMs: 150, graciaMs: 50 });   // Home Assistant recrea el elemento
    c2._registerFullscreenListeners = () => {}; c2._registerVisibilityStreamHandler = () => {}; c2._registerOffscreenStreamHandler = () => {};
    c2.connectedCallback();
    c.connectedCallback && (c._registerFullscreenListeners = () => {}, c._registerVisibilityStreamHandler = () => {}, c._registerOffscreenStreamHandler = () => {}, c.connectedCallback());
    await esperar(200);
    comp('ni la card reinsertada ni una recreada abren sesion', e.censo.pc.length === antes && !!c2._pausa);
    limpiar(c); limpiar(c2);
  }

  // ── 18. Un timbrazo reciente despierta a una card recien creada (su "primera lectura") ─────
  seccion('18. Timbrazo de hace 5 s en la primera lectura de una card en pausa: la despierta');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 150, graciaMs: 50 });
    await c.startWebRTC('unico');
    await esperar(400);
    const c2 = nuevaCard(C, { turnMs: 10, idleMs: 150, graciaMs: 50 });
    c2._connInfo = { events_entity: 'event.x_events' };
    c2._hass.states['event.x_events'] = { state: new Date(Date.now() - 5000).toISOString(), attributes: { event_type: 'ring' } };
    c2._restaurarPausaGuardada && c2._restaurarPausaGuardada();
    const antes = e.censo.pc.length;
    c2._updateRingState();
    await esperar(60);
    comp('card nueva en pausa + timbrazo reciente: sesion nueva', e.censo.pc.length === antes + 1 && !c2._pausa);
    limpiar(c); limpiar(c2);
  }

  // ── 19. Cambiar de vista de Lovelace saca la card del DOM: pausa, y al volver el MISMO elemento
  seccion('19. disconnectedCallback -> live_pause (no bye); connectedCallback -> live_resume, misma sesion');
  {
    const e = construirEntorno({});
    const C = cargarClase(src, e, {});
    const c = nuevaCard(C, { turnMs: 10, idleMs: 999000, graciaMs: 5000 });
    c._registerFullscreenListeners = () => {};
    await c.startWebRTC('unico');
    await esperar(80);
    const pc = c.pc;
    c.disconnectedCallback();
    await esperar(30);
    comp('sacada del DOM: live_pause y la sesion sigue (sin bye)', c._enviados.some((m) => m.type === 'live_pause') && !c._enviados.some((m) => m.type === 'bye') && c.pc === pc);
    c.connectedCallback();
    await esperar(30);
    comp('  -> reinsertada: live_resume en la misma sesion', c._enviados.some((m) => m.type === 'live_resume') && c.pc === pc && e.censo.pc.length === 1);
    limpiar(c);
  }

  return { fallos, total };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Sustitucion con guarda: el ancla aparece exactamente una vez o se ABORTA (CLAUDE.md).
//  Sin esto, un mutante cuyo ancla no casa saldria identico al original -- y entonces el control
//  positivo diria "el mutante falla igual que el bueno... o sea que pasa", en silencio.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// El dist se guarda con finales de linea de Windows y `git show` los entrega con finales Unix. Sin
// esto, cualquier ancla que abarque mas de una linea no casa JAMAS contra el fichero de disco -- y
// lo unico que impidio que eso pasara inadvertido fue la guarda de `mutar()`: sin ella, un mutante
// cuyo ancla no casa sale IDENTICO al original, o sea un control positivo que no controla nada y
// que ademas dice OK.
const normalizarFinales = (t) => t.split('\r\n').join('\n');

function mutar(src, ancla, reemplazo, nombre) {
  const n = src.split(ancla).length - 1;
  if (n !== 1) throw new Error(`mutante "${nombre}": el ancla aparece ${n} veces, no 1 - ABORTADO`);
  return src.replace(ancla, reemplazo);
}

(async () => {
  const arg = process.argv[2];
  const rutaDist = pathmod.join(__dirname, '..', 'dist', 'islautopia-intercom-card.js');

  if (arg && arg !== '--controles') {
    const r = await ejecutar(fs.readFileSync(arg, 'utf8'), true);
    console.log(r.fallos.length === 0 ? `\nTODO OK (${r.total} comprobaciones)\n` : `\n${r.fallos.length} COMPROBACIONES FALLIDAS\n`);
    process.exit(r.fallos.length === 0 ? 0 : 1);
  }

  // ⚠️ CRLF -> LF AL LEER. El dist se guarda con finales de linea de Windows y `git show` los
  // entrega con finales Unix. Sin normalizar, las anclas de los mutantes que abarcan mas de una
  // linea no casan JAMAS -- y `mutar()` aborta a gritos, que es lo que paso la primera vez. Sin la
  // guarda de `mutar()` habrian pasado como mutantes... identicos al original, o sea controles
  // positivos que no controlan nada.
  const src = normalizarFinales(fs.readFileSync(rutaDist, 'utf8'));
  let mal = 0;

  console.log('\n############ EL FICHERO DE VERDAD ############');
  const bueno = await ejecutar(src, true);
  if (bueno.fallos.length) { console.log(`\n${bueno.fallos.length} FALLOS en el dist actual`); mal += 1; }
  else console.log(`\nTODO OK (${bueno.total} comprobaciones)`);

  console.log('\n############ CONTROLES ############');

  // ── CONTROL NEGATIVO: el fichero de antes del arreglo tiene que FALLAR ────────────────────
  // ⚠️ UN COMMIT, NUNCA UN NOMBRE DE RAMA -- y esto ya se cobro una vez (2026-09-07). La primera
  // version decia `main:dist/...`, y el arbol de trabajo de este repo lo comparten varios agentes:
  // mientras se escribia el arreglo, otro cambio de rama hizo que el commit del arreglo acabara EN
  // main. El control negativo comparo entonces el fichero arreglado consigo mismo, salio verde, y
  // dijo "el codigo de antes no acumulaba conexiones" -- justo el veredicto contrario al medido.
  // Un control validado contra una referencia movil no valida nada. 3983f68 es el ultimo commit
  // ANTES de este arreglo y no se va a mover jamas.
  const COMMIT_PREVIO = '3983f68';
  let previo = null;
  try {
    previo = execFileSync('git', ['show', `${COMMIT_PREVIO}:dist/islautopia-intercom-card.js`],
      { cwd: pathmod.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    console.log(`  AVISO: no se pudo sacar ${COMMIT_PREVIO}:dist/... de git - el control NEGATIVO no se ha ejecutado.`);
    console.log('         Sin el, este banco NO esta validado: podria estar diciendo OK sin mirar nada.');
    mal += 1;
  }
  if (previo) {
    // Una excepcion es un fallo, nunca un aprobado por incomparecencia.
    let r;
    try { r = await ejecutar(previo, false); } catch (err) { r = { fallos: ['excepcion: ' + err.message], total: 0 }; }
    const veLaFuga = r.fallos.some((f) => f.startsWith('EventSources VIVOS'));
    const veElReloj = r.fallos.some((f) => f.startsWith('hay cuenta atras armada'));
    console.log(`  ${veLaFuga ? 'OK   ' : 'FALLO'} control negativo: el codigo de antes del arreglo ACUMULA conexiones (caso 1)`);
    console.log(`  ${veElReloj ? 'OK   ' : 'FALLO'} control negativo: el codigo de antes del arreglo NO arma el reloj (caso 5)`);
    if (!veLaFuga || !veElReloj) {
      console.log(`         fallos observados en el codigo viejo: ${JSON.stringify(r.fallos)}`);
      mal += 1;
    }
  }

  // ── CONTROLES POSITIVOS: cada mutante tiene que romper EXACTAMENTE su caso ────────────────
  const mutantes = [
    {
      nombre: 'el guardia nunca deja pasar (card en negro para siempre)',
      src: () => mutar(src,
        "    const enVuelo = this._arranqueEnVueloGen;",
        "    return; const enVuelo = this._arranqueEnVueloGen;",
        'guardia total'),
      debeFallar: 'hay sesion viva',
    },
    {
      nombre: 'contador de generacion desactivado (_relevado siempre false)',
      src: () => mutar(src,
        '  _relevado(gen) { return gen !== this._connGen; }',
        '  _relevado(gen) { return false; }',
        'sin generacion'),
      debeFallar: 'EventSources VIVOS',
    },
    {
      nombre: 'el toque no rearma (fallo de antes) Y sin re-verificacion del plazo',
      src: () => {
        // ⚠️ ANCLA DE UNA SOLA LINEA Y SIN NI UNA BARRA INVERTIDA, y no es estilo: la primera
        // version de este mutante llevaba un salto de linea escapado dentro del ancla, y ese
        // escape se colapso en un salto real al cruzar una capa de shell -- exactamente la
        // landmine que CLAUDE.md ya tenia escrita. Rompio el fichero de forma visible, que es la
        // suerte; el modo de fallo peligroso es el silencioso, un ancla que deja de casar y una
        // sustitucion que no hace nada sin decirlo. De ahi la guarda de `mutar()`.
        let m = mutar(src,
          '      this._armIdleWakeLockTimer(true);',
          '      /* mutante: el toque actualiza la marca pero NO rearma, como antes del arreglo */',
          'toque que no rearma');
        return mutar(m,
          '      if (pendiente > 0) {',
          '      if (false) {',
          'sin re-verificacion');
      },
      // Fase 0: vencer ya no suelta en el acto, pausa (live_pause) y el toque siguiente reanuda;
      // el caso 7 lo ve en lo mandado al portero.
      debeFallar: '  -> y no se mando ni un live_pause',
    },
    {
      nombre: 'fase 0: el plazo ignora la entidad',
      src: () => mutar(src, "    if (Number.isFinite(v) && v >= 0) return v * 1000;", "    if (false) return v * 1000;", 'sin entidad'),
      debeFallar: 'con la entidad a 0,25 s',
    },
    {
      nombre: 'fase 0: sin veto de llamada',
      src: () => mutar(src, "    return !!(this.intercomActive || this._talkHeld || this._talkPending);", "    return false;", 'sin veto'),
      debeFallar: 'con el micro abierto',
    },
    {
      nombre: 'fase 0: al vencer se cuelga sin live_pause ni gracia',
      src: () => mutar(src, "    if (!llamada) this._pausaGraciaTimer = setTimeout(() => this._colgarPausa(), this._idleGraceMs);", "    if (!llamada) { this._colgarPausa(); return; }", 'sin gracia'),
      debeFallar: 'dentro de la gracia',
    },
    {
      nombre: 'fase 0: la gracia nunca cuelga (la ranura no se libera)',
      src: () => mutar(src, "    this._teardownConnectionObjects();    // manda `bye`", "    // mutante", 'sin bye'),
      debeFallar: 'pasada la gracia',
    },
    {
      nombre: 'fase 0: el timbrazo no despierta',
      src: () => mutar(src, "    if (this._pausa && document.visibilityState === 'visible') this._reanudar('timbre');", "", 'sin timbre'),
      debeFallar: 'un timbrazo SI',
    },
    {
      nombre: 'fase 0: vuelve el STUN del VPS',
      src: () => mutar(src, "    const iceServers = [];", "    const iceServers = [{ urls: 'stun:46.225.57.138:3478' }];", 'con stun'),
      debeFallar: 'RTCPeerConnection sin iceServers',
    },
    {
      nombre: 'regla de Iñaki: ocultarse vuelve a desmontar en el acto (1.9.0)',
      src: () => mutar(src, "      if (document.visibilityState === 'hidden') {", "      if (document.visibilityState === 'hidden') { this._teardownConnectionObjects(); return;", 'desmonta al ocultar'),
      debeFallar: 'al ocultarse: live_pause enviado',
    },
    {
      nombre: 'regla de Iñaki: con llamada tambien se cuelga',
      src: () => mutar(src, "    if (!llamada) this._pausaGraciaTimer = setTimeout(", "    if (true) this._pausaGraciaTimer = setTimeout(", 'cuelga con llamada'),
      debeFallar: 'con llamada: live_pause y SIN bye',
    },
    {
      nombre: 'regla de Iñaki: al volver no se recupera el turno',
      src: () => mutar(src, "      if (p.micAbierto) this._requestTalkTurn();", "", 'sin turno'),
      debeFallar: '  -> al volver: live_resume y se vuelve a pedir el turno',
    },
    {
      nombre: 'bucle de la tablet: la pausa vuelve a vivir solo en `this`',
      src: () => mutar(src, "    if (!this.config || !PAUSA_POR_PORTERO[this.config.device_id]) return false;", "    if (!this.config || !this._pausa) return false;", 'pausa por instancia'),
      debeFallar: 'ni la card reinsertada ni una recreada',
    },
    {
      nombre: 'cambiar de vista vuelve a desmontar (1.9.0)',
      // Ancla de UNA linea y sin barras invertidas (CLAUDE.md): la primera version llevaba un salto
      // escapado que una capa de shell convirtio en uno real y rompio este fichero.
      src: () => mutar(src, "    this._pausar('oculta');                     // salir del DOM = pausar, no desmontar", "    this._teardownConnectionObjects();", 'desmonta al salir del DOM'),
      debeFallar: 'sacada del DOM: live_pause',
    },
    {
      nombre: 'timbrazo reciente ignorado en la primera lectura',
      src: () => mutar(src, "        && Date.now() - Date.parse(marca) < TIMBRE_RECIENTE_MS", "        && false", 'sin timbre reciente'),
      debeFallar: 'card nueva en pausa + timbrazo reciente',
    },
  ];

  for (const m of mutantes) {
    let r;
    try { r = await ejecutar(m.src(), false); } catch (err) {
      console.log(`  FALLO control positivo: ${m.nombre} -> ${err.message}`);
      mal += 1;
      continue;
    }
    const rompe = r.fallos.some((f) => f.startsWith(m.debeFallar));
    console.log(`  ${rompe ? 'OK   ' : 'FALLO'} control positivo: "${m.nombre}" rompe el caso que deberia`);
    if (!rompe) {
      console.log(`         se esperaba un fallo que empezara por "${m.debeFallar}"; se observo: ${JSON.stringify(r.fallos)}`);
      mal += 1;
    }
  }

  console.log(mal === 0 ? '\nBANCO VERDE Y VALIDADO POR SUS DOS LADOS\n' : `\n${mal} PROBLEMAS (revisa: un control fallido invalida el banco entero)\n`);
  process.exit(mal === 0 ? 0 : 1);
})().catch((e) => { console.error("EXCEPCION en el banco (no es un verde):", e); process.exit(2); });
