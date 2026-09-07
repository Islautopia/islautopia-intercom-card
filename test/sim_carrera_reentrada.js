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
  const censo = { ws: [], pc: [], es: [] };

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
    constructor() { this.cerrado = false; this.connectionState = 'new'; censo.pc.push(this); }
    addTransceiver() { return { direction: 'recvonly', sender: {} }; }
    addTrack(t) { const s = { track: t, replaceTrack: async () => {} }; this._sender = s; return s; }
    getTransceivers() { return [{ sender: this._sender, direction: 'sendrecv' }]; }
    async getStats() { return new Map(); }
    close() { this.cerrado = true; }
  }

  class FakeEventSource {
    constructor(url) { this.url = url; this.cerrado = false; censo.es.push(this); }
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
    fetch: () => Promise.reject(new Error('sin ruta local en la simulacion')),
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
    customElements: { get: () => undefined, define: (n, c) => { if (n === 'islautopia-intercom-card') CardClass = c; } },
  };
  sandbox.window.customCards = [];
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
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
          return new Promise((r) => setTimeout(() => r({ relay_ws_url: 'wss://relay/ws', credential: 'X' }), o.infoMs || 0));
        }
        if (msg.type === 'islautopia_doorbell/get_turn_credentials') {
          if (o.turnColgado) return new Promise(() => {});   // no resuelve NUNCA: caso del fusible
          return new Promise((r) => setTimeout(() => r({ urls: [] }), o.turnMs || 0));
        }
        return Promise.reject(new Error('sin proxy local'));  // get_local_signal_url
      },
    },
  };
  Object.assign(c, {
    pc: null, nativeSSE: null, nativeWS: null, _slot: null,
    _connGen: 0, _arranqueEnVueloGen: null, _arranqueEnVueloAt: 0,
    _watchdogTimer: null, _reconnectTimer: null, _reconnectAttempt: 0, _reconnecting: false,
    _lastLifeSignalAt: null, _prevPacketsReceived: null,
    _idleReleaseMs: o.idleMs === undefined ? 0 : o.idleMs,
    _idleWakeLockTimer: null, _wakeLock: null, _fsActive: false,
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
  c._acquireWakeLock = async () => {};        // no hay navigator.wakeLock, igual que en la tablet
  c._releaseWakeLock = () => {};
  // _registerIdleActivityListeners NO se sustituye: el caso 7 depende de que exista el manejador
  // real de interaccion, que es el camino por donde entraba el fallo. Solo se le da un doble al
  // addEventListener del propio elemento.
  c.addEventListener = () => {};
  c._registerUnloadHandler = () => {};
  c._sueltas = [];
  return c;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
    comp(`WebSockets contra el relay VIVOS = 1 (abiertos ${e.censo.ws.length}, vivos ${vivos(e.censo.ws)})`, vivos(e.censo.ws) === 1);
    comp(`RTCPeerConnection VIVAS = 1 (creadas ${e.censo.pc.length}, vivas ${vivos(e.censo.pc)})`, vivos(e.censo.pc) === 1);
    comp('  -> y la que queda viva es la que la card tiene en this.nativeWS', c.nativeWS && !c.nativeWS.cerrado);
    comp('  -> ningun EventSource local huerfano', vivos(e.censo.es) === 0);
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
    comp('hay WebSocket contra el relay, abierto', !!c.nativeWS && !c.nativeWS.cerrado);
    comp('  -> y se pidio la oferta por el', !!c.nativeWS && c.nativeWS.enviados.some((m) => m.includes('request_offer')));
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
    comp(`WebSockets VIVOS = 1 (abiertos ${e.censo.ws.length}, vivos ${vivos(e.censo.ws)})`, vivos(e.censo.ws) === 1);
    comp(`RTCPeerConnection VIVAS = 1 (creadas ${e.censo.pc.length}, vivas ${vivos(e.censo.pc)})`, vivos(e.censo.pc) === 1);
    comp('  -> el relevo SI quedo conectado (no se le comio el guardia)', !!c.nativeWS && !c.nativeWS.cerrado);
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
    comp('  -> y no ha abierto ninguna conexion de mas', e.censo.ws.length === 0);
    // Se envejece el marcador en vez de esperar 12 s de reloj real: lo que se prueba es la regla
    // del fusible, no la puntualidad de setTimeout.
    c._arranqueEnVueloAt = Date.now() - 60000;
    // Y la red vuelve: si el relevo tambien se colgara, esta comprobacion no podria pasar NUNCA y
    // seria un caso imposible disfrazado de prueba -- de los que se leen como un fallo del producto.
    opciones.turnColgado = false;
    c.startWebRTC('tras el fusible');
    await esperar(200);
    comp('pasado el fusible, un disparo nuevo SI arranca', !!c.nativeWS && !c.nativeWS.cerrado);
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
    const c = nuevaCard(C, { turnMs: 10, idleMs: 250 });
    await c.startWebRTC('unico');
    await esperar(600);
    comp('la sesion se ha soltado sola', c.pc === null);
    comp('  -> el WebSocket del relay esta cerrado', e.censo.ws.every((w) => w.cerrado));
    comp('  -> y queda marcado para reponerse al volver', c._streamPausedByHide === true);
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
    comp('tras 1,2s de toques con plazo de 0,25s, la sesion SIGUE viva', !!c.pc && !c.pc.cerrado);
    comp('  -> y no se marco como soltada', !c._streamPausedByHide);
    c._teardownConnectionObjects();
    if (c._idleWakeLockTimer) clearTimeout(c._idleWakeLockTimer);
  }

  return { fallos, total };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Sustitucion con guarda: el ancla aparece exactamente una vez o se ABORTA (CLAUDE.md).
//  Sin esto, un mutante cuyo ancla no casa saldria identico al original -- y entonces el control
//  positivo diria "el mutante falla igual que el bueno... o sea que pasa", en silencio.
// ─────────────────────────────────────────────────────────────────────────────────────────────
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

  const src = fs.readFileSync(rutaDist, 'utf8');
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
    const veLaFuga = r.fallos.some((f) => f.startsWith('WebSockets contra el relay VIVOS'));
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
        "  async startWebRTC(motivo = 'sin motivo') {\n    const enVuelo",
        "  async startWebRTC(motivo = 'sin motivo') {\n    return;\n    const enVuelo",
        'guardia total'),
      debeFallar: 'hay sesion viva',
    },
    {
      nombre: 'contador de generacion desactivado (_relevado siempre false)',
      src: () => mutar(src,
        '  _relevado(gen) { return gen !== this._connGen; }',
        '  _relevado(gen) { return false; }',
        'sin generacion'),
      debeFallar: 'WebSockets VIVOS',
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
          '      if (this._idleReleaseMs && pendiente > 0) {',
          '      if (false) {',
          'sin re-verificacion');
      },
      debeFallar: 'tras 1,2s de toques',
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
})();
