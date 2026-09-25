// Arnes para el REPASO REAL EN NAVEGADOR de los cambios de la v1.9.2 (REC, altavoz reubicado,
// chip de modo, y la clase de seguridad de pantalla completa nativa), sin sustituir nada del
// propio fichero de dist/ -- mismo principio que test/idle_release_network: solo se doblan
// fetch/EventSource/WebSocket y el puente hass.connection.sendMessagePromise, la RED, nunca la
// logica de la card.
//
// A diferencia de test/sim_multicliente.js (que fabrica una instancia minima a mano, sin
// document.createElement ni innerHTML real), este arnes SI llama a setConfig()/render() de
// verdad, con un DOM real -- es lo unico que permite comprobar que el boton de REC aparece/
// desaparece de la pagina real, que el click en el chip de modo llama a select.select_option, y
// que pantalla completa deja las clases CSS que espera _applyFullscreenUI().

window.TESTLOG = [];
function log(msg) {
  const line = `[t+${(performance.now() - window.__t0).toFixed(0)}ms] ${msg}`;
  window.TESTLOG.push(line);
  console.log('TESTLOG ' + line);
}
window.__t0 = performance.now();

const CardClass = customElements.get('islautopia-intercom-card');
if (!CardClass) log('ERROR: islautopia-intercom-card no se registro');

// ── Doble de red: falla rapido, sin bloquear cada test durante segundos ────────────────────────
window.fetch = function (url) {
  return new Promise((_, reject) => setTimeout(() => reject(new TypeError('network error (doblado)')), 10));
};
class FakeEventSource {
  constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; }
  close() {}
}
window.EventSource = FakeEventSource;
class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = null; this.onerror = null; this.onmessage = null; this.onclose = null; }
  send() {}
  close() { this.readyState = 3; }
}
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
window.WebSocket = FakeWebSocket;

// ── hass doblado, con lo que la v1.9.2 necesita de verdad: states/user/callService/
//    formatEntityState (para el chip de modo) ademas del puente de senalizacion que ya doblaba
//    el arnes hermano. `tSetHassState`/`tSetAdmin` lo mueven durante el test. ──────────────────
window.__states = {};
window.__isAdmin = true;
window.tSetHassState = function (entityId, state, attributes) {
  window.__states[entityId] = { entity_id: entityId, state, attributes: attributes || {} };
};
window.tSetAdmin = function (v) { window.__isAdmin = !!v; };
window.__calledServices = [];

function makeHass() {
  return {
    language: 'es',
    callApi: async () => { throw { status_code: 404 }; },
    user: { is_admin: window.__isAdmin },
    get states() { return window.__states; },
    formatEntityState: (stateObj, opt) => opt, // respaldo simple: la etiqueta cruda
    callService: (domain, service, data) => {
      window.__calledServices.push({ domain, service, data });
      log(`callService(${domain}.${service}, ${JSON.stringify(data)})`);
      return Promise.resolve();
    },
    connection: {
      sendMessagePromise: async (msg) => {
        log(`sendMessagePromise(${msg.type})`);
        if (msg.type === 'islautopia_doorbell/get_connection_info') {
          throw { code: 'not_found' }; // sin conexion real: no hace falta para estas pruebas de UI
        }
        throw new Error('mensaje no soportado por el doble de hass: ' + msg.type);
      },
    },
  };
}

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
// Repinta lo ligado a hass (equivalente a que Home Assistant reasigne `hass` con un tick nuevo).
window.tRefreshHass = function (id) {
  window.__cards[id].hass = window.__cards[id]._hass; // el setter dispara _updateHassBoundUI()
};
window.tClick = function (id, selector) {
  const el = window.__cards[id].querySelector(selector);
  if (!el) { log(`tClick(${id}, ${selector}) -- NO ENCONTRADO`); return false; }
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  log(`tClick(${id}, ${selector})`);
  return true;
};
window.tRect = function (id, selector) {
  const el = selector ? window.__cards[id].querySelector(selector) : window.__cards[id];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

log('harness listo');
