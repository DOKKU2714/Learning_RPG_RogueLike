const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const terms=[{keyword:'기절',description:'대상의 턴을 건너뜁니다.'},{keyword:'공격력',description:'공격 피해를 높입니다.'},
  {keyword:'기절',description:'duplicate'},{keyword:'시험',description:'<img src=x onerror="window.injected=true">'}];
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const width of [1366,390]){
      const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<html><head>'+styles+'<style>.fixture{position:absolute;top:80px;left:30px;width:260px;padding:20px;background:#20251f;color:white;box-sizing:border-box}.fixture .skill-detail-card{position:static;display:block;opacity:1;visibility:visible}</style></head><body>'+ 
        '<button id="skill" class="skill-button fixture">강타<span class="skill-detail-card">적에게 기절을 부여합니다. 기절 1턴.</span></button>'+
        '<button id="reward" class="reward-choice-card fixture" style="top:320px">스킬 보상: 기절과 공격력</button>'+
        '<button id="stat" class="reward-choice-card fixture" style="top:540px">공격력 +2</button>'+
        '<button id="none" class="reward-choice-card fixture" style="top:700px">아무 단어도 없음</button>'+
        '<script>var currentView={clientConfig:{glossary:'+JSON.stringify(terms)+'}};function escapeHtml(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}'+extract('bindGlossaryTooltips')+';bindGlossaryTooltips();</script></body></html>');
      const panel=page.locator('#glossaryTooltip');
      await page.locator('#skill').hover();await page.waitForTimeout(40);
      assert.deepEqual(await panel.locator('strong').allTextContents(),['기절']);
      assert.match(await page.locator('#skill').getAttribute('aria-describedby'),/glossaryTooltip/);
      const boxes=await page.locator('#skill').evaluate(el=>({card:el.querySelector('.skill-detail-card').getBoundingClientRect().toJSON(),panel:document.getElementById('glossaryTooltip').getBoundingClientRect().toJSON()}));
      assert.ok(boxes.panel.left>=0 && boxes.panel.right<=width);
      assert.ok(boxes.panel.width<=210 && boxes.panel.height<=260);
      assert.ok(boxes.panel.width<boxes.card.width,JSON.stringify(boxes));
      if(width>1000)assert.ok(boxes.panel.left>=boxes.card.right);
      await page.mouse.move(boxes.panel.left-5,boxes.panel.top+10);
      await page.waitForTimeout(50);
      await panel.hover();assert.equal(await panel.getAttribute('aria-hidden'),'false');
      await page.mouse.move(width-5,5);await page.waitForTimeout(220);
      assert.equal(await panel.getAttribute('aria-hidden'),'true');
      await page.locator('#reward').hover();assert.deepEqual(await panel.locator('strong').allTextContents(),['기절','공격력']);
      await page.locator('#stat').focus();assert.deepEqual(await panel.locator('strong').allTextContents(),['공격력']);
      await page.waitForTimeout(40);
      await page.keyboard.press('Escape');assert.equal(await panel.getAttribute('aria-hidden'),'true');
      await page.locator('#none').hover();assert.equal(await panel.getAttribute('aria-hidden'),'true');
      await page.locator('#none').evaluate(el=>el.textContent='시험');await page.locator('#none').focus();
      assert.equal(await panel.locator('img').count(),0);assert.ok((await panel.innerText()).includes('<img'));
      await page.evaluate(()=>{document.getElementById('reward').style.left=(innerWidth-290)+'px';document.getElementById('reward').focus();});
      await page.waitForTimeout(40);
      if(width>1000)assert.ok(await panel.evaluate(el=>el.getBoundingClientRect().right<=document.getElementById('reward').getBoundingClientRect().left));
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('Glossary: skill/reward/stat hover, focus, side placement, mobile bounds, deduplication and escaped sheet text passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
