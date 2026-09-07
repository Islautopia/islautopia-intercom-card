// Prueba en NAVEGADOR DE VERDAD (no simulacion) del release de video por inactividad
// (idle_release_seconds). Existe porque tres versiones seguidas (v1.4.0, v1.5.1, v1.6.0) se dieron
// por buenas razonando sobre el codigo, sin ejecutar nunca en un navegador real - y las tres
// fallaron igual en el panel de pared real (Galaxy Tab). Carga el fichero REAL de dist/ (via
// index.html) y solo sustituye startWebRTC() (la senalizacion contra un portero real) por una
// version instrumentada y deterministica - ver harness.js. Todo el ciclo de vida que se mide
// (_acquireWakeLock, _armIdleWakeLockTimer, _teardownConnectionObjects, connected/
// disconnectedCallback, los listeners de pointerdown/keydown) es el codigo real sin tocar.
//
// COMO EJECUTARLO:
//   1. Servir este directorio (necesita servir tambien ../../dist/, o sea la raiz del repo) por
//      HTTP - p.ej. desde la raiz del repo: `python -m http.server 8791`
//      y usar BASE_URL=http://127.0.0.1:8791/test/idle_release/index.html
//   2. `npm install playwright-core` (SOLO playwright-core - el paquete `playwright` completo no
//      hace falta si ya tienes un Chromium descargado en otro sitio, p.ej. el que instala
//      `npx playwright install chromium` en cualquier proyecto de esta maquina).
//   3. Ajustar EXE de mas abajo a la ruta real de chrome.exe de ese Chromium (o exportar
//      PLAYWRIGHT_CHROMIUM_PATH y leerlo aqui).
//   4. `node test/idle_release/driver.js`
//
// Ver tambien driver_nowakelock.js: mismo arnes, pero simulando un navegador/WebView SIN Screen
// Wake Lock API (navigator.wakeLock === undefined) - el caso real de bastantes paneles de pared,
// y el que de verdad explico por que las tres versiones anteriores fallaban identico (ver commit
// de card-carrera-startwebrtc: _armIdleWakeLockTimer() solo se llamaba dentro de
// _acquireWakeLock(), que se va por la puerta de atras sin esa API).
const { chromium } = require('playwright-core');

