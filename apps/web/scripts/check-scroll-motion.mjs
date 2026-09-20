import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:3001';
const output = process.env.MOTION_EVIDENCE_DIR;
if (output) fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference',
    ...(output ? { recordVideo: { dir: output, size: { width: 1440, height: 900 } } } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/_next/static/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ready=true]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const results = [];
  const demo = await page.locator('#demo').evaluate(el => {
    const spacer = el.parentElement;
    return { top: spacer.getBoundingClientRect().top + scrollY, distance: innerHeight * 3.5 };
  });
  const stages = [];
  for (const progress of [.3, .52, .67, .79]) {
    await page.evaluate(y => scrollTo(0, y), demo.top + progress * demo.distance);
    await page.waitForTimeout(1800);
    stages.push(await page.locator('#demo').getAttribute('data-demo-scene'));
  }
  assert.deepEqual(stages, ['0', '1', '2', '3'], 'Scroll drives all recovery stages');
  const controls = await page.locator('.olus-demo-controls').boundingBox();
  assert.ok(controls.y > 88 && controls.y + controls.height <= 901, 'Controls stay below navigation and inside viewport');
  for (const button of await page.locator('.olus-demo-controls button,.olus-demo-controls a').all()) {
    assert.ok(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Demo action is not covered by another element');
  }
  results.push({ section: 'demo', stages, controls });

  for (const [section, target] of [['#highlights', '[data-progress]'], ['#technology', '[data-tech-image]'], ['#decisions', '[data-fly-plane]']]) {
    const bounds = await page.locator(section).evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height }));
    const matrices = [];
    for (const progress of [0.2, 0.7]) {
      await page.evaluate(y => scrollTo(0, y), bounds.top + bounds.height * progress - 450);
      await page.waitForTimeout(1800);
      matrices.push(await page.locator(`${section} ${target}`).evaluate(el => getComputedStyle(el).transform));
    }
    assert.notEqual(matrices[0], matrices[1], `${section}: scroll-linked transform must change`);
    results.push({ section, matrices });
  }
  // A late laptop pin must not leave the gallery measured against the unpinned document.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-ready=true]').waitFor();
  await page.waitForTimeout(4500);
  const gallery = await page.locator('#highlights').evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height }));
  await page.evaluate(y => scrollTo(0, y), gallery.top + gallery.height * .2 - 450);
  await page.waitForTimeout(1800);
  const scale = await page.locator('#highlights [data-progress]').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
  assert.ok(scale > 0 && scale < .4, `Restored gallery starts too early: progress ${scale}`);
  results.push({ section: 'restored gallery', scale });
  assert.deepEqual(errors, [], 'No runtime or static-chunk failures');
  console.log(JSON.stringify({ url, passed: true, results }, null, 2));
  if (output) fs.writeFileSync(`${output}/result.json`, JSON.stringify({ url, results, errors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
