import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3001/app/overview');
await page.getByText('Layers & airports',{exact:true}).click();
await page.getByRole('button',{name:'Network globe',exact:true}).click();
await page.getByLabel('Scheduled replay hour').waitFor();
await page.locator('canvas').first().waitFor();
await page.getByLabel('Scheduled replay hour').fill('18');
await page.getByText('Simulated schedule replay: 18:00Z',{exact:true}).waitFor();
await page.getByRole('button',{name:'Return to live map'}).click();
await page.locator('[data-map-ready=true]').waitFor();
await page.getByText('Analysis tools',{exact:true}).click();
assert.equal(await page.getByRole('navigation',{name:'Analysis tools'}).getByRole('link').count(),9);
await page.getByRole('button',{name:'Ask Olus',exact:false}).click();
await page.getByText('Olus copilot',{exact:true}).waitFor();
assert.deepEqual(errors,[]);
console.log('PASS restored globe replay, return to map, analysis links and assistant opening');
}finally{await browser.close()}
