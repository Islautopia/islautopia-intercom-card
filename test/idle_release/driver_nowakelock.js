// Caso critico: panel de pared SIN Screen Wake Lock API en absoluto (navigator.wakeLock ===
// undefined) - WebView antiguo, o simplemente un navegador que no la implementa. Hasta la version
// que corrige esto, _armIdleWakeLockTimer() (el reloj de inactividad) SOLO se llamaba desde dentro
// de _acquireWakeLock(), que se va por la puerta de atras en la primera linea si no existe
// navigator.wakeLock:
//
//   async _acquireWakeLock() {
//     if (this._wakeLock || !navigator.wakeLock) return;   // <- se va aqui, el reloj nunca se arma
//     ...
//     this._armIdleWakeLockTimer();                        // <- solo se llega aqui con la API presente
//   }
//
// Esto explica por que las tres versiones anteriores (v1.4.0/v1.5.1/v1.6.0) fallaban IDENTICO en
// el panel de pared real: cada una arreglaba lo que el reloj hace al vencer, y el reloj nunca
// llegaba a ponerse en marcha. Este driver mide exactamente ese camino, sin tocar el fichero de
// dist/ - ver driver.js para las instrucciones de arranque (servidor HTTP + playwright-core).
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
  });
  page.on('pageerror', (err) => console.log('[pageerror] ' + err));

  await page.goto(BASE);
  await page.waitForFunction(() => window.TESTLOG && window.TESTLOG.some((l) => l.includes('harness listo')));

  console.log('\n########## CASO 5: SIN Screen Wake Lock API (navigator.wakeLock === undefined) ##########');
  await page.evaluate(() => window.tRemoveWakeLockAPI());
  const wl = await page.evaluate(() => navigator.wakeLock);
  console.log('navigator.wakeLock tras quitarla:', wl);

  await page.evaluate(() => { window.tCreateCard('c5', { idle_release_seconds: 4 }); window.tAttach('c5'); });
  await sleep(300);
  console.log('estado tras conectar (sin wakeLock API):', JSON.stringify(await page.evaluate(() => window.tState('c5'))));

  // Igual que en un panel de pared real: se intenta lo mismo que activaria el reloj (el camino
  // real es entrar en pantalla completa -> _acquireWakeLock()). Con la API ausente, la funcion
  // real hace: `if (this._wakeLock || !navigator.wakeLock) return;` y no llega a
  // _armIdleWakeLockTimer() -- se mide exactamente eso.
  await page.evaluate(() => window.tAcquireWakeLock('c5'));
  console.log('estado tras intentar _acquireWakeLock() sin API disponible:', JSON.stringify(await page.evaluate(() => window.tState('c5'))));

  console.log('Esperando 12s (3x el plazo de 4s) sin tocar nada...');
  await sleep(12000);
  const s5 = await page.evaluate(() => window.tState('c5'));
  console.log('estado tras 12s de quietud total, SIN wake lock API, plazo=4s:', JSON.stringify(s5));
  console.log('CASO 5 -> ' + (s5.hasPc ? 'BUG CONFIRMADO: el video NUNCA se suelta sin Wake Lock API (el reloj no llega a armarse)' : 'se solto igualmente (el arreglo en curso ya cubre este caso)'));

  await page.evaluate(() => window.tDetach('c5'));
  await browser.close();
}

main().catch((err) => { console.error('DRIVER ERROR', err); process.exit(1); });
