import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Use a running local backend with isolated state, never the production demo.
const base=process.argv[2]||'http://localhost:5193';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const evidence=resolve('../../docs/verification/dashboard');mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(60000);
 await page.addInitScript(()=>localStorage.setItem('olus-cookie-consent','essential'));
 await page.goto(base+'/app/overview');
 await page.getByRole('heading',{name:'Operations control'}).waitFor();
 const heading=await page.getByRole('navigation',{name:'Operations controls'}).innerText();
 assert.ok(!/·\s*affected/.test(heading),'Missing affected count must not render as a metric');
 const asks=[];page.on('request',r=>{if(r.url().endsWith('/agent/ask'))asks.push(r.url())});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  await page.locator('summary').filter({hasText:/^Tools$/}).click();
  const trigger=page.getByRole('button',{name:'Ask Olus',exact:true});
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Olus copilot',exact:true});await dialog.waitFor();
  const bounds=await dialog.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900,'Dialog must fit viewport');
  const input=page.getByRole('textbox',{name:'Ask the Olus copilot'});
  assert.ok(await input.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+8,r.y+r.height/2)===e}),'Copilot input must escape menu clipping');
  await page.screenshot({path:join(evidence,`layout-${width}-copilot.png`)});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.ok(await trigger.evaluate(e=>document.activeElement===e),'Native dialog restores focus');
  await page.locator('summary').filter({hasText:/^Tools$/}).click();
 }
 assert.deepEqual(asks,[],'UI review must not send a copilot prompt');
 await page.reload();
 await page.getByRole('button',{name:/^Events /}).click();
 await page.getByRole('complementary',{name:'Disruption controls'}).getByPlaceholder(/Search disruptions/).waitFor();
 await page.screenshot({path:join(evidence,'layout-1440-demo-events.png')});
 const canvas=page.locator('canvas.olus-traffic-canvas');
 await page.waitForFunction(()=>Number(document.querySelector('canvas.olus-traffic-canvas')?.getAttribute('data-contacts'))>0);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await page.screenshot({path:join(evidence,'layout-1440-live-detail.png')});
 assert.ok(await canvas.isVisible(),'Live contacts remain available at detailed zoom');
 console.log('PASS: demo metric guard, copilot viewport bounds/input hit test/Escape/focus at four widths; no AI requests.');
} finally {await browser.close()}
