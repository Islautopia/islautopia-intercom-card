// Arnés de prueba para el ciclo de vida de idle_release_seconds. NO toca el modulo de la card
// salvo por el UNICO metodo que habla con el portero real (startWebRTC) - todo lo demas
// (_acquireWakeLock, _armIdleWakeLockTimer, _teardownConnectionObjects, connectedCallback,
// disconnectedCallback, los listeners de pointerdown/keydown) es codigo REAL sin modificar.

window.TESTLOG = [];
function log(msg) {
  const line = `[t+${(performance.now() - window.__t0).toFixed(0)}ms] ${msg}`;
  window.TESTLOG.push(line);
  console.log('TESTLOG ' + line);
}
window.__t0 = performance.now();

window.wakeLockAvailable = !!navigator.wakeLock;
log('navigator.wakeLock disponible = ' + window.wakeLockAvailable + ' (isSecureContext=' + window.isSecureContext + ', origin=' + location.origin + ')');

const CardClass = customElements.get('islautopia-intercom-card');
if (!CardClass) log('ERROR: islautopia-intercom-card no se registro');

let pcCounter = 0;
window.__pcCloseLog = [];

// Sustituye SOLO el establecimiento de la sesion WebRTC real (senalizacion contra el portero) por
// una version determinista y instrumentada. Todo el resto del ciclo de vida de la card (idle
// timer, wake lock, teardown, fullscreen, connected/disconnectedCallback) es el codigo real.
CardClass.prototype.startWebRTC = async function () {
  const tid = this.__tid || '(sin id)';
  log(`startWebRTC() [fake] llamado, card=${tid}`);
  this._teardownConnectionObjects(); // codigo REAL - cierra el pc anterior si lo habia
  const myId = ++pcCounter;
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const stream = canvas.captureStream(5);
  const videoEl = this.videoEl;
  this.pc = {
    _id: myId,
    close: () => {
      log(`pc.close() invocado -> pc#${myId} card=${tid}`);
      window.__pcCloseLog.push({ pcId: myId, card: tid, t: performance.now() - window.__t0 });
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
      if (videoEl) {
        try { videoEl.pause(); } catch (e) { /* noop */ }
        videoEl.srcObject = null;
      }
    },
    getStats: async () => new Map(),
  };
  log(`pc creado -> pc#${myId} card=${tid}`);
  if (this.videoEl) {
    this.videoEl.srcObject = stream;
    try { await this.videoEl.play(); } catch (e) { log('video.play() fallo: ' + e); }
  }
  this._setLiveState('live');
  if (this.loader) this.loader.style.opacity = '0';
};

window.__cards = {};

window.tCreateCard = function (id, config) {
  const card = document.createElement('islautopia-intercom-card');
  card.__tid = id;
  card.hass = { language: 'en', connection: { sendMessagePromise: async () => ({}) } };
  card.setConfig(Object.assign({ device_id: 'test-device-' + id }, config));
  window.__cards[id] = card;
  log(`tCreateCard(${id}) config=${JSON.stringify(config)}`);
  return id;
};

window.tAttach = function (id) {
  const card = window.__cards[id];
  document.getElementById('host').appendChild(card);
  log(`tAttach(${id})`);
};

window.tDetach = function (id) {
  const card = window.__cards[id];
  card.remove();
  log(`tDetach(${id})`);
};

window.tTouch = function (id) {
  const card = window.__cards[id];
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  log(`tTouch(${id}) -- pointerdown real disparado sobre la card`);
};

// Simula "un fotograma de video" (timeupdate) y "un re-render" (reasignar hass) - NINGUNO de los
// dos debe reiniciar la cuenta de inactividad.
window.tFrameAndRerender = function (id) {
  const card = window.__cards[id];
  card.videoEl.dispatchEvent(new Event('timeupdate'));
  card.hass = { language: 'en', connection: { sendMessagePromise: async () => ({}) } };
  log(`tFrameAndRerender(${id}) -- timeupdate + reasignacion de hass, NO deberia contar como interaccion`);
};

// Dispara el UNICO camino real que arma el temporizador de inactividad: _acquireWakeLock().
// En produccion se llega aqui via _enterFullscreen()/_syncFullscreenFromBrowser(); se llama
// directamente para no depender de la activacion de usuario que exige la Fullscreen API real -
// es la MISMA funcion sin modificar, solo se sustituye el gesto que la dispara.
window.tAcquireWakeLock = async function (id) {
  const card = window.__cards[id];
  await card._acquireWakeLock();
  log(`tAcquireWakeLock(${id}) -- _wakeLock=${!!card._wakeLock} idleTimerArmed=${!!card._idleWakeLockTimer}`);
};

window.tState = function (id) {
  const card = window.__cards[id];
  if (!card) return null;
  return {
    hasPc: !!card.pc,
    pcId: card.pc ? card.pc._id : null,
    videoPaused: card.videoEl ? card.videoEl.paused : null,
    videoHasSrc: card.videoEl ? !!card.videoEl.srcObject : null,
    wakeLock: !!card._wakeLock,
    idleTimerArmed: !!card._idleWakeLockTimer,
    reconnecting: !!card._reconnecting,
    isConnected: card.isConnected,
  };
};

window.tStartReconnectLoop = function (id, intervalMs) {
  const card = window.__cards[id];
  const h = setInterval(() => { if (card.isConnected) card.startWebRTC(); }, intervalMs);
  log(`tStartReconnectLoop(${id}, ${intervalMs}ms)`);
  return h;
};

window.tStopReconnectLoop = function (h) {
  clearInterval(h);
  log(`tStopReconnectLoop`);
};

// Simula un navegador/WebView SIN Screen Wake Lock API (el caso real de un panel de pared segun
// el coordinador: WebView antiguo, o simplemente navigator.wakeLock inexistente) - quita la
// propiedad del objeto navigator ANTES de que la card intente pedirla.
window.tRemoveWakeLockAPI = function () {
  try {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
  } catch (e) {
    log('tRemoveWakeLockAPI fallo: ' + e);
  }
  log('tRemoveWakeLockAPI -- navigator.wakeLock ahora es ' + navigator.wakeLock);
};

log('harness listo');
