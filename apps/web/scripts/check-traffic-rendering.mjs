import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let sockets=0;const errors=[];page.on('websocket',ws=>{if(ws.url().includes('/ws/simulation'))sockets++});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/app/overview');
 await page.waitForFunction(()=>Number(document.querySelector('.olus-traffic-canvas')?.dataset.contacts)>100,{},{timeout:60000});
 const before=await page.evaluate(()=>({planes:Number(document.querySelector('.olus-traffic-canvas').dataset.contacts),nodes:document.querySelectorAll('*').length}));
 assert.equal(await page.locator('.olus-traffic-canvas').count(),1);assert.ok(await page.locator('.ae-live-contact').count()<=1);
 const point=await page.locator('.olus-traffic-canvas').evaluate(canvas=>{const ctx=canvas.getContext('2d'),r=canvas.getBoundingClientRect(),d=canvas.width/r.width,data=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let y=250;y<650;y++)for(let x=450;x<1000;x++){const i=(Math.floor(y*d)*canvas.width+Math.floor(x*d))*4;if(data[i]===76&&data[i+1]===130&&data[i+2]===247&&data[i+3]>100)return{x:r.x+x,y:r.y+y}}throw Error('No aircraft pixels')});
 await page.mouse.click(point.x,point.y);await page.getByRole('complementary',{name:'Flight inspector'}).waitFor();await page.getByText('Interactive 3D preview',{exact:false}).waitFor();
 assert.equal(await page.locator('.ae-live-contact').count(),1);assert.ok(sockets<=1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,sockets,...before,domAircraft:await page.locator('.ae-live-contact').count(),individualSelection:true}));
}finally{await browser.close()}
