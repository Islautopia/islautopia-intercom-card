// Comprobacion manual (no forma parte del banco permanente) de que los botones de accion +
// linea de estado quedan DENTRO del marco de video y NO se solapan con el HUD inferior-derecho,
// en modo normal (card embebida, no pantalla completa), en las 4 combinaciones
// dispositivo x orientacion que pidio Iñaki. Carga el fichero REAL de dist/ vía el arnes de red
// doblada existente (test/idle_release_network/harness.js) solo para tener tCreateCard/tAttach
// y un hass falso -- ninguna logica de la card se sustituye.
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:\\Users\\inaki\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8793/test/_manual_overlay_check/index.html';
const OUTDIR = process.env.OUT_DIR || 'C:\\Users\\inaki\\AppData\\Local\\Temp\\claude\\c--Proyectos-espressif-IG-Doorbell\\d628b33a-426b-4168-adc6-51a203bb47b4\\scratchpad';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function rectsIntersect(a, b) {
  // Interseccion vacia si un rectangulo esta totalmente a un lado del otro en cualquier eje.
  const noOverlap = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  return !noOverlap;
}

// NOTA IMPORTANTE (encontrada midiendo, no prevista al escribir esto): tanto .actions-row como
// .hud-bottom se declaran con `left:0(o 14px);right:0(o 14px)` -- son contenedores flex a
// proposito de ANCHO COMPLETO (para poder centrar/anclar sus hijos), con pointer-events:none en
// el propio contenedor y :auto solo en los hijos reales. Comparar getBoundingClientRect() de
// esos DOS contenedores entre si SIEMPRE da interseccion nada mas compartan banda vertical,
// pase lo que pase horizontalmente -- no mide un solape real, mide que los dos son anchos.
// La comprobacion que SI significa algo es contra los hijos visibles: los botones circulares
// (.action) de un lado y el cluster real de controles (.hud-bottom-right) del otro. Se reportan
// ambas para que quede constancia de la diferencia.
async function measure(page, id) {
  return page.evaluate((id) => {
    const card = window.__cards[id];
    const content = card.content;
    const feedWrap = card.feedWrap;
    const actionsRow = card.querySelector('.actions-row');
    const hudBottom = card.querySelector('.hud-bottom');
    const hudBottomRight = card.querySelector('.hud-bottom-right');
    const statusLine = card.statusLine;
    const actions = Array.from(card.querySelectorAll('.actions-row .action'));
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    // Union de los rects de los botones reales (mic + puerta).
    const actionRects = actions.map(r);
    const actionsUnion = actionRects.reduce((u, b) => u ? {
      left: Math.min(u.left, b.left), right: Math.max(u.right, b.right),
      top: Math.min(u.top, b.top), bottom: Math.max(u.bottom, b.bottom),
    } : b, null);
    return {
      isRail: content.classList.contains('ig-rail'),
      rot: card._rot,
      feedWrap: r(feedWrap),
      actionsRowContainer: r(actionsRow),
      actionsUnion,
      hudBottomContainer: r(hudBottom),
      hudBottomRight: r(hudBottomRight),
      statusLine: r(statusLine),
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    };
  }, id);
}

function within(outer, inner, tol) {
  return inner.left >= outer.left - tol && inner.right <= outer.right + tol
    && inner.top >= outer.top - tol && inner.bottom <= outer.bottom + tol;
}

