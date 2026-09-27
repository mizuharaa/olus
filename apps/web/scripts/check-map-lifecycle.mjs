import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto((process.env.BASE_URL||'http://localhost:3001')+'/app/overview');
 await page.locator('.leaflet-container').waitFor();
 const map=page.locator('.leaflet-container');
 const original=await map.evaluate(node=>node._leaflet_id);
 for(const tool of ['Plan timeline & explanation','Crew coverage & duty margins','Plan timeline & explanation']) {
  await page.getByText('Analysis tools',{exact:true}).click();
  await page.getByRole('button',{name:tool,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Operations analysis'});
  await dialog.waitFor();
  await page.waitForTimeout(800);
  assert.equal(await map.count(),1,'Exactly one map must remain mounted');
  assert.equal(await map.evaluate(node=>node._leaflet_id),original,'Analysis must preserve the map instance');
  await dialog.getByRole('button',{name:'Close analysis'}).click();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: lazy analysis opens/closes without remounting or reinitializing the Leaflet map.');
} finally {await browser.close()}
