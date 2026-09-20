import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const web=process.cwd(),api=resolve(web,'../api'),repo=resolve(web,'../..'),dir=mkdtempSync(join(tmpdir(),'olus-account-check-'));
const email='browser-check@example.test',password=randomBytes(24).toString('base64url');
const env={...process.env,PYTHONPATH:[api,join(repo,'.venv-aeolus/Lib/site-packages')].join(';'),OLUS_ACCOUNT_DB:join(dir,'accounts.sqlite3'),OLUS_COOKIE_SECURE:'false',OLUS_ACCOUNT_ORIGINS:'http://localhost:3002',CHECK_EMAIL:email,CHECK_PASSWORD:password};
const python=`import os\nfrom fastapi import FastAPI\nfrom src.routes.account import router\nfrom src.store.accounts import provision\nimport uvicorn\nprovision(os.environ['CHECK_EMAIL'],os.environ['CHECK_PASSWORD'],'Browser check')\napp=FastAPI()\napp.include_router(router,prefix='/api/v1')\nuvicorn.run(app,host='127.0.0.1',port=8002,log_level='warning')`;
const backend=spawn('py',['-3.11','-c',python],{cwd:api,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
const frontend=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3002'],{cwd:web,env:{...process.env,API_URL:'http://127.0.0.1:8002',OLUS_NEXT_DIST_DIR:'.next-account-check'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';for(const child of [backend,frontend]){child.stdout.on('data',d=>{logs+=d});child.stderr.on('data',d=>{logs+=d})}
let browser;
const wait=async(url)=>{for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.status<500)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('Server did not start '+url)};
try{
 await wait('http://127.0.0.1:8002/api/v1/account/session');await wait('http://localhost:3002/app/account');
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();await page.goto('http://localhost:3002/app/account');
 await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Your account'}).waitFor();
 const cookie=(await context.cookies()).find(c=>c.name==='olus_session');assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Lax');
 assert.equal((await context.request.patch('http://localhost:3002/api/v1/account/profile',{data:{name:'No CSRF'}})).status(),403);
 await page.getByLabel('Display name').fill('Saved browser profile');await page.getByRole('heading',{name:'Preferences',exact:true}).click();await page.getByText('Preferences saved',{exact:true}).waitFor();
 const session=await (await context.request.get('http://localhost:3002/api/v1/account/session')).json();assert.equal(session.user.name,'Saved browser profile');
 // A second tab replaces the cookie while this page still holds the old CSRF token.
 assert.equal((await context.request.post('http://localhost:3002/api/v1/account/login',{data:{email,password}})).status(),200);
 await page.getByLabel('Key name').fill('Browser integration');await page.getByRole('button',{name:'Create key',exact:true}).click();const secret=page.locator('[role="status"] code');await secret.waitFor();const first=await secret.textContent();assert.ok(first.startsWith('olus_'));
 assert.equal((await context.request.get('http://localhost:3002/api/v1/account/me',{headers:{Authorization:'Bearer '+first}})).status(),200);
 await page.getByRole('button',{name:'I saved the key'}).click();await page.getByRole('button',{name:'Rotate',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await secret.waitFor();const second=await secret.textContent();assert.notEqual(first,second);
 assert.equal((await context.request.get('http://localhost:3002/api/v1/account/me',{headers:{Authorization:'Bearer '+first}})).status(),401);assert.equal((await context.request.get('http://localhost:3002/api/v1/account/me',{headers:{Authorization:'Bearer '+second}})).status(),200);
 await page.getByRole('button',{name:'I saved the key'}).click();await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('No API keys.',{exact:false}).waitFor();assert.equal((await context.request.get('http://localhost:3002/api/v1/account/me',{headers:{Authorization:'Bearer '+second}})).status(),401);
 const deletion=page.locator('section').filter({has:page.getByRole('heading',{name:'Delete account',exact:true})});await deletion.getByLabel('Current password',{exact:true}).fill('incorrect-password');await deletion.getByRole('button',{name:'Delete account',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').getByRole('alert').filter({hasText:'Password is incorrect'}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();assert.equal((await context.request.get('http://localhost:3002/api/v1/account/session')).status(),401);
 console.log('PASS: isolated Next proxy sign-in, HttpOnly cookie, CSRF rejection, profile persistence, one-time key rotation/revocation and sign-out.');
}catch(error){console.error(logs.slice(-3500));throw error}finally{await browser?.close();for(const child of [frontend,backend]){if(child.pid)try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}}}
