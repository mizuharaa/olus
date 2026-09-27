import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const shot=name=>fileURLToPath(new URL('../../../../docs/verification/dashboard/'+name,import.meta.url));
const base='http://localhost:3001';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('olus-cookie-consent','essential'));
 await page.request.post(base+'/api/v1/simulator/reset');
 await page.goto(base+'/app/overview');await page.locator('.leaflet-container').waitFor({timeout:90000});
 await page.getByRole('button',{name:'Hide live traffic',exact:true}).click();
 await page.getByRole('button',{name:/^Events /}).click();
 await page.getByRole('complementary',{name:'Disruption controls'}).waitFor();
 await page.getByText('Weather Closure',{exact:true}).first().waitFor();
 await page.waitForTimeout(300);
 await page.screenshot({path:shot('original-events-restored.png')});
 await page.getByRole('button',{name:'Close events',exact:true}).click();
 const response=await page.request.post(base+'/api/v1/simulator/trigger',{data:{kind:'weather_closure',params:{airport:'KORD',duration_hours:2,severity:1}}});assert.ok(response.ok());const result=await response.json();assert.equal(result.recovery_plans.length,4);
 await page.getByRole('button',{name:'Preview plan D',exact:true}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'Preview plan D',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-preview-plan]')?.dataset.previewPlan==='D');
 let state=await (await page.request.get(base+'/api/v1/simulator/state')).json();assert.ok(Object.values(state.flight_states).every(f=>!f.applied_plan_id),'Preview must not commit');
 await page.screenshot({path:shot('original-map-restored.png')});
 await page.getByRole('button',{name:/^Recovery /}).click();
 await page.getByRole('table',{name:'Recovery plans compared across metrics'}).waitFor();
 for(const id of ['A','B','C','D']){await page.locator('.ae-plan-col').filter({hasText:new RegExp('^'+id)}).click();await page.waitForFunction(id=>document.querySelector('[data-preview-plan]')?.dataset.previewPlan===id,id)}
 await page.screenshot({path:shot('original-comparison-restored.png')});
 await page.locator('.ae-commit').click();
 await page.getByRole('button',{name:'Preview plan A',exact:true}).click();
 assert.match(await page.locator('.ae-commit').innerText(),/Commit plan A/,'Changing plan must reset confirmation');
 await page.getByRole('button',{name:'Preview plan D',exact:true}).click();
 await page.locator('.ae-commit').click();await page.locator('.ae-commit').click();
 await page.waitForFunction(()=>document.querySelector('.ae-commit')?.textContent.includes('Unapply'));
 state=await (await page.request.get(base+'/api/v1/simulator/state')).json();assert.ok(Object.values(state.flight_states).some(f=>f.applied_plan_id==='D'));
 await page.locator('.ae-commit').click();await page.waitForFunction(()=>!document.querySelector('.ae-commit')?.textContent.includes('Unapply'));
 for(const width of [320,768,1280]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`)}
 assert.deepEqual(errors,[]);console.log('PASS original map/events, 4 plan previews without mutation, real commit/unapply, responsive widths');
}finally{await browser.close()}
