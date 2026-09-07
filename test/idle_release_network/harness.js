// Arnes de prueba para "el video no vuelve al tocar tras soltarse por inactividad", SIN sustituir
// startWebRTC(). El unico limite conocido del arnes hermano (test-idle-release-browser) era justo
// ese: sustituia startWebRTC() entero, enmascarando la propia carrera que hay que medir.
//
// Aqui se dobla SOLO la capa de red: fetch, EventSource, WebSocket, y el puente
// hass.connection.sendMessagePromise (el WebSocket de Home Assistant hacia la integracion -- no
// hay Home Assistant real posible en este arnes, asi que es el doble mas cercano a "red" que
// existe para ese canal). RTCPeerConnection es la clase REAL del navegador: se construye, se le
// anaden transceivers/tracks, y su recoleccion ICE corre de verdad. No se le exige llegar a
// 'connected' -- lo que este arnes mide es la maquina de estados de reentrada/reposicion
// (_streamPausedByHide, _connGen, _arranqueEnVueloGen, this.pc), no la negociacion SDP completa.
//
// _armIdleWakeLockTimer(), startWebRTC(), startNativeSession(), buildNativePeerConnection(),
// tryLocalSignaling(), startRelaySignaling(), _teardownConnectionObjects(), connectedCallback(),
// disconnectedCallback(), y los listeners de pointerdown/keydown/visibilitychange/
// IntersectionObserver son TODOS codigo real sin modificar.

window.TESTLOG = [];
function log(msg) {
  const line = `[t+${(performance.now() - window.__t0).toFixed(0)}ms] ${msg}`;
  window.TESTLOG.push(line);
  console.log('TESTLOG ' + line);
}
window.__t0 = performance.now();

// delay=0 se resuelve por MICROTAREA pura (sin setTimeout) -- para poder correr la red lo mas
// rapido que el propio bucle de eventos permite, y ver si eso gana la carrera contra el
// setTimeout(0) del propio reloj de inactividad al reponerse (ver CASO 4/5 del driver).
function sleep(ms) { return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }

const CardClass = customElements.get('islautopia-intercom-card');
if (!CardClass) log('ERROR: islautopia-intercom-card no se registro');

// ── Configuracion del doble de red, mutable entre pruebas ──────────────────────────────────────
window.__netCfg = {
  connInfoDelay: 30,       // get_connection_info (WS de HA)
  turnDelay: 30,           // get_turn_credentials (WS de HA)
  turnFail: true,          // sin TURN propio -> solo STUN (no bloqueante en el codigo real)
  localSignalUrlDelay: 30, // get_local_signal_url -> null fuerza el camino 'directo'
  esOutcome: 'error',      // 'error' | 'hang' | 'offer'  (EventSource del camino local)
  esDelay: 60,
  wsOutcome: 'open',       // 'open' | 'hang' | 'error'   (WebSocket del relay)
  wsDelay: 60,
};
window.tSetNetCfg = function (patch) {
  Object.assign(window.__netCfg, patch);
  log('netCfg <- ' + JSON.stringify(patch) + ' => ' + JSON.stringify(window.__netCfg));
};

// ── fetch doblado: siempre falla rapido (no hay portero real que alcanzar desde este arnes) ────
window.__fetchLog = [];
window.fetch = function (url, opts) {
  window.__fetchLog.push(String(url));
  log(`fetch() [doblado] -> ${url}`);
  return new Promise((_, reject) => setTimeout(() => reject(new TypeError('network error (doblado, arnes offline)')), 15));
};

// ── EventSource doblado: representa la senalizacion LOCAL (SSE) ────────────────────────────────
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    this._closed = false;
    log(`FakeEventSource creado -> ${url}`);
    const c = window.__netCfg;
    if (c.esOutcome === 'hang') return; // nunca dispara nada -- decide el timeout de 3000ms del codigo real
    this._t = setTimeout(() => {
      if (this._closed) return;
      if (c.esOutcome === 'error') {
        log(`FakeEventSource -> onerror (${url})`);
        if (this.onerror) this.onerror(new Event('error'));
      } else if (c.esOutcome === 'offer') {
        log(`FakeEventSource -> onmessage 'offer' (${url})`);
        if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: 'offer', slot: 0, sdp: 'FAKE-SDP-NO-VALIDO' }) });
      }
    }, c.esDelay);
  }
  close() {
    this._closed = true;
    if (this._t) clearTimeout(this._t);
    log(`FakeEventSource.close() -> ${this.url}`);
  }
}
window.EventSource = FakeEventSource;

