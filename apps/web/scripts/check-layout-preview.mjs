import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.addInitScript(()=>localStorage.setItem('olus-cookie-consent','essential'));
await page.goto('http://localhost:3001/app/overview');
await page.locator('[data-map-ready=true]').waitFor({timeout:90000});
await page.waitForTimeout(3000);
await page.screenshot({path:'../../docs/verification/dashboard/revamp-layout.png'});
if(await page.getByRole('heading',{name:'Network overview'}).count()!==1)throw Error('Missing network summary');
await page.getByRole('button',{name:'Collapse network summary'}).click();
await page.getByRole('region',{name:'Network operations'}).getByText('Scheduled flights',{exact:false}).waitFor({state:'hidden'});
await page.getByRole('button',{name:'Expand network summary'}).click();
for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Overflow at '+width);}
console.log('PASS summary collapse/expand and responsive widths');
await browser.close();
