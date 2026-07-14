import { chromium } from "playwright";
import { WIDGETS, STORES, readTranscript } from "../vendors.js";
import { convoValidity, detectHandover, isGen, isAck, isNoAnswer } from "../classify.js";
import { SHOPPING_THEMES } from "../pools.js";
import { writeFile } from "node:fs/promises";
const store=STORES.find(s=>s.key==="rufus-amazon"), w=WIDGETS[store.widget];
const STATE=new URL("./amazon-state.json",import.meta.url).pathname, STAMP=process.env.RUN_DATE||"2026-07-07";
const REAL_UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const POLL=250,STABLE=5000,SETTLE=2500,TT=Number(process.env.TURN_TIMEOUT_MS)||45000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)), L=(...a)=>console.log(new Date().toISOString()+" "+a.join(" "));
// 5 diverse products (discovered via bestsellers) × 4 themes = 20 convs
const PRODUCTS=[["blinkcam","B08JHCVHTY"],["basics-sheets","B00Q7OAPM6"],["medicube-pads","B09V7Z4TJG"],["owala-bottle","B0BZYCJK89"],["fd-blueberries","B0DPGSZBGS"]];
const THEMES=SHOPPING_THEMES.filter(t=>["everyday-value","gift","problem-solver","compare-budget"].includes(t.key));
async function timeTurn(page,scope,sendFn,q){
  const before=(await readTranscript(page,scope)).len, REPLY_MIN=(q?q.length:80)+110, t0=Date.now(); await sendFn();
  let lastLen=before,lastChange=t0,ttft=null,sawGen=false,grown=false,complete=null,ge=0,trough=before; const dl=t0+TT;
  while(Date.now()<dl){ await sleep(POLL); const {len,text}=await readTranscript(page,scope);
    if(len!==lastLen){lastChange=Date.now();if(len>lastLen)ge++;lastLen=len;} if(len<trough)trough=len;
    if(isGen(text))sawGen=true; if(len>trough+REPLY_MIN){grown=true;if(ttft==null)ttft=Date.now()-t0;}
    const working=isGen(text)||(isAck(text)&&(len-trough)<240), settled=Date.now()-lastChange>STABLE, real=(grown||(sawGen&&len>trough+40))&&!isNoAnswer(text);
    if(settled&&!working&&real){complete=lastChange-t0;break;} }
  return {ttft_ms:ttft,complete_ms:complete,grew:lastLen-before,growth_events:ge};
}
const b=await chromium.launch({headless:false,channel:"chrome",args:["--disable-blink-features=AutomationControlled"]});
let done=0;
for(const [pname,asin] of PRODUCTS){ for(const theme of THEMES){
  if(done>=20) break;
  const url="https://www.amazon.com/dp/"+asin;
  const ctx=await b.newContext({viewport:{width:1366,height:900},locale:"en-US",timezoneId:"America/New_York",userAgent:REAL_UA,extraHTTPHeaders:{"Accept-Language":"en-US,en;q=0.9"},storageState:STATE});
  await ctx.addInitScript(()=>Object.defineProperty(navigator,"webdriver",{get:()=>undefined}));
  const page=await ctx.newPage();
  const tkey=theme.key+"-"+pname;
  const out={key:store.key,vendor:store.vendor,store:store.store,url,us:!!store.us,widget:store.widget,mode:"shopping",theme:tkey,themeLabel:(theme.label||theme.key)+" · "+pname,date:STAMP,capturedAt:new Date().toISOString(),capture:{origin:"claude",loggedIn:true,product:asin},turns:[]};
  try{
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000}); await sleep(3500); await w.open(page);
    let ho=false;
    for(let i=0;i<theme.turns.length;i++){ const q=theme.turns[i];
      if(ho){out.turns.push({turn:i+1,q,by:"human",ttft_ms:null,complete_ms:null,ai_latency_ms:null,handover:false,handover_hit:null,unsent:true,replyTail:"(not sent)"});continue;}
      const beforeText=(await readTranscript(page,w.scope)).text;
      const r=await timeTurn(page,w.scope,()=>w.send(page,q),q).catch(e=>({ttft_ms:null,complete_ms:null,error:String(e).slice(0,80)}));
      const afterText=(await readTranscript(page,w.scope)).text;
      const tail=afterText.slice(-700);
      // FULL turn reply, head preserved (inner container grows monotonically → prefix delta)
      let p=0; const mm=Math.min(beforeText.length,afterText.length);
      while(p<mm&&beforeText[p]===afterText[p])p++;
      let replyFull=(p>=beforeText.length*0.7?afterText.slice(p):afterText).trim();
      replyFull=replyFull.length>4000?replyFull.slice(0,4000)+"…":replyFull;
      const hv=detectHandover(tail,w.handover,[store.store,store.vendor,...(store.personas||[])]); if(hv)ho=true;
      const by=ho?"human":"ai";
      out.turns.push({turn:i+1,q,by,...r,ai_latency_ms:by==="ai"?r.complete_ms:null,handover:!!hv,handover_hit:hv,replyTail:tail.slice(-500),replyText:replyFull});
      await sleep(SETTLE);
    }
  }catch(e){out.error=String(e).slice(0,200);}
  await ctx.close();
  const aiV=out.turns.filter(t=>t.by==="ai").map(t=>t.complete_ms).filter(x=>x!=null), ans=out.turns.filter(t=>t.by==="ai"&&t.complete_ms!=null).length, fh=out.turns.find(t=>t.handover), v=convoValidity(out.turns);
  out.valid=v.valid; out.invalid_reason=v.reason;
  out.stats={turns:out.turns.length,answered_no_handover:ans,success_rate:out.turns.length?Math.round(ans/out.turns.length*100):null,avg_ms:aiV.length?Math.round(aiV.reduce((a,x)=>a+x,0)/aiV.length):null,min_ms:aiV.length?Math.min(...aiV):null,max_ms:aiV.length?Math.max(...aiV):null,latency_basis:"AI turns only",handover_turn:fh?fh.turn:null,valid:v.valid,timed_turns:v.timed};
  await writeFile(`results/${STAMP}/conv/rufus-amazon-shopping-${tkey}.json`,JSON.stringify(out));
  done++;
  L(`[${done}/20 ${tkey}] ${v.valid?"VALID":"inv"} timed=${v.timed} avg=${out.stats.avg_ms}ms`);
}}
await b.close(); L("RUFUS +20 DONE ("+done+")");
