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

async function measure(page, id) {
  return page.evaluate((id) => {
    const card = window.__cards[id];
    const content = card.content;
    const feedWrap = card.feedWrap;
    const actionsRow = card.querySelector('.actions-row');
    const hudBottom = card.querySelector('.hud-bottom');
    const statusLine = card.statusLine;
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    return {
      isRail: content.classList.contains('ig-rail'),
      rot: card._rot,
      feedWrap: r(feedWrap),
      actionsRow: r(actionsRow),
      hudBottom: r(hudBottom),
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

// MediaStream de un <canvas> con color+etiqueta, para que el <video> tenga algo real que pintar
// (en vez de quedar negro) y las capturas sean fieles a como se veria con camara real.
async function feedFakeVideo(page, id, label, color) {
  await page.evaluate(({ id, label, color }) => {
    const card = window.__cards[id];
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext('2d');
    function draw() {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
      requestAnimationFrame(draw);
    }
    draw();
    const stream = canvas.captureStream(10);
    card.setupRemoteStream(stream);
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
  await feedFakeVideo(page, id, label, color);
  await sleep(250); // deja asentar el ResizeObserver tras el cambio de aspecto/stream

  const m = await measure(page, id);
  console.log('isRail =', m.isRail, ' rot =', m.rot);
  console.log('feedWrap  =', JSON.stringify(m.feedWrap));
  console.log('actionsRow=', JSON.stringify(m.actionsRow));
  console.log('hudBottom =', JSON.stringify(m.hudBottom));
  console.log('statusLine=', JSON.stringify(m.statusLine));

  const containedActions = within(m.feedWrap, m.actionsRow, 1);
  const containedStatus = within(m.feedWrap, m.statusLine, 1);
  const overlapActionsHud = rectsIntersect(m.actionsRow, m.hudBottom);
  const noVScroll = m.docScrollHeight <= m.innerHeight + 1;

  console.log(`actions-row dentro de feed-wrap: ${containedActions}`);
  console.log(`status-line dentro de feed-wrap: ${containedStatus}`);
  console.log(`actions-row NO solapa hud-bottom: ${!overlapActionsHud}`);
  console.log(`sin scroll vertical (docScrollHeight=${m.docScrollHeight} <= innerHeight=${m.innerHeight}): ${noVScroll}`);

  const outPath = path.join(OUTDIR, screenshotName);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('captura ->', outPath);

  await page.close();
  return { name, m, containedActions, containedStatus, overlapActionsHud, noVScroll };
}

async function positiveControl(browser) {
  console.log('\n========== CONTROL POSITIVO: forzar el solape a proposito ==========');
  const page = await newPage(browser, { width: 1920, height: 1200 });
  const id = 'ctrlpos';
  await page.evaluate((id) => { window.tCreateCard(id, {}); window.tAttach(id); }, id);
  await sleep(200);
  await page.evaluate((id) => { window.__cards[id]._applyRotation(90); }, id);
  await feedFakeVideo(page, id, 'CTRL', '#333333');
  await sleep(250);

  // Control negativo (estado real, sin forzar nada): confirmar que la comprobacion dice "no hay
  // solape" cuando en efecto no lo hay.
  const before = await measure(page, id);
  const overlapBefore = rectsIntersect(before.actionsRow, before.hudBottom);
  console.log('antes de forzar nada, solape detectado =', overlapBefore, '(debe ser false)');

  // Forzar el solape de verdad: mover hud-bottom encima de actions-row con un estilo en linea.
  await page.evaluate((id) => {
    const card = window.__cards[id];
    const hudBottom = card.querySelector('.hud-bottom');
    const actionsRow = card.querySelector('.actions-row');
    const r = actionsRow.getBoundingClientRect();
    hudBottom.style.setProperty('position', 'absolute', 'important');
    hudBottom.style.setProperty('left', '0', 'important');
    hudBottom.style.setProperty('right', '0', 'important');
    hudBottom.style.setProperty('bottom', getComputedStyle(actionsRow).bottom, 'important');
    hudBottom.style.setProperty('top', 'auto', 'important');
  }, id);
  await sleep(50);
  const after = await measure(page, id);
  const overlapAfter = rectsIntersect(after.actionsRow, after.hudBottom);
  console.log('actionsRow=', JSON.stringify(after.actionsRow));
  console.log('hudBottom (forzado)=', JSON.stringify(after.hudBottom));
  console.log('tras forzar el solape, solape detectado =', overlapAfter, '(debe ser true)');

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
    console.log(`${r.name}: isRail=${r.m.isRail} contained_actions=${r.containedActions} contained_status=${r.containedStatus} no_overlap_hud=${!r.overlapActionsHud} no_vscroll=${r.noVScroll}`);
  }

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
