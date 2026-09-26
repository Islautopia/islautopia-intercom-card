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

const CardClass = customElements.get('islautopia-intercom-view');
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
// (1.9.4, Iñaki 2026-09-25) REC ya NO depende de `hass.user.is_admin` -- ese es el usuario de ESTE
// panel de Home Assistant, y el cambio real fue precisamente dejar de mirarlo (tablet "Kiosko",
// no admin de HA, pero la integracion emparejada como administradora del portero). `__isAdmin`
// se conserva solo para demostrar esa independencia (test 3 de driver.js la deja en `false` y
// comprueba que REC sigue visible si el ROL del portero es admin). Lo que de verdad gobierna es
// `__role` -- el mismo valor que la integracion expondria en `get_connection_info.role`
// (websocket_api.py, resuelto de `/api/whoami?token=`, API_CONTRACT.md §3.3-ter).
window.tSetAdmin = function (v) { window.__isAdmin = !!v; };
window.__role = 'admin';
window.tSetRole = function (v) { window.__role = v; };
window.__calledServices = [];


// (1.10.0) La card ya no acepta entidades en el YAML: las encuentra en los registros de HA
// (hass.devices + hass.entities, plataforma islautopia_doorbell, por translation_key). Este
// arnes traduce las opciones antiguas que siguen usando los drivers (rec_entity, mode_entity...)
// a entradas de registro del portero de la card, que es exactamente lo que publica la integracion.
window.__devices = {};
window.__entities = {};
window.tRegistry = function (deviceId, config) {
  const ha = 'ha-' + deviceId;
  const devices = Object.assign({}, window.__devices);
  const entities = Object.assign({}, window.__entities);
  devices[ha] = { id: ha, name: 'Portero ' + deviceId, identifiers: [['islautopia_doorbell', deviceId]] };
  const map = { rec_entity: 'rec', mode_entity: 'mode', motion_entity: 'visitor', ring_entity: 'events' };
  for (const k of Object.keys(map)) {
    if (config && config[k]) entities[config[k]] = { entity_id: config[k], device_id: ha, platform: 'islautopia_doorbell', translation_key: map[k] };
  }
  window.__devices = devices;       // objetos NUEVOS: la card cachea por identidad
  window.__entities = entities;
};

function makeHass() {
  return {
    get devices() { return window.__devices; },
    get entities() { return window.__entities; },
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
          // Resuelve de verdad (en vez de `not_found`) porque REC depende de `.role` en la
          // respuesta -- ver _updateRecButton() en dist/. El resto de campos no hace falta que
          // sean reales para estas pruebas de UI (no se completa la señalización).
          return { device_id: 'test-device', role: window.__role, live_timeout_entity: null, events_entity: null };
        }
        throw new Error('mensaje no soportado por el doble de hass: ' + msg.type);
      },
    },
  };
}

window.__cards = {};
window.tCreateCard = function (id, config) {
  const card = document.createElement('islautopia-intercom-view');
  card.__tid = id;
  card.hass = makeHass();
  window.tRegistry((config && config.device_id) || ('test-device-' + id), config);
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
