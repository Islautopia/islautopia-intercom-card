// Comprobacion manual (no forma parte del banco permanente) de que el carril lateral se elige por
// GEOMETRIA REAL DEL CONTENIDO (no por si hay rotacion de software), tras el fallo medido en el
// Galaxy Tab real de Iñaki 2026-09-08: con el stream ya vertical desde el sensor (_rot=0, sin
// rotacion), `vertical = (_rot===90||270)` daba false y el carril ni se evaluaba -- banda inferior
// tapando imagen en modo normal Y en pantalla completa, justo donde mas bandas negras vacias habia.
//
// Carga el fichero REAL de dist/ via el arnes de red doblada existente
// (test/idle_release_network/harness.js) solo para tener tCreateCard/tAttach y un hass falso --
// ninguna logica de la card se sustituye.
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:\\Users\\inaki\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8794/test/_manual_overlay_check/index.html';
const OUTDIR = process.env.OUT_DIR || 'C:\\Users\\inaki\\AppData\\Local\\Temp\\claude\\c--Proyectos-espressif-IG-Doorbell\\d628b33a-426b-4168-adc6-51a203bb47b4\\scratchpad';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function rectsIntersect(a, b) {
  const noOverlap = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  return !noOverlap;
}

// NOTA IMPORTANTE (encontrada midiendo, no prevista al escribir esto): tanto .actions-row como
// .hud-bottom se declaran con `left:0(o 14px);right:0(o 14px)` -- son contenedores flex a
// proposito de ANCHO COMPLETO, con pointer-events:none en el propio contenedor y :auto solo en
// los hijos reales. Comparar getBoundingClientRect() de esos DOS contenedores entre si SIEMPRE da
// interseccion nada mas compartan banda vertical, pase lo que pase horizontalmente -- no mide un
// solape real. La comprobacion que SI significa algo es contra los hijos visibles: los botones
// circulares (.action) de un lado y el cluster real de controles (.hud-bottom-right) del otro.
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
    const actionRects = actions.map(r);
    const actionsUnion = actionRects.reduce((u, b) => u ? {
      left: Math.min(u.left, b.left), right: Math.max(u.right, b.right),
      top: Math.min(u.top, b.top), bottom: Math.max(u.bottom, b.bottom),
    } : b, null);
    return {
      isRail: content.classList.contains('ig-rail'),
      rot: card._rot,
      videoWidth: card.videoEl.videoWidth,
      videoHeight: card.videoEl.videoHeight,
      feedWrap: r(feedWrap),
      actionsUnion,
      hudBottomRight: r(hudBottomRight),
      statusLine: r(statusLine),
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  }, id);
}

function within(outer, inner, tol) {
  return inner.left >= outer.left - tol && inner.right <= outer.right + tol
    && inner.top >= outer.top - tol && inner.bottom <= outer.bottom + tol;
}

// Video REAL (canvas -> captureStream() -> setupRemoteStream()), con las dimensiones RAW que se
// le pidan -- ahora que el carril depende de videoWidth/videoHeight de verdad, hace falta que el
// <video> tenga metadatos reales, no un color pintado a mano. Se espera a 'loadedmetadata' antes
// de medir: es justo el evento que el fix añadio para no quedarse en banda para siempre.
async function feedRealVideo(page, id, { rawW, rawH, label, color }) {
  await page.evaluate(({ id, rawW, rawH, label, color }) => {
    const card = window.__cards[id];
    card._setLiveState('live');
    card.feedWrap.dataset.state = 'live';
    card.intercomButton.removeAttribute('disabled');
    if (card.unlockButton) card.unlockButton.removeAttribute('disabled');
    if (card.loader) { card.loader.style.opacity = '0'; card.loader.style.pointerEvents = 'none'; }
    const canvas = document.createElement('canvas');
    canvas.width = rawW; canvas.height = rawH;
    const ctx = canvas.getContext('2d');
    function draw() {
      ctx.fillStyle = color; ctx.fillRect(0, 0, rawW, rawH);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(4, rawW * 0.01);
      ctx.strokeRect(4, 4, rawW - 8, rawH - 8);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(rawW * 0.07)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, rawW / 2, rawH / 2);
      requestAnimationFrame(draw);
    }
    draw();
    const stream = canvas.captureStream(10);
    card.setupRemoteStream(stream);
  }, { id, rawW, rawH, label, color });
  await page.waitForFunction((id) => {
    const v = window.__cards[id].videoEl;
    return v.videoWidth > 0 && v.videoHeight > 0;
  }, id, { timeout: 5000 });
}

async function newPage(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));
  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));
  return page;
}

