import { chromium } from "playwright";
const PDP="https://www.amazon.com/PANFRUIT-Freeze-Dried-Organic-Raspberry-Snacks/dp/B0DX391LXK";
const STATE=new URL("./amazon-state.json",import.meta.url).pathname;
const b=await chromium.launch({headless:false,channel:"chrome",args:["--disable-blink-features=AutomationControlled"]});
const ctx=await b.newContext({storageState:STATE,viewport:{width:1440,height:900},locale:"en-US",timezoneId:"America/New_York"});
await ctx.addInitScript(()=>Object.defineProperty(navigator,"webdriver",{get:()=>undefined}));
const page=await ctx.newPage(); const L=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const convo=()=>page.evaluate(()=>{const p=document.querySelector("#rufus-conversation-container");return p?p.innerText:""}).catch(()=>"");
async function ask(q,label){
  const inp=page.locator("#rufus-text-area").first();
  if(!(await inp.count())){ L(label,"— no #rufus-text-area"); return; }
  await inp.click().catch(()=>{}); await inp.fill(q);
  const before=(await convo()).length; const t0=Date.now();
  await inp.press("Enter");
  let last=before,stable=0,ttft=null;
  for(let i=0;i<45;i++){ await page.waitForTimeout(1000); const t=await convo();
    if(t.length>before+40 && ttft==null) ttft=Date.now()-t0;
    if(t.length!==last){last=t.length;stable=0;}else stable++;
    if(ttft && stable>=4){ break; }
  }
  const full=await convo(); const ans=full.slice(before).replace(/\s+/g," ").trim();
  L(label,"ttft="+(ttft?(ttft/1000).toFixed(1)+"s":"—"),"complete="+((Date.now()-t0)/1000).toFixed(1)+"s");
  L("   A:", ans.slice(0,240)||"(no answer)");
}
try{
  await page.goto(PDP,{waitUntil:"domcontentloaded",timeout:60000}); await page.waitForTimeout(4000);
  await page.locator('#nav-rufus-disco, input[placeholder*="specific info" i]').first().click().catch(()=>{});
  await page.waitForTimeout(3500);
  await ask("Are these raspberries organic, and how many bags come in one order?","Q1");
  await ask("Is there any added sugar, or are they unsweetened?","Q2");
  await ask("What do reviewers say about the taste and crunch?","Q3");
  await page.screenshot({path:"/tmp/rufus-final.png"});
}catch(e){ L("ERR:",e.message.slice(0,150)); }
await b.close();
