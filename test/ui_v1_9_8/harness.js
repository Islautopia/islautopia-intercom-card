// Harness for the v1.9.8 real-browser check (Quick reply split button). Copied from
// test/ui_v1_9_7/harness.js (same network/hass doubling rule as every harness in this
// directory: only fetch/EventSource/WebSocket/hass are doubled, never dist/'s own logic) and
// extended with the two new pieces this version needs: `islautopia_doorbell/get_quick_replies`
// on the websocket bridge, and a way to control it independently of get_connection_info so a
// list-load failure can be tested without also breaking the connection.

window.TESTLOG = [];
function log(msg) {
  const line = `[t+${(performance.now() - window.__t0).toFixed(0)}ms] ${msg}`;
  window.TESTLOG.push(line);
  console.log('TESTLOG ' + line);
}
window.__t0 = performance.now();

const CardClass = customElements.get('islautopia-intercom-card');
if (!CardClass) log('ERROR: islautopia-intercom-card no se registro');

// -- doble de red: falla rapido, sin bloquear cada test durante segundos -------------------------
window.fetch = function () {
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

window.__states = {};
window.__isAdmin = true;
window.tSetHassState = function (entityId, state, attributes) {
  window.__states[entityId] = { entity_id: entityId, state, attributes: attributes || {} };
};
window.tSetAdmin = function (v) { window.__isAdmin = !!v; };
window.__role = 'admin';
window.tSetRole = function (v) { window.__role = v; };
window.__lang = 'es';
window.tSetLang = function (v) { window.__lang = v; };
window.__calledServices = [];
window.__serviceMode = 'ok';   // 'ok' | 'reject' | 'hang' -- covers select_option AND play_sequence
window.__eventsEntity = null;

// Respuesta rapida (v1.9.8): la lista que devolveria islautopia_doorbell/get_quick_replies, y el
// modo con el que responde ('ok' | 'reject' | 'hang') -- separado de get_connection_info a
// proposito, para poder probar "conexion bien, lista falla" sin tocar lo primero.
window.__quickReplies = [];
window.__qrMode = 'ok';
window.tSetQuickReplies = function (list) { window.__quickReplies = list; };
window.tSetQrMode = function (v) { window.__qrMode = v; };

function makeHass() {
  return {
    language: window.__lang,
    callApi: async () => { throw { status_code: 404 }; },
    user: { is_admin: window.__isAdmin },
    get states() { return window.__states; },
    formatEntityState: (stateObj, opt) => opt,
    callService: (domain, service, data) => {
      window.__calledServices.push({ domain, service, data });
      log(`callService(${domain}.${service}, ${JSON.stringify(data)}) modo=${window.__serviceMode}`);
      if (window.__serviceMode === 'reject') return Promise.reject(new Error('That sequence does not exist on the doorbell.'));
      if (window.__serviceMode === 'hang') return new Promise((res) => { window.__releaseService = res; });
      return Promise.resolve();
    },
    connection: {
      sendMessagePromise: async (msg) => {
        log(`sendMessagePromise(${msg.type})`);
        if (msg.type === 'islautopia_doorbell/get_connection_info') {
          return { device_id: 'test-device', role: window.__role, live_timeout_entity: null, events_entity: window.__eventsEntity };
        }
        if (msg.type === 'islautopia_doorbell/get_quick_replies') {
          if (window.__qrMode === 'reject') throw new Error('unreachable');
          if (window.__qrMode === 'hang') return new Promise(() => {});
          return { quick_replies: window.__quickReplies };
        }
        if (msg.type === 'history/history_during_period') return { [msg.entity_ids[0]]: [] };
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
window.tRefreshHass = function (id) {
  window.__cards[id].hass = window.__cards[id]._hass;
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