async function runScenario(browser, { name, viewport, rot, rawW, rawH, label, color, forceFs, screenshotName }) {
  console.log(`\n========== ${name} (viewport ${viewport.width}x${viewport.height}, rot=${rot}, raw=${rawW}x${rawH}${forceFs ? ', FULLSCREEN forzado' : ''}) ==========`);
  const page = await newPage(browser, viewport);
  const id = name.replace(/[^a-z0-9]/gi, '_');
  await page.evaluate((id) => { window.tCreateCard(id, {}); window.tAttach(id); }, id);
  await sleep(150);
  await page.evaluate(({ id, rot }) => { window.__cards[id]._applyRotation(rot); }, { id, rot });
  await feedRealVideo(page, id, { rawW, rawH, label, color });
  await sleep(150); // deja asentar el ResizeObserver/loadedmetadata

  if (forceFs) {
    // Nivel 2 (respaldo propio, position:fixed) sin pasar por la API real de Fullscreen -- no
    // dispara sin gesto de usuario en un test automatizado. _applyFullscreenUI() es la MISMA
    // funcion que usa el camino real para pintar la UI (clases, atributo data-fs, y ella misma
    // llama a _layoutRotation()).
    await page.evaluate((id) => {
      const card = window.__cards[id];
      card._fsNative = false;
      card._fsActive = true;
      card._applyFullscreenUI();
    }, id);
    await sleep(150);
  }

  const m = await measure(page, id);
  console.log('isRail =', m.isRail, ' rot =', m.rot, ' videoWidth/Height =', m.videoWidth, 'x', m.videoHeight);
  console.log('feedWrap       =', JSON.stringify(m.feedWrap));
  console.log('actionsUnion   =', JSON.stringify(m.actionsUnion));
  console.log('hudBottomRight =', JSON.stringify(m.hudBottomRight));
  console.log('statusLine     =', JSON.stringify(m.statusLine));

  const containedActions = within(m.feedWrap, m.actionsUnion, 1);
  const containedStatus = within(m.feedWrap, m.statusLine, 1);
  const overlapReal = rectsIntersect(m.actionsUnion, m.hudBottomRight);
  const noVScroll = forceFs ? true : (m.docScrollHeight <= m.innerHeight + 1); // en fs forzado el body-lock cambia el layout de la pagina de prueba, no es lo que se mide aqui

  console.log(`botones dentro de feed-wrap: ${containedActions}`);
  console.log(`status-line dentro de feed-wrap: ${containedStatus}`);
  console.log(`SOLAPE REAL (botones vs cluster visible del HUD): ${overlapReal} (debe ser false)`);
  if (!forceFs) console.log(`sin scroll vertical (docScrollHeight=${m.docScrollHeight} <= innerHeight=${m.innerHeight}): ${noVScroll}`);

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
  await sleep(150);
  await page.evaluate((id) => { window.__cards[id]._applyRotation(0); }, id);
  await feedRealVideo(page, id, { rawW: 720, rawH: 1280, label: 'CTRL', color: '#333333' });
  await sleep(150);

  const before = await measure(page, id);
  const overlapBefore = rectsIntersect(before.actionsUnion, before.hudBottomRight);
  console.log('antes de forzar nada, solape (real) detectado =', overlapBefore, '(debe ser false)');

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

  // ============ MATRIZ 2x2, TODA CON _rot=0 (SIN rotacion de software) ============
  // Este es el caso real de Iñaki: el sensor ya entrega vertical, nada que rotar con CSS.

  results.push(await runScenario(browser, {
    name: '1_tablet_apaisada_video_vertical_SIN_ROTACION (EL CASO QUE FALLABA)',
    viewport: { width: 1920, height: 1200 }, rot: 0, rawW: 720, rawH: 1280,
    label: 'VERTICAL rot=0', color: '#1565C0',
    screenshotName: 'v2_1_tablet_landscape_video_vertical_rot0.png',
  }));
  results.push(await runScenario(browser, {
    name: '2_tablet_apaisada_video_apaisado',
    viewport: { width: 1920, height: 1200 }, rot: 0, rawW: 1280, rawH: 720,
    label: 'LANDSCAPE', color: '#2e7d32',
    screenshotName: 'v2_2_tablet_landscape_video_landscape.png',
  }));
  results.push(await runScenario(browser, {
    name: '3_movil_vertical_video_vertical_SIN_ROTACION (CASO LIMITE: no debe dar carril)',
    viewport: { width: 400, height: 850 }, rot: 0, rawW: 720, rawH: 1280,
    label: 'VERTICAL rot=0', color: '#1565C0',
    screenshotName: 'v2_3_movil_vertical_rot0.png',
  }));
  results.push(await runScenario(browser, {
    name: '4_tablet_vertical_video_vertical_SIN_ROTACION',
    viewport: { width: 900, height: 1600 }, rot: 0, rawW: 720, rawH: 1280,
    label: 'VERTICAL rot=0', color: '#1565C0',
    screenshotName: 'v2_4_tablet_vertical_video_vertical_rot0.png',
  }));

  // ============ REGRESION: el caso que YA funcionaba (con rotacion de software) ============
  results.push(await runScenario(browser, {
    name: '5_REGRESION_tablet_apaisada_video_vertical_CON_ROTACION_90',
    viewport: { width: 1920, height: 1200 }, rot: 90, rawW: 1280, rawH: 720,
    label: 'VERTICAL rot=90', color: '#6A1B9A',
    screenshotName: 'v2_5_regresion_rot90.png',
  }));

  // ============ PANTALLA COMPLETA con el caso que fallaba (donde Iñaki lo vio peor) ============
  results.push(await runScenario(browser, {
    name: '6_FULLSCREEN_video_vertical_SIN_ROTACION',
    viewport: { width: 1920, height: 1200 }, rot: 0, rawW: 720, rawH: 1280,
    label: 'VERTICAL rot=0 FS', color: '#1565C0', forceFs: true,
    screenshotName: 'v2_6_fullscreen_video_vertical_rot0.png',
  }));

  console.log('\n\n================ RESUMEN ================');
  console.log('control positivo:', ctrl.veredicto);
  for (const r of results) {
    console.log(`${r.name}: isRail=${r.m.isRail} contained_actions=${r.containedActions} contained_status=${r.containedStatus} no_overlap_real=${!r.overlapReal} no_vscroll=${r.noVScroll}`);
  }

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
