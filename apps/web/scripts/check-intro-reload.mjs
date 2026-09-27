import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const url=process.argv[2]||'http://localhost:3001';
const dir='../../docs/verification/loader';fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir,size:{width:1440,height:900}}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('[data-ready=true]').waitFor();
 await page.evaluate(()=>sessionStorage.setItem('olus-intro-seen','1'));
 for (const scroll of [0, 1800]) {
 await page.evaluate(y=>window.scrollTo(0,y),scroll);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-intro-running=true]').waitFor();
 const mark=await page.locator('[data-logo-mark]').elementHandle();const start=Date.now();
 await page.locator('[data-ready=true]').waitFor();assert.ok(Date.now()-start<2700);
 assert.ok(await mark.evaluate(el=>el===document.querySelector('[data-logo-mark]')));
 assert.equal(await page.locator('[data-intro-cover]').evaluate(el=>getComputedStyle(el).display),'none');
 }
 await page.screenshot({path:dir+'/landing.png'});
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-ready=true]').waitFor();
 assert.equal(await page.locator('[data-intro-running=true]').count(),0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.route('**/api/**',route=>route.fulfill({status:503,body:'Unavailable'}));
 await page.goto(url+'/simulator',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('[data-app-loader] button')!==null);
 const appStart=Date.now();await page.locator('[data-app-loader]').waitFor({state:'hidden',timeout:1800});
 assert.ok(Date.now()-appStart<1700);assert.deepEqual(errors,[]);
 console.log('PASS: intro replay on top and mid-scroll reloads, same-node Flip, reduced motion, bounded app loader without backend');await context.close();
} finally {await browser.close()}
