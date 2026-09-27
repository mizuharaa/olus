import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true,args:process.env.NO_WEBGL?['--disable-webgl']:[]});
try {
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>localStorage.setItem('olus-cookie-consent','essential'));
 await p.route('**/api/flights-live',route=>route.fulfill({json:{flights:[{icao24:'abc123',flight_icao:'TEST123',flight_iata:'TEST123',airline_name:'Test fixture',lat:39.5,lon:-98,heading:90,velocity_kt:400,altitude_ft:33000,vertical_fpm:0,on_ground:false,last_contact:Date.now()/1000}]}}));
 await p.route('**/api/v1/simulator/reset',r=>r.fulfill({json:{}}));
 await p.goto('http://localhost:3001/app/overview');
 const canvas=p.locator('.olus-traffic-canvas');await canvas.waitFor({timeout:90000});
 await p.waitForFunction(()=>document.querySelector('.olus-traffic-canvas')?.getAttribute('data-contacts')==='1');
 await p.getByLabel("Search flights by number, tail or airport code").fill("TEST123");
 await p.getByRole("button").filter({hasText:"TEST123"}).first().click();
 await p.locator('.olus-selected-contact').waitFor();assert.equal(await p.locator('.olus-selected-contact').count(),1,'Only one selected aircraft');
 assert.equal(await p.locator('.olus-traffic-canvas').count(),1,'Only one canvas');
 assert.ok(await p.locator('.leaflet-ae-focus-line-pane canvas').count(),'Observed and forecast use the focus renderer');
 assert.ok(await p.locator('.olus-selected-contact').getAttribute('data-position'));
 if(process.env.NO_WEBGL)await p.getByText('Aircraft preview unavailable.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: one canvas, one selected marker, separate observed/forecast paths, no browser errors');
} finally {await browser.close()}
