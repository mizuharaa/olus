import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Run through check-scenario-integration.mjs: real signed-in run, no public mutations.
export async function checkWorkspaceLayout(page, evidence) {
  const measurements=[];
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
  const measure=()=>page.evaluate(()=>{
    const box=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const hit=selector=>[...document.querySelectorAll(selector)].map(e=>{const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:e.textContent.trim(),height:r.height,width:r.width,visible:r.x>=0&&r.right<=innerWidth+1,clickable:!!top&&(e===top||e.contains(top))}});
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
      header:box('header'),nav:box('nav[aria-label="Workspace"]'),toolbar:box('nav[aria-label="Operations controls"]'),
      preview:box('[aria-label="Map recovery preview"]'),events:box('[aria-label="Disruption controls"]'),recovery:box('[aria-label="Financial recovery"]'),
      links:hit('nav[aria-label="Workspace"] a'),buttons:hit('nav[aria-label="Operations controls"] > button')};
  });
  assert.ok(await page.locator('[aria-label="Map recovery preview"]').count(),'Layout check requires the solved private run created by check-scenario-integration.mjs');
  for(const width of [320,390,768,1024,1280,1440,1920]) {
    await page.setViewportSize({width,height:900});await settle();
    const m=await measure();
    assert.equal(m.overflow,false,`${width}: document overflow`);
    for(const item of [...m.links,...m.buttons]){
      assert.ok(item.height>=43,`${width}: ${item.text} below 44px target`);
      assert.ok(item.visible&&item.clickable,`${width}: ${item.text} obscured or clipped`);
    }
    if(width>=1200)assert.ok(Math.abs(m.nav.x+m.nav.width/2-width/2)<=1,`${width}: nav not centered`);
    assert.ok(m.preview.y>=m.toolbar.bottom+7,`${width}: preview overlaps toolbar`);
    await page.getByRole('button',{name:/^Events /}).click();await settle();
    const opened=await measure();
    assert.ok(opened.events.y>=opened.preview.bottom+7,`${width}: event panel overlaps preview`);
    assert.ok(opened.events.height>=100,`${width}: unusable event panel height`);
    assert.ok(Math.abs(opened.events.x-opened.toolbar.x)<=1,`${width}: event and toolbar rails differ`);
    await page.getByRole('button',{name:/^Recovery /}).click();await settle();
    await page.waitForFunction(()=>{
      const rows=[...document.querySelectorAll('[aria-label="Financial recovery"] [role=row]')];
      return rows.length>=6&&rows.every(row=>Number(getComputedStyle(row).opacity)>.99);
    });
    const compared=await measure();
    assert.ok(compared.recovery.y>=compared.preview.bottom+7,`${width}: recovery overlaps preview`);
    if(width>=1100)assert.ok(compared.recovery.x>=compared.events.right+11,`${width}: comparison overlaps events`);
    else assert.equal(compared.events,null,`${width}: competing narrow panels`);
    const commit=page.getByRole('button',{name:/^Commit plan .*asks for confirmation/});
    const commitBox=await commit.boundingBox();
    assert.ok(commitBox&&commitBox.y>=compared.recovery.y&&commitBox.y+commitBox.height<=compared.recovery.bottom+1,`${width}: commit action outside recovery panel`);
    await page.screenshot({path:join(evidence,`layout-${width}-recovery.png`)});
    await page.getByRole('button',{name:/^Recovery /}).click();
    if(width>=1100)await page.getByRole('button',{name:'Close events'}).click();
    const search=page.getByRole('textbox',{name:'Search flights by number, tail or airport code'});
    await search.fill('NB101');
    await page.getByRole('button',{name:/NB101/}).first().click();
    await page.getByRole('complementary',{name:'Flight inspector'}).waitFor();
    const inspector=await page.getByRole('complementary',{name:'Flight inspector'}).boundingBox();
    assert.ok(inspector.x>=0&&inspector.x+inspector.width<=width+1,`${width}: inspector out of bounds`);
    assert.ok(inspector.y>=(await measure()).preview.bottom+7,`${width}: inspector overlaps preview`);
    if(width===1440){
      await page.getByRole('button',{name:/^Events /}).click();
      await page.setViewportSize({width:768,height:900});await settle();
      await page.getByRole('complementary',{name:'Flight inspector'}).waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Close events'}).click();
      await page.getByRole('complementary',{name:'Flight inspector'}).waitFor();
      await page.setViewportSize({width,height:900});await settle();
    }
    await page.getByRole('button',{name:'Close flight detail'}).click();
    await page.getByRole('button',{name:/Open cascade timeline/}).click();
    await page.getByRole('button',{name:/Collapse cascade timeline/}).waitFor();
    await page.getByRole('button',{name:/Collapse cascade timeline/}).click();
    await page.getByRole('button',{name:'Search workspace'}).click();
    await page.getByRole('dialog',{name:'Go to workspace'}).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('summary').filter({hasText:/^Tools$/}).click();
    await page.getByRole('navigation',{name:'Analysis tools'}).waitFor();
    const tools=await page.getByRole('navigation',{name:'Analysis tools'}).boundingBox();
    assert.ok(tools.x>=0&&tools.x+tools.width<=width+1,`${width}: tools menu outside viewport`);
    await page.locator('summary').filter({hasText:/^Tools$/}).click();
    await page.screenshot({path:join(evidence,`layout-${width}-map.png`)});
    measurements.push({...m,opened,compared});
  }
  await page.setViewportSize({width:1440,height:1000});
  writeFileSync(join(evidence,'workspace-layout.json'),JSON.stringify({passed:true,measurements},null,2));
  console.log('PASS: seven viewport widths, centered nav, shared rails, panel separation including desktop-to-tablet resize, control hit tests, command dialog and bounded tools menu.');
}