// ── WebSocket doblado: representa la senalizacion REMOTA (relay) ───────────────────────────────
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null; this.onerror = null; this.onmessage = null; this.onclose = null;
    log(`FakeWebSocket creado -> ${url}`);
    const c = window.__netCfg;
    if (c.wsOutcome === 'hang') return; // nunca abre ni falla -- simula relay/portero inalcanzable
    this._t = setTimeout(() => {
      if (this.readyState === 3) return; // ya se cerro (relevado) antes de que "llegara" la red
      if (c.wsOutcome === 'open') {
        this.readyState = 1; // OPEN
        log(`FakeWebSocket -> onopen (${url})`);
        if (this.onopen) this.onopen();
      } else if (c.wsOutcome === 'error') {
        log(`FakeWebSocket -> onerror (${url})`);
        if (this.onerror) this.onerror(new Event('error'));
      }
    }, c.wsDelay);
  }
  send(data) { log(`FakeWebSocket.send -> ${data}`); }
  close() {
    if (this._t) clearTimeout(this._t);
    const wasOpen = this.readyState === 1;
    this.readyState = 3; // CLOSED
    log(`FakeWebSocket.close() -> ${this.url}`);
    if (wasOpen && this.onclose) this.onclose({ code: 1000 });
  }
}
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
window.WebSocket = FakeWebSocket;

// ── hass doblado: el puente WS de Home Assistant hacia la integracion islautopia_doorbell ──────
function makeHass() {
  return {
    language: 'en',
    callApi: async () => { throw { status_code: 404 }; },
    connection: {
      sendMessagePromise: async (msg) => {
        const c = window.__netCfg;
        log(`sendMessagePromise(${msg.type})`);
        if (msg.type === 'islautopia_doorbell/get_connection_info') {
          await sleep(c.connInfoDelay);
          return { credential: 'FAKE-CRED', relay_ws_url: 'wss://fake-relay.example/ws' };
        }
        if (msg.type === 'islautopia_doorbell/get_turn_credentials') {
          await sleep(c.turnDelay);
          if (c.turnFail) throw { code: 'no_turn' };
          return { urls: [] };
        }
        if (msg.type === 'islautopia_doorbell/get_local_signal_url') {
          await sleep(c.localSignalUrlDelay);
          return null; // fuerza el camino 'directo' (mas facil de doblar que el proxy)
        }
        throw new Error('mensaje no soportado por el doble de hass: ' + msg.type);
      },
    },
  };
}

// ── Control del arnes ───────────────────────────────────────────────────────────────────────────
window.__cards = {};

window.tCreateCard = function (id, config) {
  const card = document.createElement('islautopia-intercom-card');
  card.__tid = id;
  card.hass = makeHass();
  card.setConfig(Object.assign({ device_id: 'test-device-' + id }, config));
  window.__cards[id] = card;
  log(`tCreateCard(${id}) config=${JSON.stringify(config)}`);
  return id;
};

window.tAttach = function (id) {
  document.getElementById('host').appendChild(window.__cards[id]);
  log(`tAttach(${id})`);
};

window.tDetach = function (id) {
  window.__cards[id].remove();
  log(`tDetach(${id})`);
};

window.tTouch = function (id) {
  window.__cards[id].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  log(`tTouch(${id}) -- pointerdown real disparado sobre la card`);
};

window.tState = function (id) {
  const card = window.__cards[id];
  if (!card) return null;
  return {
    hasPc: !!card.pc,
    pcConnState: card.pc ? card.pc.connectionState : null,
    streamPausedByHide: !!card._streamPausedByHide,
    connGen: card._connGen,
    arranqueEnVueloGen: card._arranqueEnVueloGen,
    reconnecting: !!card._reconnecting,
    isConnected: card.isConnected,
    content: !!card.content,
    idleTimerArmed: !!card._idleWakeLockTimer,
    offscreenTimerArmed: !!card._offscreenTimer,
    wakeLock: !!card._wakeLock,
    videoPaused: card.videoEl ? card.videoEl.paused : null,
    videoHasSrc: card.videoEl ? !!card.videoEl.srcObject : null,
    nativeWS: !!card.nativeWS,
    nativeSSE: !!card.nativeSSE,
  };
};

window.tHide = function (id) {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  log(`tHide(${id}) -- document.visibilityState = 'hidden'`);
};

window.tShow = function (id) {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  log(`tShow(${id}) -- document.visibilityState = 'visible'`);
};

log('harness listo');