const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:\\Users\\inaki\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8791/test/idle_release/index.html';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('TESTLOG')) console.log(t.replace(/^TESTLOG /, ''));
    else if (msg.type() === 'error') console.log('[console.error] ' + t);
  });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));

  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));

  const wakeLockAvailable = await page.evaluate(() => window.wakeLockAvailable);
  console.log('\n=== navigator.wakeLock disponible en este contexto: ' + wakeLockAvailable + ' ===\n');

  // ────────────────────────────────────────────────────────────────────────────────────────
  // CASO 0 (control negativo estructural): uso NORMAL de la card -- se conecta, reproduce video,
  // y NUNCA se entra en pantalla completa (el caso real de un panel de pared en la vista de
  // Lovelace, sin tocar el boton de pantalla completa). Con idle_release_seconds corto, ¿suelta
  // el video solo por estar quieta, sin fullscreen de por medio?
  // ────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n########## CASO 0: card normal (SIN fullscreen), idle_release_seconds=4, espera 8s ##########');
  await page.evaluate(() => { window.tCreateCard('c0', { idle_release_seconds: 4 }); window.tAttach('c0'); });
  await sleep(500);
  console.log('estado tras conectar:', JSON.stringify(await page.evaluate(() => window.tState('c0'))));
  await sleep(8000);
  const s0 = await page.evaluate(() => window.tState('c0'));
  console.log('estado tras 8s de quietud (2x el plazo):', JSON.stringify(s0));
  console.log('CASO 0 -> ' + (s0.hasPc ? 'NO SOLTO el video (pc sigue vivo)' : 'SI solto el video'));
  await page.evaluate(() => window.tDetach('c0'));

  // ────────────────────────────────────────────────────────────────────────────────────────
  // CASO 1: igual, pero AHORA se ha adquirido el wake lock al menos una vez (el camino real es
  // entrar en pantalla completa; aqui se llama a la MISMA funcion real _acquireWakeLock() para no
  // depender de la activacion de usuario que exige la Fullscreen API real). Sin tocar nada mas,
  // ¿se suelta el video al agotarse el plazo?
  // ────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n########## CASO 1: tras _acquireWakeLock() una vez, idle_release_seconds=4, sin tocar nada ##########');
  await page.evaluate(() => { window.tCreateCard('c1', { idle_release_seconds: 4 }); window.tAttach('c1'); });
  await sleep(300);
  await page.evaluate(() => window.tAcquireWakeLock('c1'));
  console.log('estado tras acquireWakeLock:', JSON.stringify(await page.evaluate(() => window.tState('c1'))));
  await sleep(6000);
  const s1 = await page.evaluate(() => window.tState('c1'));
  console.log('estado tras 6s (plazo=4s):', JSON.stringify(s1));
  console.log('CASO 1 -> ' + (!s1.hasPc && s1.videoPaused ? 'CORRECTO: solto pc+video+wakelock' : 'FALLO: sigue con pc/video'));
  await page.evaluate(() => window.tDetach('c1'));

  // ────────────────────────────────────────────────────────────────────────────────────────
  // CASO 2: el caso que fallo 3 veces -- reconexiones (renegociacion del stream) MAS FRECUENTES
  // que el plazo de inactividad. idle_release_seconds=6, reconexion cada 2s. ¿Sigue soltando?
  // ────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n########## CASO 2: reconexiones cada 2s con idle_release_seconds=6 (el caso que fallaba) ##########');
  await page.evaluate(() => { window.tCreateCard('c2', { idle_release_seconds: 6 }); window.tAttach('c2'); });
  await sleep(300);
  await page.evaluate(() => window.tAcquireWakeLock('c2'));
  const loopHandle = await page.evaluate(() => window.tStartReconnectLoop('c2', 2000));
  await sleep(4000);
  console.log('estado a los 4s (con reconexiones cada 2s de por medio):', JSON.stringify(await page.evaluate(() => window.tState('c2'))));
  await sleep(6000); // total 10s desde el arranque, 10s desde la ULTIMA interaccion real (ninguna)
  const s2 = await page.evaluate((h) => { window.tStopReconnectLoop(h); return window.tState('c2'); }, loopHandle);
  console.log('estado a los 10s (plazo=6s, con reconexiones de por medio):', JSON.stringify(s2));
  console.log('CASO 2 -> ' + (!s2.hasPc && s2.videoPaused ? 'CORRECTO: solto pese a las reconexiones' : 'FALLO: las reconexiones impidieron soltar'));
  await page.evaluate(() => window.tDetach('c2'));

  // ────────────────────────────────────────────────────────────────────────────────────────
  // CASO 3: el ELEMENTO se destruye y se recrea (como hace Lovelace/HA) DESPUES de que el plazo
  // ya ha vencido segun el reloj a nivel de MODULO. La instancia nueva, recien nacida, ¿suelta
  // INMEDIATAMENTE en vez de conceder otro plazo entero?
  // ────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n########## CASO 3: destruir y recrear el ELEMENTO tras vencer el plazo (reloj de modulo) ##########');
  await page.evaluate(() => { window.tCreateCard('c3a', { idle_release_seconds: 5 }); window.tAttach('c3a'); });
  await sleep(300);
  await page.evaluate(() => window.tAcquireWakeLock('c3a'));
  console.log('c3a conectada, plazo=5s. Se destruye a los 2s (antes de que venza) y se recrea otra instancia (c3b).');
  await sleep(2000);
  await page.evaluate(() => window.tDetach('c3a')); // dispara disconnectedCallback() real
  // Han pasado 2s desde la ultima interaccion (la propia adquisicion del wake lock). Esperamos
  // otros 4s (total 6s > plazo de 5s) ANTES de recrear la instancia nueva, para que nazca con el
  // plazo YA vencido segun el reloj de modulo.
  await sleep(4000);
  console.log('Recreando la card (nueva instancia c3b) con el plazo ya vencido (6s transcurridos, plazo=5s)...');
  const t0recreate = Date.now();
  await page.evaluate(() => { window.tCreateCard('c3b', { idle_release_seconds: 5 }); window.tAttach('c3b'); });
  // Como la nueva instancia NUNCA ha llamado a _acquireWakeLock() (nace fria, y ese es
  // precisamente el camino que arma el temporizador), no hay temporizador que dispare solo por
  // existir -- se mide primero el estado tal cual nace, y ADEMAS se le da el mismo camino de
  // armado (_acquireWakeLock) para ver que hace el reloj heredado en cuanto se arma.
  await sleep(200);
  console.log('estado de c3b nada mas nacer (sin haber pedido wake lock todavia):', JSON.stringify(await page.evaluate(() => window.tState('c3b'))));
  await page.evaluate(() => window.tAcquireWakeLock('c3b'));
  await sleep(300);
  const s3 = await page.evaluate(() => window.tState('c3b'));
  console.log('estado de c3b justo despues de _acquireWakeLock() (plazo ya vencido por el reloj de modulo):', JSON.stringify(s3));
  console.log('CASO 3 -> ' + (!s3.hasPc && s3.videoPaused ? 'CORRECTO: la instancia nueva solto de inmediato' : 'FALLO: la instancia nueva regalo un plazo entero'));
  await page.evaluate(() => window.tDetach('c3b'));

  // ────────────────────────────────────────────────────────────────────────────────────────
  // CASO 4a: un toque de verdad (pointerdown) SI reinicia el plazo.
  // CASO 4b (control positivo/negativo cruzado): un fotograma de video (timeupdate) y un
  // re-render (reasignar hass) NO deben reiniciarlo -- y con toques periodicos DE VERDAD, la
  // card NUNCA debe soltar (control negativo pedido explicitamente: un instrumento que soltara
  // siempre pasaria los casos 0-3 y parecería mejor de lo que es).
  // ────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n########## CASO 4: pointerdown SI reinicia, timeupdate/re-render NO, toques periodicos NUNCA sueltan ##########');
  await page.evaluate(() => { window.tCreateCard('c4', { idle_release_seconds: 4 }); window.tAttach('c4'); });
  await sleep(300);
  await page.evaluate(() => window.tAcquireWakeLock('c4'));

  // 4b primero: fotogramas + re-render cada 1s durante 9s (mas del doble del plazo) SIN ningun
  // toque real -- deben ser transparentes al reloj de inactividad.
  for (let i = 0; i < 9; i++) {
    await sleep(1000);
    await page.evaluate(() => window.tFrameAndRerender('c4'));
  }
  const s4b = await page.evaluate(() => window.tState('c4'));
  console.log('estado tras 9s de SOLO fotogramas/re-render (plazo=4s, deberia haberse soltado igual):', JSON.stringify(s4b));
  console.log('CASO 4b -> ' + (!s4b.hasPc ? 'CORRECTO: fotograma/re-render NO cuentan como interaccion, se solto' : 'FALLO: un fotograma esta reiniciando el plazo'));

  // 4a: control NEGATIVO real -- recrear con toques periodicos DE VERDAD mas frecuentes que el
  // plazo; la card NUNCA debe soltar mientras esos toques continuen.
  await page.evaluate(() => window.tDetach('c4'));
  await page.evaluate(() => { window.tCreateCard('c4b', { idle_release_seconds: 4 }); window.tAttach('c4b'); });
  await sleep(300);
  await page.evaluate(() => window.tAcquireWakeLock('c4b'));
  for (let i = 0; i < 8; i++) {
    await sleep(1500); // < 4s de plazo
    await page.evaluate(() => window.tTouch('c4b'));
  }
  const s4a_neg = await page.evaluate(() => window.tState('c4b'));
  console.log('estado tras 12s de TOQUES REALES cada 1.5s (plazo=4s) -- control negativo, NO debe haberse soltado:', JSON.stringify(s4a_neg));
  console.log('CASO 4a (control negativo) -> ' + (s4a_neg.hasPc ? 'CORRECTO: con toques reales nunca suelta' : 'FALLO: solto pese a los toques reales (falso positivo)'));

  // Y ahora se dejan de tocar: debe soltar tras el plazo.
  await sleep(6000);
  const s4a_pos = await page.evaluate(() => window.tState('c4b'));
  console.log('estado 6s despues de dejar de tocar (plazo=4s):', JSON.stringify(s4a_pos));
  console.log('CASO 4a (control positivo) -> ' + (!s4a_pos.hasPc ? 'CORRECTO: al dejar de tocar, suelta' : 'FALLO: no solto tras dejar de tocar'));
  await page.evaluate(() => window.tDetach('c4b'));

  console.log('\n=== FIN. Log completo del navegador (TESTLOG) ya impreso arriba en orden cronologico intercalado por caso. ===');
  await browser.close();
}

main().catch((err) => { console.error('DRIVER ERROR', err); process.exit(1); });
