const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),ts=require("typescript");
const source=path.resolve(__dirname,"../lib/flight-track.ts"), mod={exports:{}};
new Function("exports","module",ts.transpileModule(fs.readFileSync(source,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports,mod);
const {observeFlight,trackPosition,observedTrail}=mod.exports;
const first={lat:40,lon:-100,last_contact:1000,heading:90,velocity_kt:400};
let track=observeFlight(undefined,first);track=observeFlight(track,{...first,lon:-99,last_contact:1030});
assert.equal(observeFlight(track,{...first,last_contact:999}),track,"Old packets cannot rewind a track");
for(let now=1000;now<=1100;now++)for(const reduced of [false,true]){
 const trail=observedTrail(track,now,reduced),pos=trackPosition(track,now,reduced);
 assert.deepEqual(trail.at(-1),pos,"Observed path and marker must share one sample");
 assert.ok(trail.every(p=>p[1]<=pos[1]),"History must not contain future observations");
}
assert.deepEqual(trackPosition(track,2000,false),[40,-99],"Stale contacts freeze without extrapolation");
let crossing=observeFlight(undefined,{...first,lon:179});crossing=observeFlight(crossing,{...first,lon:-179,last_contact:1030});
const trail=observedTrail(crossing,1060,false);assert.ok(Math.abs(trail[1][1]-trail[0][1])<=2,"Dateline trail must remain local");
for(let i=1;i<=200;i++)track=observeFlight(track,{...first,last_contact:1030+i});assert.equal(track.fixes.length,120,"Track memory is bounded");
console.log("PASS: shared position clock, observed trail cutoff, stale freeze, out-of-order packets, dateline and bounded history");