// NOTA (encontrada probando, no prevista): un <canvas> real via captureStream() + object-fit:
// contain expone que _layoutRotation() calcula el ajuste de aspecto sobre la caja PRE-rotacion
// (eso es asunto de _layoutRotation, no de este overlay) -- con un canvas 480x270 el contenido
// visible queda como una tira estrecha tras rotar 90 grados, que NO es representativo de una
// camara real y solo confundiria la captura. Como lo que este banco mide es la GEOMETRIA de
// botones/HUD (con getBoundingClientRect, independiente del contenido del video), se pinta
// directamente el fondo de .video-wrapper en vez de pasar por setupRemoteStream()+<canvas> --
// visualmente mas fiel para esta captura, y no cambia ninguna medida.
//
// El color se pinta en el <video> MISMO, no en .video-wrapper (que siempre es 100% de
// feed-wrap): asi se respeta el hueco que _layoutRotation() ya reservo para el carril (el propio
// elemento <video> mide menos ancho que el marco cuando hay carril), en vez de tapar ese hueco
// con "video" de borde a borde -- que ocultaria justo la banda negra que el carril aprovecha.
async function fakeLiveVisual(page, id, label, color) {
  await page.evaluate(({ id, label, color }) => {
    const card = window.__cards[id];
    card._setLiveState('live');
    card.feedWrap.dataset.state = 'live';
    card.intercomButton.removeAttribute('disabled');
    if (card.unlockButton) card.unlockButton.removeAttribute('disabled');
    if (card.loader) { card.loader.style.opacity = '0'; card.loader.style.pointerEvents = 'none'; }
    card.videoEl.style.background = color;
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:#fff; font:bold 24px sans-serif; opacity:0.5; z-index:1; pointer-events:none;';
    card.querySelector('.video-wrapper').appendChild(lbl);
  }, { id, label, color });
}

async function newPage(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));
  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));
  return page;
}

async function runScenario(browser, { name, viewport, rot, label, color, screenshotName }) {
  console.log(`\n========== ${name} (viewport ${viewport.width}x${viewport.height}, rot=${rot}) ==========`);
  const page = await newPage(browser, viewport);
  const id = name.replace(/[^a-z0-9]/gi, '_');
  await page.evaluate((id) => {
    window.tCreateCard(id, {});
    window.tAttach(id);
  }, id);
  await sleep(200);
  await page.evaluate(({ id, rot }) => { window.__cards[id]._applyRotation(rot); }, { id, rot });
  await fakeLiveVisual(page, id, label, color);
  await sleep(250); // deja asentar el ResizeObserver tras el cambio de aspecto/stream

  const m = await measure(page, id);
  console.log('isRail =', m.isRail, ' rot =', m.rot);
  console.log('feedWrap          =', JSON.stringify(m.feedWrap));
  console.log('actionsRow (caja) =', JSON.stringify(m.actionsRowContainer), '<- contenedor ancho completo, ver nota');
  console.log('actionsUnion(real)=', JSON.stringify(m.actionsUnion), '<- union de los 2 botones reales');
  console.log('hudBottom (caja)  =', JSON.stringify(m.hudBottomContainer), '<- contenedor ancho completo, ver nota');
  console.log('hudBottomRight    =', JSON.stringify(m.hudBottomRight), '<- cluster real (volumen/calidad/fs)');
  console.log('statusLine        =', JSON.stringify(m.statusLine));

  const containedActions = within(m.feedWrap, m.actionsUnion, 1);
  const containedStatus = within(m.feedWrap, m.statusLine, 1);
  const overlapContainers = rectsIntersect(m.actionsRowContainer, m.hudBottomContainer);
  const overlapReal = rectsIntersect(m.actionsUnion, m.hudBottomRight);
  const noVScroll = m.docScrollHeight <= m.innerHeight + 1;

  console.log(`botones dentro de feed-wrap: ${containedActions}`);
  console.log(`status-line dentro de feed-wrap: ${containedStatus}`);
  console.log(`(informativo, no concluyente) cajas .actions-row/.hud-bottom solapan: ${overlapContainers}`);
  console.log(`SOLAPE REAL (botones vs cluster visible del HUD): ${overlapReal} (debe ser false)`);
  console.log(`sin scroll vertical (docScrollHeight=${m.docScrollHeight} <= innerHeight=${m.innerHeight}): ${noVScroll}`);

  const outPath = path.join(OUTDIR, screenshotName);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('captura ->', outPath);

  await page.close();
  return { name, m, containedActions, containedStatus, overlapReal, noVScroll };
}

