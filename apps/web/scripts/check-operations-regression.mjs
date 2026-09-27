import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=process.env.OLUS_TEST_URL||'http://localhost:5193';
assert.ok(/^(localhost|127\.0\.0\.1|olus\.localhost)$/.test(new URL(base).hostname),'Isolated local API required; this check resets simulated plans.');
const out=new URL('../../../docs/verification/dashboard/panel-metrics/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={viewports:[],scenarios:[],errors:[]};
const usd=n=>n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1000?'$'+Math.round(n/1000)+'K':'$'+Math.round(n);
const compact=n=>n>=1000?(n/1000).toFixed(1)+'K':String(Math.round(n));
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('olus-cookie-consent','essential'));
 await page.goto(base+'/app/overview');
 await page.getByRole('button',{name:'Reset simulation',exact:true}).click();
 await page.getByRole('button',{name:'Events 0',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Disruption controls'});
 await panel.getByPlaceholder(/Search disruptions/).fill('Wind Shear');
 await panel.getByRole('option',{name:/Wind Shear/}).click();
 const editor=panel.getByRole('region',{name:'Configure Wind Shear'});
 await editor.waitFor();
 assert.ok((await editor.boundingBox()).height>300,'Editor must use entire panel');
 const handle=panel.getByRole('separator',{name:/Events width/});
 const before=await panel.boundingBox();
 await handle.focus();await page.keyboard.press('Shift+ArrowRight');
 assert.ok((await panel.boundingBox()).width>before.width,'Keyboard resize');
 const grip=await handle.boundingBox();
 await page.mouse.move(grip.x+12,grip.y+100);await page.mouse.down();await page.mouse.move(grip.x+112,grip.y+100);await page.mouse.up();
 assert.ok((await panel.boundingBox()).width>before.width+100,'Pointer resize');
 let submissions=0;page.on('request',r=>{if(r.url().endsWith('/simulator/trigger'))submissions++});
 await editor.getByLabel('Duration (hrs)').fill('0');await editor.getByRole('button',{name:'Trigger Wind Shear',exact:true}).click();assert.equal(submissions,0);
 await editor.getByLabel('Duration (hrs)').fill('2');
 await page.route('**/api/v1/simulator/trigger',r=>r.fulfill({status:503,contentType:'application/json',body:'{"detail":"Unavailable for regression check"}'}));
 await editor.getByRole('button',{name:'Trigger Wind Shear',exact:true}).click();
 await page.getByText('Failed to trigger event',{exact:true}).waitFor();assert.ok(await editor.isVisible());
 await page.unroute('**/api/v1/simulator/trigger');
 await page.getByText('Failed to trigger event',{exact:true}).waitFor({state:'hidden'});
 await panel.getByRole('button',{name:'Expand events',exact:true}).click();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});
  const box=await panel.boundingBox(),button=await editor.getByRole('button',{name:'Trigger Wind Shear',exact:true}).boundingBox();
  assert.ok(box.height>600&&box.x>=0&&box.x+box.width<=width+1&&button.y+button.height<=900,'Expanded editor must fit viewport');
  for(const label of ['Airport','Modeled severity','Duration (hrs)'])await editor.getByLabel(label,{exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
  await page.waitForTimeout(250);await page.screenshot({path:fileURLToPath(new URL('editor-'+width+'.png',out))});
  report.viewports.push({width,editor:box});
 }
 await page.setViewportSize({width:1440,height:1000});
 await panel.getByRole('button',{name:'Restore events',exact:true}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/simulator/trigger')&&r.status()===200);
 await editor.getByRole('button',{name:'Trigger Wind Shear',exact:true}).click();
 const wind=await (await response).json();assert.equal(wind.recovery_plans.length,4);assert.ok(wind.cascade_summary.total_affected>0);
 await panel.getByRole('button',{name:'Close events',exact:true}).click();
 async function compare(result,name){
  await page.getByRole('button',{name:/^Recovery /}).click();
  const recovery=page.getByRole('region',{name:'Financial recovery',exact:true});
  await recovery.getByRole('button',{name:'Expand recovery',exact:true}).click();
  const table=recovery.getByRole('table',{name:'Recovery plans compared across metrics'});await table.waitFor();
  await page.waitForTimeout(200);
  const box=await recovery.boundingBox(),commitBox=await recovery.locator('.ae-commit').boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=1000&&commitBox.y+commitBox.height<=1000,'Expanded recovery and commit must fit the workspace');
  const metrics=[['Cost',p=>usd(p.cost_breakdown.grand_total_usd)],['Passenger-minutes',p=>compact(p.total_passenger_delay_minutes)],['tCO₂e',p=>(p.total_co2_kg>=0?'+':'')+(p.total_co2_kg/1000).toFixed(1)],['Crew violations',p=>String(p.crew_violations)],['Cancellations',p=>String(p.cancelled_flights.length)],['Delayed flights',p=>String(p.delayed_flights.length)]];
  for(const [label,expected] of metrics){
   const row=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:new RegExp('^'+label)})});
   assert.deepEqual((await row.getByRole('cell').allTextContents()).map(x=>x.trim()),result.recovery_plans.map(expected),name+' '+label);
  }
  assert.match(await recovery.innerText(),new RegExp(result.cascade_summary.total_affected+'\\s*affected'));
  await recovery.getByRole('button',{name:'Cost and risk detail',exact:true}).click();
  for(const p of result.recovery_plans){
   await recovery.getByLabel('Detail plan').selectOption(p.plan_id);
   assert.ok((await recovery.locator('.ae-ledger-row').filter({hasText:'Total exposure'}).innerText()).includes(usd(p.total_cost_usd)));
  }
  await page.waitForTimeout(250);await page.screenshot({path:fileURLToPath(new URL(name+'-detail.png',out))});
  await recovery.getByRole('button',{name:'Compare plans',exact:true}).click();
  await page.waitForTimeout(250);await page.screenshot({path:fileURLToPath(new URL(name+'-compare.png',out))});
  report.scenarios.push({name,cascade:result.cascade_summary,plans:result.recovery_plans.map(p=>({id:p.plan_id,cost:p.total_cost_usd,paxMinutes:p.total_passenger_delay_minutes,cancelled:p.cancelled_flights.length,delayed:p.delayed_flights.length,crew:p.crew_violations,co2:p.total_co2_kg}))});
 }
 await compare(wind,'wind-shear');
 await page.getByRole('columnheader').getByRole('button',{name:/^A Minimize Cost/}).click();
 await page.getByRole('button',{name:/^Commit plan A/}).click();
 const appliedResponse=page.waitForResponse(r=>r.url().endsWith('/recovery/apply')&&r.status()===200);
 await page.getByRole('button',{name:/^Confirm.*commit plan A/}).click();
 await appliedResponse;
 const snapshot=await (await page.request.get(base+'/api/v1/simulator/state')).json();assert.equal(snapshot.applied_plan_id,'A');assert.deepEqual(snapshot.cascade_summary,wind.cascade_summary);
 // Suppress only the local-dev clean-boot reset; production does not issue it.
 await page.route('**/api/v1/simulator/reset',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.routeWebSocket(/\/ws/,ws=>ws.close());await page.reload();
 await page.getByRole('button',{name:/^Recovery 4/}).click();
 let recovery=page.getByRole('region',{name:'Financial recovery',exact:true});
 await recovery.getByRole('button',{name:/Unapply plan/}).waitFor();
 assert.match(await recovery.innerText(),new RegExp(wind.cascade_summary.total_affected+'\\s*affected'));
 await recovery.getByRole('button',{name:/Unapply plan/}).click();
 await recovery.getByRole('button',{name:/Commit plan A/i}).waitFor();
 await page.request.post(base+'/api/v1/simulator/reset');
 const stormResponse=await page.request.post(base+'/api/v1/simulator/trigger',{data:{kind:'thunderstorm',params:{airport:'KORD',severity:'severe',duration_hours:3}}});assert.ok(stormResponse.ok());
 const storm=await stormResponse.json();await page.reload();await compare(storm,'thunderstorm');
 // Exercise the other window controls and constrained comparison widths.
 recovery=page.getByRole('region',{name:'Financial recovery',exact:true});
 for(const width of [768,390,320]){
  await page.setViewportSize({width,height:900});
  const box=await recovery.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=900);
  const commit=await recovery.locator('.ae-commit').boundingBox();assert.ok(commit.y+commit.height<=900);
  await page.waitForTimeout(250);await page.screenshot({path:fileURLToPath(new URL('recovery-'+width+'.png',out))});
 }
 await page.setViewportSize({width:1440,height:1000});
 await recovery.getByRole('button',{name:'Close the comparison and return to the map'}).click();
 await page.getByRole('button',{name:/Open cascade timeline/}).click();
 const timeline=page.locator('section').filter({has:page.getByRole('button',{name:/cascade timeline/})}).last();
 const t0=await timeline.boundingBox();
 await page.getByRole('separator',{name:/Timeline height/}).focus();await page.keyboard.press('Shift+ArrowUp');
 assert.ok((await timeline.boundingBox()).height>t0.height,'Timeline height resize');
 await page.getByRole('button',{name:'Expand timeline',exact:true}).click();await page.waitForTimeout(100);
 const tx=await timeline.boundingBox();assert.ok(tx.height>700&&tx.y+tx.height<=1000);await page.screenshot({path:fileURLToPath(new URL('timeline.png',out))});
 await page.getByRole('button',{name:'Restore timeline',exact:true}).click();
 await page.getByRole('button',{name:/Collapse cascade timeline/}).click();
 await page.getByLabel('Search flights by number, tail or airport code').fill('NB101');
 await page.getByRole('button',{name:/^NB101 /}).click();
 const inspector=page.getByRole('complementary',{name:'Flight inspector'});await inspector.waitFor();
 const i0=await inspector.boundingBox();await inspector.getByRole('separator',{name:/Flight details width/}).focus();await page.keyboard.press('Shift+ArrowLeft');
 assert.ok((await inspector.boundingBox()).width>i0.width,'Flight inspector width resize');
 await inspector.getByRole('button',{name:'Expand flight details'}).click();await page.waitForTimeout(100);
 const ix=await inspector.boundingBox();assert.ok(ix.width>1000&&ix.height>700&&ix.y+ix.height<=1000);
 await page.waitForTimeout(250);await page.screenshot({path:fileURLToPath(new URL('flight-inspector.png',out))});
 await page.keyboard.press('Escape');assert.ok((await inspector.boundingBox()).width<800);
 report.panels=['events','recovery','timeline','flight inspector'];
 assert.equal(report.errors.length,0,report.errors.join('\n'));report.pass=true;console.log(JSON.stringify(report));
}finally{await writeFile(new URL('checks.json',out),JSON.stringify(report,null,2));await browser.close()}
