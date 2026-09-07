// Mide en Chromium real POR QUE el video no vuelve al tocar la card tras soltarse por
// inactividad, SIN sustituir startWebRTC() (a diferencia del arnes hermano
// test-idle-release-browser, cuyo reemplazo total de startWebRTC() enmascara justo la carrera que
// hay que ver). Carga dist/islautopia-intercom-card.js real; harness.js dobla solo fetch/
// EventSource/WebSocket/hass.connection.sendMessagePromise -- la capa de red, no la logica de la
// card.
//
// EJECUTAR:
//   1. Desde la raiz del worktree: `python -m http.server 8792`
//   2. `node test/idle_release_network/driver.js`
const { chromium } = require('playwright-core');

const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:\\Users\\inaki\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8792/test/idle_release_network/index.html';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function newPage(browser) {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('TESTLOG')) console.log(t.replace(/^TESTLOG /, ''));
    else if (msg.type() === 'error') console.log('[console.error] ' + t);
    else if (msg.type() === 'warning') console.log('[console.warn] ' + t);
    else if (msg.type() === 'info' || msg.type() === 'log') console.log('[console.' + msg.type() + '] ' + t);
  });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));
  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));
  return page;
}

// Sondea tState(id) cada `stepMs` hasta `totalMs`, imprimiendo cada muestra -- para ver EXACTAMENTE
// cuando (si acaso) hasPc vuelve a true tras el toque, en vez de solo mirar el final.
async function pollState(page, id, totalMs, stepMs) {
  let elapsed = 0;
  const samples = [];
  while (elapsed <= totalMs) {
    const s = await page.evaluate((id) => window.tState(id), id);
    samples.push({ t: elapsed, ...s });
    console.log(`  t+${elapsed}ms: hasPc=${s.hasPc} streamPausedByHide=${s.streamPausedByHide} connGen=${s.connGen} arranqueEnVueloGen=${s.arranqueEnVueloGen} nativeWS=${s.nativeWS}`);
    await sleep(stepMs);
    elapsed += stepMs;
  }
  return samples;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CONTROL POSITIVO ESTRUCTURAL: el arnes tiene que SABER VER una reposicion cuando ocurre de
  // verdad, por un camino ya dado por bueno (visibilitychange), antes de fiarse de lo que diga
  // sobre el camino de inactividad+toque. Si esto no detecta la reposicion, el arnes esta ciego y
  // ningun resultado de mas abajo vale nada.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CONTROL POSITIVO: soltar por visibilitychange y reponer por visibilitychange ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 40, wsOutcome: 'open', wsDelay: 40, turnFail: true });
      window.tCreateCard('p', { idle_release_seconds: 0 }); // 0 = desactiva el reloj de inactividad, no interfiere
      window.tAttach('p');
    });
    await sleep(600);
    const before = await page.evaluate(() => window.tState('p'));
    console.log('estado tras conectar:', JSON.stringify(before));
    await page.evaluate(() => window.tHide('p'));
    await sleep(200);
    const hidden = await page.evaluate(() => window.tState('p'));
    console.log('estado tras ocultar (visibilitychange):', JSON.stringify(hidden));
    await page.evaluate(() => window.tShow('p'));
    await sleep(600);
    const shown = await page.evaluate(() => window.tState('p'));
    console.log('estado tras volver a mostrar:', JSON.stringify(shown));
    const veredicto = !before.hasPc ? 'CONTROL INVALIDO (no conecto de entrada)'
      : (hidden.hasPc ? 'CONTROL INVALIDO (no solto al ocultar)'
        : (shown.hasPc ? 'CONTROL POSITIVO OK: el arnes SI ve una reposicion cuando ocurre' : 'CONTROL INVALIDO (tampoco repuso por visibilitychange -- arnes sospechoso)'));
    console.log('=> ' + veredicto);
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 1 (el hecho a explicar, red RAPIDA/normal): idle_release_seconds corto, se deja soltar
  // solo, y se toca. startWebRTC() es el codigo REAL -- si esto repone, el mecanismo basico
  // funciona con una red rapida y hay que buscar la falla en condiciones mas adversas. Si NO
  // repone, la falla es de base y no hace falta red lenta para verla.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 1: idle_release_seconds=2, red normal (rapida), soltar solo y luego TOCAR ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 40, wsOutcome: 'open', wsDelay: 40, turnFail: true,
        connInfoDelay: 30, turnDelay: 30, localSignalUrlDelay: 30 });
      window.tCreateCard('c1', { idle_release_seconds: 2 });
      window.tAttach('c1');
    });
    await sleep(500);
    console.log('estado tras conectar:', JSON.stringify(await page.evaluate(() => window.tState('c1'))));
    await sleep(2600); // > 2s del plazo
    const released = await page.evaluate(() => window.tState('c1'));
    console.log('estado tras el plazo de inactividad (SIN tocar):', JSON.stringify(released));
    if (released.hasPc) {
      console.log('=> CASO 1 INVALIDO: no llego a soltarse solo, no se puede probar el toque');
    } else {
      console.log('-- tocando ahora, y muestreando el estado cada 500ms durante 13s (pasado el fusible de 12s) --');
      await page.evaluate(() => window.tTouch('c1'));
      const samples = await pollState(page, 'c1', 13000, 500);
      const recuperado = samples.some((s) => s.hasPc);
      console.log('=> CASO 1: ' + (recuperado ? 'SE REPUSO (hasPc volvio a true en algun momento)' : 'NO SE REPUSO EN 13s -- reproducido el sintoma'));
    }
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 2 (sospecha 1: guardia de reentrada): el primer startWebRTC() se queda COLGADO A MEDIAS
  // (el relay nunca abre ni falla -- wsOutcome='hang'), asi que su promesa nunca se resuelve y
  // _arranqueEnVueloGen sigue vivo con el valor de ESE arranque cuando llega la inactividad. Se
  // deja soltar por inactividad (que sigue viendo this.pc truthy, asignado antes del relay) y se
  // toca. ¿Bloquea el guardia al segundo arranque? ¿Actua el fusible de 12s?
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 2: primer arranque COLGADO (relay nunca abre/falla), idle_release_seconds=2, luego TOCAR ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 40, wsOutcome: 'hang', turnFail: true,
        connInfoDelay: 30, turnDelay: 30, localSignalUrlDelay: 30 });
      window.tCreateCard('c2', { idle_release_seconds: 2 });
      window.tAttach('c2');
    });
    await sleep(500);
    const midflight = await page.evaluate(() => window.tState('c2'));
    console.log('estado con el primer arranque colgado en el relay:', JSON.stringify(midflight));
    await sleep(2600);
    const released = await page.evaluate(() => window.tState('c2'));
    console.log('estado tras el plazo de inactividad (arranque original SIGUE colgado):', JSON.stringify(released));
    console.log('-- tocando ahora, muestreando 13s (fusible ARRANQUE_EN_VUELO_MAX_MS=12000ms) --');
    await page.evaluate(() => window.tTouch('c2'));
    const samples = await pollState(page, 'c2', 13000, 500);
    const bloqueado = samples.some((s) => s.arranqueEnVueloGen !== null && !s.hasPc);
    const recuperado = samples.some((s) => s.hasPc);
    console.log(`=> CASO 2: arranqueEnVuelo visto no-null en algun momento tras tocar=${bloqueado}; ` + (recuperado ? 'SE REPUSO' : 'NO SE REPUSO EN 13s'));
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 3 (sospecha 3: dos productores de _streamPausedByHide): mientras la card sigue delante
  // (sin ocultarse ni salir de pantalla), se agota la inactividad. Antes de tocar, se dispara
  // TAMBIEN un visibilitychange a 'hidden' y luego 'visible' inmediato (p.ej. el navegador
  // conmutando de pestana un instante, o cualquier evento espurio) para ver si el segundo productor
  // dejaria _streamPausedByHide en un estado que el toque ya no reconozca como "hay que reponer".
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 3: idle-release + visibilitychange espurio ANTES de tocar ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 40, wsOutcome: 'open', wsDelay: 40, turnFail: true,
        connInfoDelay: 30, turnDelay: 30, localSignalUrlDelay: 30 });
      window.tCreateCard('c3', { idle_release_seconds: 2 });
      window.tAttach('c3');
    });
    await sleep(500);
    await sleep(2600);
    const released = await page.evaluate(() => window.tState('c3'));
    console.log('estado tras el plazo de inactividad:', JSON.stringify(released));
    console.log('-- disparando visibilitychange hidden->visible espurio (la pagina nunca deja de estar activa de verdad) --');
    await page.evaluate(() => { window.tHide('c3'); });
    await sleep(50);
    const afterHideSpurious = await page.evaluate(() => window.tState('c3'));
    console.log('estado tras el hidden espurio:', JSON.stringify(afterHideSpurious));
    await page.evaluate(() => { window.tShow('c3'); });
    await sleep(300);
    const afterShowSpurious = await page.evaluate(() => window.tState('c3'));
    console.log('estado tras el show espurio (¿reconecto solo, sin tocar?):', JSON.stringify(afterShowSpurious));
    console.log('-- ahora SI se toca --');
    await page.evaluate(() => window.tTouch('c3'));
    const samples = await pollState(page, 'c3', 4000, 500);
    const recuperado = samples.some((s) => s.hasPc);
    console.log('=> CASO 3: ' + (recuperado ? 'SE REPUSO tras el toque' : 'NO SE REPUSO tras el toque'));
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 4 (carrera fina): red LO MAS RAPIDA POSIBLE (connInfoDelay=0, turnDelay=0 -- resueltas
  // por microtarea, sin setTimeout) para ver si this.pc puede llegar a asignarse ANTES de que el
  // propio reloj de inactividad recien armado (con el reloj ABSOLUTO ya vencido, ver
  // _armIdleWakeLockTimer) dispare su comprobacion de "restante <= 0" -- que es un setTimeout(0)
  // programado ANTES, sincronamente, al principio de startWebRTC(). Si esta comprobacion llega a
  // ver this.pc ya puesto, se auto-suelta la conexion que el toque acaba de reponer.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 4: red lo mas rapida posible tras el toque -- carrera fina pc-vs-reloj-de-inactividad ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 10, wsOutcome: 'open', wsDelay: 10, turnFail: true,
        connInfoDelay: 30, turnDelay: 30, localSignalUrlDelay: 10 });
      window.tCreateCard('c4', { idle_release_seconds: 2 });
      window.tAttach('c4');
    });
    await sleep(500);
    await sleep(2600);
    const released = await page.evaluate(() => window.tState('c4'));
    console.log('estado tras el plazo de inactividad:', JSON.stringify(released));
    // Ahora la red pasa a ser instantanea (microtarea pura) SOLO para lo que decide la carrera.
    await page.evaluate(() => window.tSetNetCfg({ connInfoDelay: 0, turnDelay: 0 }));
    console.log('-- tocando con red instantanea, muestreando cada 5ms los primeros 300ms --');
    await page.evaluate(() => window.tTouch('c4'));
    let sawArmedTrue = false;
    let sawPcTrueThenFalseFast = false;
    let prevPc = false;
    for (let i = 0; i < 60; i++) {
      const s = await page.evaluate(() => window.tState('c4'));
      if (s.idleTimerArmed) sawArmedTrue = true;
      if (prevPc && !s.hasPc) sawPcTrueThenFalseFast = true;
      prevPc = s.hasPc;
      if (i < 20 || i % 5 === 0) console.log(`  t+${i * 5}ms: hasPc=${s.hasPc} streamPausedByHide=${s.streamPausedByHide} idleTimerArmed=${s.idleTimerArmed} connGen=${s.connGen}`);
      await sleep(5);
    }
    const final = await page.evaluate(() => window.tState('c4'));
    console.log('estado final (300ms tras el toque):', JSON.stringify(final));
    console.log(`=> CASO 4: idleTimerArmed visto en true en algun momento=${sawArmedTrue}; pc paso de true a false otra vez tras el toque=${sawPcTrueThenFalseFast}; hasPc final=${final.hasPc}`);
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 5 (reloj de inactividad de un solo disparo): tras soltar por inactividad y reponerse con
  // un toque, ¿vuelve a armarse el reloj de inactividad para un SEGUNDO ciclo automatico? Si el
  // toque de reposicion nunca actualiza ULTIMA_INTERACCION_MS (ver el `return` temprano de
  // _onIdleActivity en la rama "reponer"), la comprobacion que arma startWebRTC() ve el reloj ya
  // vencido, dispara casi al instante, no encuentra nada que soltar (o suelta lo recien repuesto,
  // CASO 4) y en NINGUN caso se reprograma a si misma -- asi que el reloj de inactividad
  // automatico dejaria de disparar NUNCA MAS en esta sesion, aunque el usuario vuelva a dejar la
  // card quieta el tiempo que sea.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 5: tras reponerse por toque, ¿el reloj de inactividad vuelve a disparar solo? ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 40, wsOutcome: 'open', wsDelay: 40, turnFail: true,
        connInfoDelay: 30, turnDelay: 30, localSignalUrlDelay: 30 });
      window.tCreateCard('c5', { idle_release_seconds: 2 });
      window.tAttach('c5');
    });
    await sleep(500);
    await sleep(2600);
    console.log('estado tras el PRIMER plazo de inactividad:', JSON.stringify(await page.evaluate(() => window.tState('c5'))));
    await page.evaluate(() => window.tTouch('c5'));
    await sleep(500);
    const afterTouch = await page.evaluate(() => window.tState('c5'));
    console.log('estado 500ms tras el toque (reconectado):', JSON.stringify(afterTouch));
    console.log('-- esperando 6s SIN tocar (3x el plazo configurado) para ver si el reloj de inactividad dispara un SEGUNDO ciclo automatico --');
    const samples = await pollState(page, 'c5', 6000, 1000);
    const segundoDisparo = samples.some((s) => !s.hasPc);
    console.log('=> CASO 5: ' + (segundoDisparo
      ? 'el reloj SI volvio a disparar solo (el idle-release automatico sigue vivo tras un ciclo)'
      : 'el reloj NO volvio a disparar en 6s -- reproducido: el idle-release automatico murio tras el primer ciclo toque-reposicion'));
    await page.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CASO 6 (mismo mecanismo, red REALISTA -- no microtarea instantanea): 5-10ms por salto, del
  // orden de un WebSocket de Home Assistant en la misma maquina/LAN. Confirma que el CASO 4 no es
  // un artefacto del truco de "0ms = microtarea pura": con saltos de red pequeños pero reales
  // (setTimeout de verdad), this.pc puede seguir llegando a tiempo de que el reloj de inactividad
  // vencido lo encuentre puesto y se autodestruya la reconexion.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await newPage(browser);
    console.log('\n########## CASO 6: mismo mecanismo con red RAPIDA REALISTA (5-10ms, sin microtarea instantanea) ##########');
    await page.evaluate(() => {
      window.tSetNetCfg({ esOutcome: 'error', esDelay: 8, wsOutcome: 'open', wsDelay: 8, turnFail: true,
        connInfoDelay: 6, turnDelay: 6, localSignalUrlDelay: 6 });
      window.tCreateCard('c6', { idle_release_seconds: 2 });
      window.tAttach('c6');
    });
    await sleep(500);
    await sleep(2600);
    console.log('estado tras el plazo de inactividad:', JSON.stringify(await page.evaluate(() => window.tState('c6'))));
    console.log('-- tocando con red rapida REALISTA (setTimeout de 6-8ms, no microtarea), muestreando cada 5ms --');
    await page.evaluate(() => window.tTouch('c6'));
    let sawPcTrue = false;
    for (let i = 0; i < 40; i++) {
      const s = await page.evaluate(() => window.tState('c6'));
      if (s.hasPc) sawPcTrue = true;
      if (i < 15 || i % 4 === 0) console.log(`  t+${i * 5}ms: hasPc=${s.hasPc} streamPausedByHide=${s.streamPausedByHide} connGen=${s.connGen}`);
      await sleep(5);
    }
    const final6 = await page.evaluate(() => window.tState('c6'));
    console.log('estado final (200ms tras el toque):', JSON.stringify(final6));
    console.log(`=> CASO 6: this.pc se vio truthy en ALGUN muestreo=${sawPcTrue}; estado final hasPc=${final6.hasPc} streamPausedByHide=${final6.streamPausedByHide}`);
    await page.close();
  }

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