async function positiveControl(browser) {
  console.log('\n========== CONTROL POSITIVO: forzar el solape a proposito ==========');
  const page = await newPage(browser, { width: 1920, height: 1200 });
  const id = 'ctrlpos';
  await page.evaluate((id) => { window.tCreateCard(id, {}); window.tAttach(id); }, id);
  await sleep(200);
  await page.evaluate((id) => { window.__cards[id]._applyRotation(90); }, id);
  await fakeLiveVisual(page, id, "CTRL", "#333333");
  await sleep(250);

  // Control negativo (estado real, sin forzar nada): confirmar que la comprobacion dice "no hay
  // solape" cuando en efecto no lo hay -- usando la misma metrica REAL (botones vs cluster
  // visible) que se usara en los 4 escenarios, no la caja completa (ver nota en measure()).
  const before = await measure(page, id);
  const overlapBefore = rectsIntersect(before.actionsUnion, before.hudBottomRight);
  console.log('antes de forzar nada, solape (real) detectado =', overlapBefore, '(debe ser false)');

  // Forzar el solape DE VERDAD: mover .hud-bottom-right (el cluster visible) a `position:fixed`
  // con las coordenadas EXACTAS (en viewport) del boton mic real, medidas un instante antes. Con
  // fixed + coordenadas en px no hay ambiguedad de "auto" ni de contenedor de posicionamiento.
  await page.evaluate((id) => {
    const card = window.__cards[id];
    const hudBottomRight = card.querySelector('.hud-bottom-right');
    const micBtn = card.querySelector('#intercom-button');
    const r = micBtn.getBoundingClientRect();
    hudBottomRight.style.setProperty('position', 'fixed', 'important');
    hudBottomRight.style.setProperty('left', r.left + 'px', 'important');
    hudBottomRight.style.setProperty('top', r.top + 'px', 'important');
    hudBottomRight.style.setProperty('right', 'auto', 'important');
    hudBottomRight.style.setProperty('bottom', 'auto', 'important');
    hudBottomRight.style.setProperty('margin', '0', 'important');
    hudBottomRight.style.setProperty('z-index', '999', 'important');
  }, id);
  await sleep(50);
  const after = await measure(page, id);
  const overlapAfter = rectsIntersect(after.actionsUnion, after.hudBottomRight);
  console.log('actionsUnion=', JSON.stringify(after.actionsUnion));
  console.log('hudBottomRight (forzado encima del boton mic)=', JSON.stringify(after.hudBottomRight));
  console.log('tras forzar el solape, solape (real) detectado =', overlapAfter, '(debe ser true)');

  const veredicto = (overlapBefore === false && overlapAfter === true)
    ? 'CONTROL POSITIVO OK: la comprobacion distingue solape de no-solape'
    : 'CONTROL INVALIDO: la comprobacion no distingue -- no fiarse del resto de resultados';
  console.log('=>', veredicto);
  await page.close();
  return { overlapBefore, overlapAfter, veredicto };
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });

  const ctrl = await positiveControl(browser);

  const results = [];
  results.push(await runScenario(browser, {
    name: '1_tablet_apaisada_video_vertical (WALLPANEL REAL)',
    viewport: { width: 1920, height: 1200 },
    rot: 90, label: 'VERTICAL', color: '#1565C0',
    screenshotName: 'overlay_1_tablet_landscape_video_vertical.png',
  }));
  results.push(await runScenario(browser, {
    name: '2_tablet_apaisada_video_apaisado',
    viewport: { width: 1920, height: 1200 },
    rot: 0, label: 'LANDSCAPE', color: '#2e7d32',
    screenshotName: 'overlay_2_tablet_landscape_video_landscape.png',
  }));
  results.push(await runScenario(browser, {
    name: '3_movil_vertical',
    viewport: { width: 400, height: 850 },
    rot: 90, label: 'VERTICAL', color: '#1565C0',
    screenshotName: 'overlay_3_movil_vertical.png',
  }));
  results.push(await runScenario(browser, {
    name: '4_tablet_vertical_video_vertical',
    viewport: { width: 900, height: 1600 },
    rot: 90, label: 'VERTICAL', color: '#1565C0',
    screenshotName: 'overlay_4_tablet_vertical_video_vertical.png',
  }));

  console.log('\n\n================ RESUMEN ================');
  console.log('control positivo:', ctrl.veredicto);
  for (const r of results) {
    console.log(`${r.name}: isRail=${r.m.isRail} contained_actions=${r.containedActions} contained_status=${r.containedStatus} no_overlap_real=${!r.overlapReal} no_vscroll=${r.noVScroll}`);
  }

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
