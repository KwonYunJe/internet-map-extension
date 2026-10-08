// Visual redesign contract tests for the Internet Map UI.
// Uses synthetic records only and never reads or writes extension storage.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');

const ROOT = path.resolve(process.env.MAP_APP_ROOT || path.resolve(__dirname, '..'));
const SCREENSHOT_DIR =
  process.env.MAP_SCREENSHOT_DIR ||
  path.join(ROOT, 'test-results', 'ui-redesign');

function svgIcon(domain, index) {
  const colors = [
    '#ff6b81', '#5ad8ff', '#8b83ff', '#ffd166', '#39d98a',
    '#f78fb3', '#4dabf7', '#c77dff', '#ff9f43', '#00d2d3',
    '#ef476f', '#118ab2', '#06d6a0', '#f4a261', '#a29bfe'
  ];
  const color = colors[index % colors.length];
  const letter = domain.slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect width="32" height="32" rx="8" fill="${color}"/>
    <text x="16" y="21" text-anchor="middle" font-size="16" font-family="Arial" font-weight="700" fill="#061027">${letter}</text>
  </svg>`;
}

function makeSessions() {
  const domains = [
    'alpha.test', 'beta.test', 'gamma.test', 'delta.test', 'epsilon.test',
    'zeta.test', 'eta.test', 'theta.test', 'iota.test', 'kappa.test',
    'lambda.test', 'mu.test', 'nu.test', 'xi.test', 'omicron.test'
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = Math.max(today.getTime(), Date.now() - 2 * 60 * 60 * 1000);
  const sessions = [];

  domains.forEach((domain, index) => {
    const visits = index < 5 ? 3 : 1;
    for (let visit = 0; visit < visits; visit += 1) {
      const startedAt = start + (index * 17 + visit * 7) * 60 * 1000;
      sessions.push({
        domain,
        pageUrl: `https://${domain}/page-${visit}`,
        faviconPageUrl: `https://${domain}/`,
        startedAt,
        endedAt: startedAt + (180 + (domains.length - index) * 25 + visit * 10) * 1000,
        duration: (180 + (domains.length - index) * 25 + visit * 10) * 1000,
        fromDomain: index === 0 && visit === 0 ? null : domains[(index + domains.length - 1) % domains.length]
      });
    }
  });

  sessions.push(
    {
      domain: 'alpha.test',
      pageUrl: 'https://alpha.test/return',
      faviconPageUrl: 'https://alpha.test/',
      startedAt: start + 5 * 60 * 60 * 1000,
      endedAt: start + 5 * 60 * 60 * 1000 + 210000,
      duration: 210000,
      fromDomain: 'beta.test'
    },
    {
      domain: 'beta.test',
      pageUrl: 'https://beta.test/return',
      faviconPageUrl: 'https://beta.test/',
      startedAt: start + 5 * 60 * 60 * 1000 + 240000,
      endedAt: start + 5 * 60 * 60 * 1000 + 450000,
      duration: 210000,
      fromDomain: 'alpha.test'
    }
  );

  return sessions;
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = path.join(ROOT, url.pathname);
      if (!file.startsWith(ROOT + path.sep)) throw new Error('Invalid path');
      const type = file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.png') ? 'image/png'
        : 'text/html';
      res.setHeader('Content-Type', type);
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/_favicon/**', route => {
    const url = new URL(route.request().url());
    const pageUrl = url.searchParams.get('pageUrl') || '';
    const domain = new URL(pageUrl || 'https://fallback.test').hostname;
    const index = Math.abs([...domain].reduce((sum, char) => sum + char.charCodeAt(0), 0));
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgIcon(domain, index) });
  });
  await page.addInitScript(sessions => {
    window.fixtureSessions = sessions;
    window.chrome = { runtime: {
      getURL: value => new URL('/' + value, location.origin).href,
      sendMessage(message, callback) {
        const response = { sessions: window.fixtureSessions.filter(session =>
          !message.range ||
          message.range.start == null ||
          (session.endedAt > message.range.start && session.startedAt < message.range.end)
        ) };
        if (message.type === 'GET_TRACKING_STATUS') callback({ enabled: true });
        else if (message.type === 'EXPORT_SESSIONS') callback({ sessions: window.fixtureSessions });
        else callback(response);
      }
    }};
  }, makeSessions());
  await page.goto(`http://127.0.0.1:${port}/visualization/visualization.html`);
  await page.waitForSelector('.node-group');
  await page.waitForSelector('.ranking-item');
  return { page, errors };
}

async function settleViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function assertScreenshotWidth(buffer, width, label) {
  const png = PNG.sync.read(buffer);
  assert.equal(png.width, width, `${label} screenshot width must match viewport`);
}

(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const { page, errors } = await openPage(browser, server.address().port);

    if (process.env.MAP_CAPTURE_BASELINE === '1') {
      await page.locator('[data-period="all"]').click();
      await page.waitForFunction(() =>
        document.querySelector('[data-period="all"]').getAttribute('aria-pressed') === 'true'
      );
      await settleViewport(page, 1440, 900);
      const baseline = await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'baseline-desktop.png'), fullPage: true });
      assertScreenshotWidth(baseline, 1440, 'baseline desktop');
      assert.deepEqual(errors, []);
      console.log('PASS redesign baseline: desktop screenshot');
      return;
    }

    assert((await page.locator('#pageHeader h1').textContent()).includes('Internet Map'));
    assert((await page.locator('.header-copy p').textContent()).includes('나의 인터넷 우주'));
    assert(await page.locator('.header-logo').isVisible());
    assert.equal((await page.locator('.period-filter-button[aria-pressed="true"]').textContent()).trim(), '오늘');
    await page.locator('[data-period="all"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-period="all"]').getAttribute('aria-pressed') === 'true'
    );
    await page.waitForFunction(() => document.querySelectorAll('.node-group').length >= 10);

    assert(await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.node-group')];
      const bubbles = groups.map(group => group.querySelector('.node-bubble')?.getAttribute('href') || '');
      const variants = new Set(bubbles.map(href => href.match(/soap-bubble-0[1-5]\.png/)?.[0]).filter(Boolean));
      const ordered = groups.every(group => {
        const children = [...group.children];
        const hoverGlow = children.indexOf(group.querySelector('.node-hover-glow'));
        const favicon = children.indexOf(group.querySelector('.node-favicon'));
        const bubble = children.indexOf(group.querySelector('.node-bubble'));
        const label = children.indexOf(group.querySelector('.node-label'));
        return hoverGlow > -1 && favicon > hoverGlow && bubble > favicon && label > bubble;
      });
      return groups.length >= 10 &&
        variants.size >= 3 &&
        bubbles.every(href => /soap-bubble-0[1-5]\.png/.test(href)) &&
        ordered;
    }), 'Nodes must use layered favicon-under-bubble rendering with multiple bubble variants');

    assert(await page.evaluate(() => {
      const ranking = document.querySelector('.ranking-item');
      const favicon = ranking?.querySelector('img, image, .ranking-favicon');
      const bar = ranking?.querySelector('.ranking-bar-fill');
      return Boolean(favicon) && bar && parseFloat(getComputedStyle(bar).width) > 0;
    }), 'Ranking rows must show favicon identity and usage bars');

    assert(await page.evaluate(() => {
      const pair = [...document.querySelectorAll('.edge-pair')]
        .find(group => {
          const paths = [...group.querySelectorAll('path.edge-ribbon[data-direction], path.edge-line, path.edge-direction, path.edge-taper')];
          return paths.filter(path => path.getAttribute('d')).length >= 2;
        });
      if (!pair) return false;
      const paths = [...pair.querySelectorAll('path.edge-ribbon[data-direction], path.edge-line, path.edge-direction, path.edge-taper')];
      const descriptions = paths.map(path => path.getAttribute('d') || '').filter(Boolean);
      return descriptions.length >= 2 && new Set(descriptions).size >= 2;
    }), 'Bidirectional navigation must render as separate directional edge paths');

    await settleViewport(page, 1440, 900);
    assert(await page.evaluate(() =>
      [...document.querySelectorAll('.node-lens-layer > g')]
        .every(lens => getComputedStyle(lens).display === 'none') &&
      [...document.querySelectorAll('.edge-ribbon')]
        .every(edge => getComputedStyle(edge).filter === 'none')
    ), 'Overview must avoid live lens rasterization and edge filters');
    const overviewScreenshot = await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'redesign-overview.png'),
      fullPage: true
    });
    assertScreenshotWidth(overviewScreenshot, 1440, 'overview desktop');

    await page.locator('.ranking-item').first().click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.node-lens-layer > g')]
        .filter(lens => getComputedStyle(lens).display !== 'none').length === 1
    );
    assert(await page.evaluate(() => {
      const highlighted = [...document.querySelectorAll('.edge-highlight')];
      if (!highlighted.length) return false;
      const oldGlueVisible = [...document.querySelectorAll('.edge-glass, .edge-glass-shadow')]
        .some(element => getComputedStyle(element).display !== 'none');
      const visibleDirectional = highlighted.some(group =>
        [...group.querySelectorAll('.edge-ribbon[data-direction], .edge-line, .edge-direction, .edge-taper')]
          .some(path => getComputedStyle(path).display !== 'none')
      );
      return visibleDirectional && !oldGlueVisible;
    }), 'Selection must brighten directional edges without enabling glue bridge elements');

    for (const [width, height] of [[1440, 900], [1100, 620], [1024, 768], [390, 844]]) {
      await settleViewport(page, width, height);
      assert(await page.evaluate(() => {
        const graph = document.querySelector('#graphPane').getBoundingClientRect();
        const detail = document.querySelector('#detail').getBoundingClientRect();
        const ranking = document.querySelector('#ranking').getBoundingClientRect();
        const desktop = innerWidth >= 1100;
        const tablet = innerWidth >= 700 && innerWidth < 1100;
        const mobile = innerWidth < 700;
        const noHorizontalOverflow =
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.body.scrollWidth <= innerWidth + 1;
        const desktopFit = !desktop || (
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          Math.abs(graph.top - detail.top) < 2 &&
          Math.abs(graph.bottom - ranking.bottom) < 2
        );
        const tabletOrder = !tablet || (graph.bottom <= detail.top + 1 && graph.bottom <= ranking.top + 1);
        const mobileOrder = !mobile || (graph.bottom <= detail.top + 1 && detail.bottom <= ranking.top + 1);
        const boundedMobile = !mobile || document.documentElement.scrollHeight < 2600;
        return noHorizontalOverflow && desktopFit && tabletOrder && mobileOrder && boundedMobile;
      }), `Responsive layout contract at ${width}x${height}`);
      assertScreenshotWidth(
        await page.screenshot({ fullPage: true }),
        width,
        `${width}x${height}`
      );
    }

    await settleViewport(page, 1440, 900);
    const desktopScreenshot = await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'redesign-desktop.png'), fullPage: true });
    assertScreenshotWidth(desktopScreenshot, 1440, 'selected desktop');
    await settleViewport(page, 390, 844);
    const mobileScreenshot = await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'redesign-mobile.png'), fullPage: true });
    assertScreenshotWidth(mobileScreenshot, 390, 'selected mobile');

    assert.deepEqual(errors, []);
    console.log('PASS redesign UI: header, bubble variants, ranking favicons, directional edges, responsive layout, screenshots');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
