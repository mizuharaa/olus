import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://localhost:3001/');
 await page.waitForTimeout(3500);
 assert.match(await page.locator('[data-fly-plane] img').getAttribute('src'),/aircraft-top/);
 async function at(selector, viewportFraction) {
  await page.locator(selector).evaluate((el,f)=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight*f),viewportFraction);
  await page.waitForTimeout(1200);
  return Number(await page.locator(selector).evaluate(el=>getComputedStyle(el).opacity));
 }
 const headingBefore=await at('#sky-title',.4);
 await page.locator('#sky-title').evaluate(el=>window.scrollTo(0,el.closest('section').getBoundingClientRect().top+scrollY+innerHeight*.5));
 await page.waitForTimeout(1200);
 const headingAfter=Number(await page.locator('#sky-title').evaluate(el=>getComputedStyle(el).opacity));
 assert(headingBefore>.9 && headingAfter<.1,`${headingBefore} -> ${headingAfter}`);
 const line='[data-beat]:first-of-type';
 const before=await at(line,.98), after=await at(line,.6);
 assert(before<.1 && after>.9,`${before} -> ${after}`);
 assert(await at(line,.98)<.1,'Reverse scroll restores the hidden start');
 await at(line,.6);
 await page.screenshot({path:'../../docs/verification/sky-fade-restored.png'});
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(Number(await page.locator('#sky-title').evaluate(el=>getComputedStyle(el).opacity)),1);
 assert.equal(Number(await page.locator(line).evaluate(el=>getComputedStyle(el).opacity)),1);
 console.log('PASS: original airliner, sky heading fade, line reveal, reduced motion.');
} finally {await browser.close()}
