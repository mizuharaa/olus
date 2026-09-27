// Run with node scripts/check-flight-controls.cjs. Compiles existing TS in memory.
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const req=id=>load(path.resolve(id.startsWith('@/')?root:path.dirname(file),id.startsWith('@/')?id.slice(2):id)+'.ts');new Function('require','exports','module',code)(req,mod.exports,mod);return mod.exports;}
const {observeFlight,trackPosition}=load(root+'/lib/flight-track.ts');
const fix={lat:38,lon:-95,last_contact:1000,heading:90,velocity_kt:420};const track=observeFlight(undefined,fix);
assert.equal(observeFlight(track,{...fix,lon:-94,last_contact:999}),track);
const newer=observeFlight(track,{...fix,lon:-94.98,last_contact:1015});
assert.deepEqual(trackPosition(track,1010,false),[38,-95],'Never extrapolate past a measured fix');
let previous=-95;for(let t=1030;t<1080;t++){const p=trackPosition(newer,t,false);assert.ok(p[1]>=previous,'Forward track must never reverse between polls');previous=p[1];}
assert.deepEqual(trackPosition(newer,1100,false),[38,-94.98],'Stale aircraft freeze');
assert.deepEqual(trackPosition(newer,1015,true),[38,-94.98]);
const {deadReckon}=load(root+'/lib/flight-derive.ts');
assert.ok(deadReckon(38,-97,90,420,600,600)[1]>deadReckon(38,-97,90,420,600)[1]+0.5,'Explicit direction estimate must not hit the live-motion cap');
const {deriveLive}=load(root+'/lib/flight-derive.ts');assert.equal(deriveLive({...fix,heading:null,altitude_ft:32000,vertical_fpm:0,on_ground:false}).ahead,null,'Missing heading must not invent an arrival');
const {FORM_SCHEMA,eventParams}=load(root+'/lib/event-forms.ts');assert.equal(Object.keys(FORM_SCHEMA).length,22);
assert.ok(FORM_SCHEMA.labor_action.fields.some(f=>f.key==='percent_affected'));assert.ok(!FORM_SCHEMA.labor_action.fields.some(f=>f.key==='slowdown_pct'));
for(const kind of ['blizzard','sandstorm','dense_fog','wind_shear','deicing_shortage']) assert.ok(FORM_SCHEMA[kind].fields.some(f=>f.key==='severity'));
assert.equal(eventParams('weather_closure',{duration_hours:2}).end,'T+2h');assert.deepEqual(eventParams('airspace_closure',{airport:'KJFK'}).airports,['KJFK']);
console.log('PASS: duplicate/out-of-order fixes, stale freeze, reduced motion, 22 event forms and consumed parameters');
if(process.env.VERIFY_EVENT_API==='1') (async()=>{
 const base='http://127.0.0.1:8000/api/v1';
 async function call(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,`${route}: ${r.status} ${await (!r.ok?r.text():Promise.resolve(''))}`);return r.json()}
 const {event_types}=await call('/events/types');assert.deepEqual(event_types.map(e=>e.kind).sort(),Object.keys(FORM_SCHEMA).sort());
 const results=[];
 for(const [kind,schema] of Object.entries(FORM_SCHEMA)) {
  await call('/simulator/reset',{});
  const values=Object.fromEntries(schema.fields.map(f=>[f.key,f.type==='number'||f.key==='category'?Number(schema.defaults[f.key]):schema.defaults[f.key]]));
  const update=await call('/simulator/trigger',{kind,params:eventParams(kind,values)});
  assert.equal(update.event.kind,kind);assert.ok(update.cascade_summary.total_affected>0,`${kind} has no affected flights`);assert.equal(update.recovery_plans.length,4);
  const state=await call('/simulator/state');assert.ok(state.active_events.some(e=>e.id===update.event.id));
  results.push({kind,affected:update.cascade_summary.total_affected,plans:update.recovery_plans.length,params:update.event.params});console.log('VERIFIED',kind,update.cascade_summary.total_affected,'affected');
 }
 await call('/simulator/reset',{});
 fs.writeFileSync(path.resolve(root,'../../docs/verification/dashboard/event-api-check.json'),JSON.stringify(results,null,2));
 console.log('PASS: all 22 real API event triggers returned affected flights and persisted active events');
})().catch(e=>{console.error(e);process.exitCode=1});
