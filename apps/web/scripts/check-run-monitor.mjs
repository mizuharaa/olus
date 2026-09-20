import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));let status='running';
 await p.route('**/api/v1/account/session',r=>r.fulfill({json:{user:{id:'fixture',name:'Test operator'},csrf_token:'fixture-csrf'}}));
 const run={id:'fixture-run',scenario_id:'fixture-scenario',scenario_name:'Browser test fixture',created_at:new Date().toISOString(),elapsed_ms:1200,events:[{type:'plan_started',sequence:1,elapsed_ms:10,plan_id:'A',solve_sequence:1},{type:'incumbent',sequence:2,elapsed_ms:100,plan_id:'A',solve_sequence:1,objective_value:100,best_objective_bound:80,incumbent_count:1,constraints_satisfied:3}]};
 await p.route('**/api/v1/runs/fixture-run',r=>r.fulfill({json:{...run,status,result:status==='completed'?{applied_plan_id:null,recovery_plans:[{plan_id:'A',status:'optimal',total_cost_usd:100}]}:null}}));
 await p.route('**/api/v1/runs/fixture-run/cancel',r=>{status='cancelled';return r.fulfill({json:{...run,status,result:null}})});
 await p.route('**/api/v1/runs/fixture-run/crew-audit',r=>r.fulfill({json:{scope:'Test fixture modeled rules',limitations:['Rest input absent'],rows:[{crew_id:'CA01',crew_name:'Test pilot',flight_id:'T1',rule:'modeled-rest',label:'Rest',value:null,limit:600,slack:null,status:'unknown',inputs:{last_rest_end:null}}]}}));
 await p.goto('http://localhost:3001/app/runs/fixture-run');await p.getByRole('heading',{name:'Browser test fixture'}).waitFor({timeout:90000});
 await p.getByRole('button',{name:'View as table',exact:true}).click();await p.getByRole('table',{name:'Recorded objective values for model 1'}).waitFor();
 await p.getByRole('button',{name:'Cancel solve',exact:true}).click();await p.getByRole('status').filter({hasText:'cancelled'}).waitFor();assert.equal(await p.getByRole('button',{name:'Cancel solve',exact:true}).count(),0);
 status='completed';await p.reload();await p.getByRole('link',{name:'Inspect recovery on map'}).waitFor();await p.getByText('Inspect crew rule computations',{exact:true}).click();await p.getByRole('table',{name:/1 crew rule computations/}).waitFor();assert.ok(await p.getByText('unknown',{exact:true}).count());
 await p.setViewportSize({width:320,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS: run progress table, actual cancel request, terminal state, map link, unknown crew inputs, 320px no overflow');
}finally{await browser.close()}
