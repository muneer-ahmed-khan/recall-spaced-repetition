import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const temp = mkdtempSync(join(tmpdir(), "recall-browser-"));
const reviewDir = join(process.cwd(), ".impeccable", "review");
mkdirSync(reviewDir,{recursive:true});
const app = spawn("python3", ["trainer.py","--port","8137","--db",join(temp,"db.sqlite3")], {stdio:"ignore"});
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
   "--remote-debugging-port=9237","--remote-allow-origins=*",
   "--user-data-dir="+join(temp,"chrome"),"about:blank"], {stdio:"ignore"});
const pause = ms => new Promise(r => setTimeout(r,ms));
async function available(url) {
  for (let i=0;i<100;i++) {
    try { const r=await fetch(url); if(r.ok) return r; } catch {}
    await pause(100);
  }
  throw new Error("Server did not start: "+url);
}
let ws, nextId=1;
const pending=new Map();
async function send(method,params={}) {
  const id=nextId++;
  return await new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const data=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(data.exceptionDetails) throw new Error(data.exceptionDetails.text);
  return data.result.value;
}
async function until(expression) {
  for(let i=0;i<80;i++) {
    if(await evaluate(expression)) return;
    await pause(100);
  }
  console.log("Browser state:", await evaluate("document.body.innerText"));
  throw new Error("Timed out: "+expression);
}
try {
  await available("http://127.0.0.1:8137/");
  const tabs=await (await available("http://127.0.0.1:9237/json/list")).json();
  ws=new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{
    const message=JSON.parse(e.data);
    if(!message.id) return;
    const p=pending.get(message.id); if(!p) return;
    pending.delete(message.id);
    if(message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send("Page.navigate",{url:"http://127.0.0.1:8137/"});
  await until("document.querySelector('.today-hero h1')");
  const width=await evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth})");
  assert.equal(width.viewport,390);
  assert.equal(width.document,390,"Mobile page overflows horizontally");
  const image=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(reviewDir,"today-mobile.png"),Buffer.from(image.data,"base64"));
  await evaluate("document.querySelector('[data-view=library]').click()");
  await until("document.querySelector('h1')?.textContent === 'Your library'");
  await evaluate("document.querySelector('[data-action=new-deck]').click()");
  await evaluate("document.querySelector('[name=name]').value='Spanish'");
  await evaluate("document.querySelector('#editor-form').requestSubmit()");
  await until("!document.querySelector('#editor').open");
  await until("Array.from(document.querySelectorAll('.deck-tile span')).some(x=>x.textContent==='Spanish')");
  await evaluate("document.querySelector('[data-action=new-card]').click()");
  await until("document.querySelector('#editor-deck .choice-trigger')");
  await evaluate("document.querySelector('#editor-deck .choice-trigger').click();document.querySelector('#editor-deck [data-choice-option]:last-child').click()");
  await evaluate("document.querySelector('[name=front]').value='hola';document.querySelector('[name=back]').value='hello'");
  await evaluate("document.querySelector('#editor-form').requestSubmit()");
  await until("!document.querySelector('#editor').open");
  await until("document.querySelector('.card-row h3')?.textContent === 'hola'");
  await evaluate("document.querySelector('[data-action=new-tag]').click()");
  await evaluate("document.querySelector('[name=name]').value='verbs'");
  await evaluate("document.querySelector('#editor-form').requestSubmit()");
  await until("document.querySelector('[data-action=edit-tag]')");
  await evaluate("document.querySelector('[data-action=edit-card]').click()");
  await evaluate("document.querySelector('[data-tag-choice]').click()");
  await evaluate("document.querySelector('#editor-form').requestSubmit()");
  await until("document.querySelector('.card-row .tag')?.textContent === 'verbs'");
  await evaluate("document.querySelector('#card-search').value='verbs';document.querySelector('#card-search').dispatchEvent(new Event('input',{bubbles:true}))");
  await until("document.querySelectorAll('.card-row').length === 1");
  await evaluate("document.querySelector('[data-action=edit-tag]').click()");
  await evaluate("document.querySelector('[name=name]').value='language'");
  await evaluate("document.querySelector('#editor-form').requestSubmit()");
  await until("!document.querySelector('#editor').open");
  await until("document.querySelector('#card-search')");
  await evaluate("document.querySelector('#card-search').value='language';document.querySelector('#card-search').dispatchEvent(new Event('input',{bubbles:true}))");
  await until("document.querySelector('.card-row .tag')?.textContent === 'language'");
  await evaluate("document.querySelector('.search-clear').click()");
  assert.equal(await evaluate("document.querySelector('#card-search').value"),"");
  assert.equal(await evaluate("document.querySelector('.search-clear').hidden"),true);
  await evaluate("document.querySelector('[data-view=today]').click()");
  await until("document.querySelector('#review-tag [data-choice-option]:last-child')");
  await evaluate("document.querySelector('#review-tag .choice-trigger').click();document.querySelector('#review-tag [data-choice-option]:last-child').click()");
  await until("document.querySelector('[data-action=start]')");
  await pause(250);
  assert.equal(await evaluate("document.activeElement.closest('.choice')?.id"),"review-tag");
  assert.equal(await evaluate("document.querySelector('.sidebar nav').scrollWidth <= document.querySelector('.sidebar nav').clientWidth"),true);
  await send("Emulation.setDeviceMetricsOverride",{width:320,height:700,deviceScaleFactor:1,mobile:true});
  await pause(80);
  assert.equal(await evaluate("document.documentElement.scrollWidth"),320);
  assert.equal(await evaluate("document.querySelector('.sidebar nav').scrollWidth <= document.querySelector('.sidebar nav').clientWidth"),true);
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate("window.scrollTo({top:0,behavior:'instant'});document.querySelector('#toast').classList.remove('show')");
  await pause(100);
  const todayDesktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"today-desktop.png"),Buffer.from(todayDesktop.data,"base64"));
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  await evaluate("document.querySelector('[data-action=start]').click()");
  await until("document.querySelector('.study-question')?.textContent === 'hola'");
  await evaluate("document.querySelector('[data-action=exit-study]').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))");
  assert.equal(await evaluate("document.querySelector('.study-answer') === null"),true);
  await evaluate("document.querySelector('#main').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))");
  await until("document.querySelector('.study-answer')?.textContent === 'hello'");
  await pause(350);
  assert.equal(await evaluate("document.querySelectorAll('.rating-icon svg').length"),4);
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const studyMobile=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"study-mobile.png"),Buffer.from(studyMobile.data,"base64"));
  await evaluate("document.querySelector('[data-rating=Good]').click()");
  await until("document.querySelector('h1')?.textContent === 'Good work showing up.'");
  assert.equal(await evaluate("document.querySelector('.completion-receipt')?.innerText.includes('1')"),true);
  assert.equal(await evaluate("document.querySelectorAll('.rating-icon svg').length"),0);
  const completeMobile=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"complete-mobile.png"),Buffer.from(completeMobile.data,"base64"));
  const state=await (await fetch("http://127.0.0.1:8137/api/state")).json();
  assert.equal(state.cards.length,1);
  assert.equal(state.cards[0].interval_days,1);
  await evaluate("document.querySelector('[data-action=finish]').click()");
  await until("document.querySelector('.today-hero h1')");
  await evaluate("document.querySelector('[data-view=insights]').click()");
  await until("document.querySelector('.insight-band')");
  assert.equal(await evaluate("document.querySelector('.nav-item.active')?.dataset.view"),"insights");
  assert.equal(await evaluate("document.documentElement.scrollWidth"),390);
  await pause(100);
  await evaluate("window.scrollTo({top:0,behavior:'instant'});document.querySelector('#toast').classList.remove('show')");
  const insightsMobile=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"insights-mobile.png"),Buffer.from(insightsMobile.data,"base64"));
  await evaluate("document.querySelector('[data-view=data]').click()");
  await until("document.querySelector('#export-deck .choice-trigger')");
  assert.equal(await evaluate("document.querySelectorAll('select,input[type=checkbox]').length"),0);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#csv-file')).display"),"none");
  assert.equal(await evaluate("document.documentElement.scrollWidth"),390);
  await evaluate("document.querySelector('#toast').classList.remove('show')");
  await pause(100);
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const backupMobile=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"backup-mobile.png"),Buffer.from(backupMobile.data,"base64"));
  await evaluate("document.querySelector('#export-deck .choice-trigger').click();document.querySelector('#export-deck [data-choice-option]:last-child').click()");
  assert.notEqual(await evaluate("document.querySelector('#export-deck').dataset.value"),"");
  await evaluate("const f=new File(['front,back,deck,tags\\nWhat is spaced repetition?,A review method,Learning,study\\n'],'sample.csv',{type:'text/csv'});const d=new DataTransfer();d.items.add(f);const i=document.querySelector('#csv-file');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}))");
  await until("document.querySelector('[data-drop=csv] strong')?.textContent === 'sample.csv'");
  await evaluate("document.querySelector('[data-action=import-csv]').click()");
  await until("document.querySelector('.backup-hero-action span')?.textContent.includes('2 cards')");
  await evaluate("(async()=>{const data=await (await fetch('/api/export-json')).json();const f=new File([JSON.stringify(data)],'backup.json',{type:'application/json'});const d=new DataTransfer();d.items.add(f);const i=document.querySelector('#json-file');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await until("document.querySelector('[data-drop=json] strong')?.textContent === 'backup.json'");
  await evaluate("document.querySelector('[data-action=import-json]').click()");
  await until("document.querySelector('#confirm-dialog').open");
  assert.equal(await evaluate("document.querySelector('#confirm-title').textContent"),"Restore this backup?");
  await evaluate("document.querySelector('#confirm-cancel').click()");
  await until("!document.querySelector('#confirm-dialog').open");
  await evaluate("document.querySelector('[data-action=import-json]').click()");
  await until("document.querySelector('#confirm-dialog').open");
  await evaluate("document.querySelector('#confirm-accept').click()");
  await until("!document.querySelector('#confirm-dialog').open");
  await until("document.querySelector('.backup-hero-action span')?.textContent.includes('2 cards')");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await pause(150);
  await evaluate("document.querySelector('#toast').classList.remove('show')");
  assert.equal(await evaluate("document.documentElement.scrollWidth"),1440);
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const backupDesktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"backup-desktop.png"),Buffer.from(backupDesktop.data,"base64"));
  await evaluate("document.querySelector('[data-view=library]').click()");
  await until("document.querySelector('.library-layout')");
  assert.equal(await evaluate("document.querySelector('.nav-item.active')?.dataset.view"),"library");
  await pause(100);
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const libraryDesktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"library-desktop.png"),Buffer.from(libraryDesktop.data,"base64"));
  await evaluate("document.querySelector('[data-action=new-card]').click()");
  await until("document.querySelector('#editor').open");
  assert.equal(await evaluate("document.querySelector('#editor-form [type=submit]').disabled"),false);
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const editorDesktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"editor-desktop.png"),Buffer.from(editorDesktop.data,"base64"));
  assert.equal(await evaluate("document.querySelectorAll('#editor select,#editor input[type=checkbox]').length"),0);
  await evaluate("document.querySelector('#cancel-dialog').click()");
  await evaluate("document.querySelector('.deck-tile[data-id=\"1\"]').click()");
  await evaluate("document.querySelector('[data-action=delete-deck]').click()");
  await until("document.querySelector('#confirm-dialog').open");
  assert.ok((await evaluate("document.querySelector('#confirm-copy').textContent")).includes("1 card"));
  await evaluate("window.scrollTo({top:0,behavior:'instant'})");
  const confirmDesktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(join(reviewDir,"confirm-desktop.png"),Buffer.from(confirmDesktop.data,"base64"));
  await evaluate("document.querySelector('#confirm-cancel').click()");
  await until("!document.querySelector('#confirm-dialog').open");
  console.log("Browser flow passed: custom controls, mobile width, CRUD, filtered review, CSV import, JSON restore, custom confirmations, and desktop/mobile surfaces.");
} finally {
  try {ws?.close();} catch {}
  app.kill("SIGTERM"); chrome.kill("SIGTERM");
  await pause(300);
  rmSync(temp,{recursive:true,force:true});
}
