// Repaso REAL en Chromium de los cambios de la v1.9.2 (Iñaki, 2026-09-25): REC contra la entidad
// de la integración, altavoz de la calle reubicado a la fila de botones (sin deslizador de
// volumen), chip de modo intacto, selector de calidad y reloj retirados, y la clase de seguridad
// de pantalla completa nativa. Carga dist/islautopia-intercom-card.js real; harness.js dobla solo
// la capa de red (igual criterio que test/idle_release_network).
//
// EJECUTAR:
//   1. Desde la raiz del worktree: python -m http.server 8793
//   2. node test/ui_v1_9_2/driver.js
const { chromium } = require('playwright-core');

const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:\\Users\\inaki\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8793/test/ui_v1_9_2/index.html';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let fails = 0;
function check(label, cond) {
  if (cond) console.log(`  OK   ${label}`);
  else { console.log(`  FAIL ${label}`); fails++; }
}

async function newPage(browser) {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('TESTLOG')) console.log(t.replace(/^TESTLOG /, ''));
    else if (msg.type() === 'error') console.log('[console.error] ' + t);
  });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));
  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));
  return page;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await newPage(browser);

  console.log('\n########## 1. Sin rec_entity: el boton de REC no existe visible ##########');
  await page.evaluate(() => { window.tCreateCard('a', {}); window.tAttach('a'); });
  await sleep(150);
  let recDisplay = await page.evaluate(() => document.getElementById('host').querySelector('islautopia-intercom-card').recAction.style.display);
  check('rec-action display:none sin rec_entity configurada', recDisplay === 'none');

  console.log('\n########## 2. Con rec_entity + admin: aparece y hace toggle contra la entidad ##########');
  await page.evaluate(() => {
    window.tSetAdmin(true);
    window.tSetHassState('switch.rec_test', 'off', {});
    window.tCreateCard('b', { rec_entity: 'switch.rec_test' });
    window.tAttach('b');
    window.tRefreshHass('b');
  });
  await sleep(150);
  let st = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[1];
    return { display: c.recAction.style.display, recording: c.recButton.classList.contains('recording') };
  });
  check('rec-action visible (admin + entidad presente)', st.display !== 'none');
  check('boton NO marcado como grabando (estado off)', st.recording === false);

  await page.evaluate(() => window.tClick('b', '#rec-button'));
  await sleep(50);
  let calls = await page.evaluate(() => window.__calledServices.slice());
  check('el primer toque pide turn_on (estaba off)', calls.some((c) => c.domain === 'switch' && c.service === 'turn_on' && c.data.entity_id === 'switch.rec_test'));

  await page.evaluate(() => { window.tSetHassState('switch.rec_test', 'on', {}); window.tRefreshHass('b'); });
  await sleep(50);
  let st2 = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[1];
    return c.recButton.classList.contains('recording');
  });
  check('boton pasa a "grabando" en cuanto la ENTIDAD (no el ultimo tap) dice on', st2 === true);

  await page.evaluate(() => { window.__calledServices.length = 0; window.tClick('b', '#rec-button'); });
  await sleep(50);
  calls = await page.evaluate(() => window.__calledServices.slice());
  check('con la entidad en "on", el toque pide turn_off (nunca el ultimo tap)', calls.some((c) => c.service === 'turn_off'));

  console.log('\n########## 3. Sin ser administrador: oculto aunque la entidad exista ##########');
  await page.evaluate(() => {
    window.tSetAdmin(false);
    window.tCreateCard('c', { rec_entity: 'switch.rec_test' });
    window.tAttach('c');
    window.tRefreshHass('c');
  });
  await sleep(100);
  let recNonAdmin = await page.evaluate(() => document.getElementById('host').querySelectorAll('islautopia-intercom-card')[2].recAction.style.display);
  check('oculto para un usuario no-administrador', recNonAdmin === 'none');
  await page.evaluate(() => window.tSetAdmin(true));

  console.log('\n########## 4. El chip de modo sigue llamando a select.select_option ##########');
  await page.evaluate(() => {
    window.tSetHassState('select.modo_test', 'normal', { options: ['normal', 'away', 'do_not_disturb', 'custom'] });
    window.tCreateCard('d', { mode_entity: 'select.modo_test' });
    window.tAttach('d');
    window.tRefreshHass('d');
  });
  await sleep(150);
  await page.evaluate(() => { window.__calledServices.length = 0; window.tClick('d', '.mode-row .chip[data-option="away"]'); });
  await sleep(50);
  calls = await page.evaluate(() => window.__calledServices.slice());
  check('el chip de modo llama a select.select_option con la opcion pulsada', calls.some((c) => c.domain === 'select' && c.service === 'select_option' && c.data.option === 'away'));

  console.log('\n########## 5. Altavoz reubicado: sin deslizador de volumen, el boton alterna mute ##########');
  await page.evaluate(() => { window.tCreateCard('e', {}); window.tAttach('e'); });
  await sleep(100);
  const noSlider = await page.evaluate(() => !document.getElementById('host').querySelectorAll('islautopia-intercom-card')[4].querySelector('#vol-slider'));
  check('no existe ya #vol-slider en el DOM', noSlider);
  const sndInActionsRow = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[4];
    const btn = c.querySelector('#snd-btn');
    return !!btn && !!btn.closest('.actions-row') && btn.classList.contains('btn') && btn.classList.contains('snd');
  });
  check('el boton de sonido vive en la fila de acciones (btn.snd)', sndInActionsRow);
  const audioBefore = await page.evaluate(() => document.getElementById('host').querySelectorAll('islautopia-intercom-card')[4]._audioOn);
  await page.evaluate(() => window.tClick('e', '#snd-btn'));
  await sleep(30);
  const audioAfter = await page.evaluate(() => document.getElementById('host').querySelectorAll('islautopia-intercom-card')[4]._audioOn);
  check('un toque en el altavoz invierte _audioOn (arranca mudo)', audioBefore === false && audioAfter === true);

  console.log('\n########## 6. Selector de calidad y reloj superpuesto: retirados del DOM ##########');
  const goneEls = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[4];
    return {
      quality: !!c.querySelector('#hud-quality'),
      clock: !!c.querySelector('#hud-time'),
    };
  });
  check('#hud-quality ya no existe (chip de calidad retirado)', goneEls.quality === false);
  check('#hud-time ya no existe (reloj superpuesto retirado)', goneEls.clock === false);

  console.log('\n########## 7. Orden de la fila de botones: sonido, micro, abrir, REC ##########');
  const order = await page.evaluate(() => {
    window.tSetHassState('switch.rec_order', 'off', {});
    const c = document.createElement('islautopia-intercom-card');
    c.hass = { language: 'es', user: { is_admin: true }, states: window.__states, callService: () => Promise.resolve(), connection: { sendMessagePromise: async () => { throw { code: 'not_found' }; } } };
    c.setConfig({ device_id: 'order-test', rec_entity: 'switch.rec_order' });
    document.getElementById('host').appendChild(c);
    c.hass = c._hass;
    const ids = Array.from(c.querySelectorAll('.actions-row .action button')).map((b) => b.id);
    return ids;
  });
  check(`orden real: ${JSON.stringify(order)}`, JSON.stringify(order) === JSON.stringify(['snd-btn', 'intercom-button', 'unlock-button', 'rec-button']));

  console.log('\n########## 8. Pantalla completa: toggle no lanza excepcion y deja un estado consistente ##########');
  // ⚠️ page.evaluate()+dispatchEvent('click') NO sirve aqui: es un evento sintetico sin activacion
  // de usuario, y requestFullscreen() lo rechaza SIEMPRE por eso (no por nada de la card) - el
  // arnes mediria su propia limitacion, no el codigo. page.click() de Playwright si pasa por CDP
  // como un input real y cuenta como gesto del usuario, igual que un toque de verdad.
  await page.evaluate(() => { window.tCreateCard('f', {}); window.tAttach('f'); });
  await sleep(100);
  const fsBtnHandle = await page.evaluateHandle(() => document.getElementById('host').querySelectorAll('islautopia-intercom-card')[5].querySelector('#fs-btn'));
  await fsBtnHandle.asElement().click();
  await sleep(300);
  const fsState = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[5];
    return {
      hasDataFs: c.hasAttribute('data-fs'),
      fsActive: !!c._fsActive,
      fsNative: !!c._fsNative,
      nativeLayoutClass: c.classList.contains('ig-fs-native-layout'),
      pseudoClass: c.content.classList.contains('ig-fs-pseudo'),
      isDocFsElement: document.fullscreenElement === c,
    };
  });
  console.log('  estado tras el primer toque:', JSON.stringify(fsState));
  check('data-fs presente tras activar', fsState.hasDataFs === true);
  check('_fsActive true', fsState.fsActive === true);
  // Consistencia interna: nativo <=> tiene la clase de seguridad Y NO tiene ig-fs-pseudo; respaldo <=> al reves.
  const consistente = fsState.fsNative
    ? (fsState.nativeLayoutClass === true && fsState.pseudoClass === false)
    : (fsState.nativeLayoutClass === false && fsState.pseudoClass === true);
  check('el modo (nativo/respaldo) y sus clases CSS coinciden entre si', consistente);
  await fsBtnHandle.asElement().click();
  await sleep(200);
  const fsAfterExit = await page.evaluate(() => {
    const c = document.getElementById('host').querySelectorAll('islautopia-intercom-card')[5];
    return { hasDataFs: c.hasAttribute('data-fs'), nativeLayoutClass: c.classList.contains('ig-fs-native-layout') };
  });
  check('sale de pantalla completa: sin data-fs', fsAfterExit.hasDataFs === false);
  check('sale de pantalla completa: sin la clase de seguridad nativa', fsAfterExit.nativeLayoutClass === false);

  await browser.close();
  console.log(`\n${fails === 0 ? 'TODO OK' : `${fails} FALLO(S)`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
