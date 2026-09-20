import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/design-review');
 await page.getByRole('button',{name:'Essential only',exact:true}).click();
 const frame=page.frameLocator('iframe');
 await frame.getByRole('navigation',{name:'Operations controls'}).waitFor();
 await frame.getByRole('button',{name:/^Events/}).click();
 await frame.getByRole('tab',{name:'Trigger',exact:true}).waitFor();
 await page.getByRole('tab',{name:'01 / Docked console',exact:true}).focus();
 await page.keyboard.press('ArrowRight');
 await page.waitForTimeout(200);
 assert.equal(await page.getByRole('tab',{name:'02 / Floating tools',exact:true}).getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowLeft');
 await page.waitForTimeout(200);
 const origin=await frame.locator('body').evaluate(()=>performance.timeOrigin);
 for(const [name,file] of [['01 / Docked console','docked'],['02 / Floating tools','floating'],['03 / Daylight console','daylight']]){
  await page.getByRole('tab',{name,exact:true}).click();
  await page.waitForTimeout(600);
  assert.equal(await frame.locator('body').evaluate(()=>performance.timeOrigin),origin,'Changing direction must not remount the map');
  const tab=frame.getByRole('tab',{name:'Trigger',exact:true});
  assert.equal(await tab.evaluate(el=>getComputedStyle(el).boxShadow),'none');
  assert.equal(await tab.evaluate(el=>getComputedStyle(el).borderRadius),'0px');
  assert.equal(await frame.locator('.leaflet-container').count(),1);
  await page.screenshot({path:`../../docs/verification/dashboard-review-${file}.png`});
 }
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.getByRole('button',{name:/Choose this design/}).click();
 assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Daylight console/);
 await page.setViewportSize({width:768,height:1000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:320,height:800});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: three interactive designs, stable map, neutral tabs, clipboard selection, narrow-screen overflow.');
}finally{await browser.close()}
