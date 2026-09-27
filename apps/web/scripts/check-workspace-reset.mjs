import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),base='http://localhost:3001';
 const trigger=()=>page.request.post(base+'/api/v1/simulator/trigger',{data:{kind:'weather_closure',params:{airport:'KORD',duration_hours:2,severity:1}}});
 await trigger();await page.goto(base+'/app/overview');
 await page.getByRole('button',{name:'Reset simulation',exact:true}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Events 0',exact:true}).waitFor();
 let state=await (await page.request.get(base+'/api/v1/simulator/state')).json();assert.equal(state.active_events.length,0);
 await trigger();await page.getByRole('button',{name:'Events 1',exact:true}).waitFor();
 await page.getByRole('button',{name:'Reset simulation',exact:true}).click();await page.getByRole('button',{name:'Events 0',exact:true}).waitFor();
 await trigger();await page.getByRole('button',{name:'Events 1',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Events 0',exact:true}).waitFor();
 await page.locator('.ae-map-legend summary').click();
 const toggle=page.getByRole('button',{name:/Real flights \(ADS-B\)/});await toggle.waitFor();
 assert.ok(!(await toggle.innerText()).includes('hidden during event'));
 const colors=await toggle.evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el.parentElement).backgroundColor}));
 const luminance=s=>{const rgb=s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
 const a=luminance(colors.foreground),b=luminance(colors.background),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(contrast>=4.5,JSON.stringify(colors));
 console.log(JSON.stringify({pass:true,cleanBoot:true,manualReset:true,reloadClearsEvents:true,legendContrast:contrast.toFixed(2)}));
}finally{await browser.close()}
