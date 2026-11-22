import {spawn, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const media=join(root,'demo','media');
mkdirSync(media,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'recall-media-'));
const db=join(temp,'demo.sqlite3');
copyFileSync(join(root,'demo','recall-demo.sqlite3'),db);
const port=8147, debug=9247;
const app=spawn('python3',['trainer.py','--port',String(port),'--db',db],{cwd:root,stdio:'ignore'});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--remote-debugging-port='+debug,'--remote-allow-origins=*','--user-data-dir='+join(temp,'chrome'),'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function available(url){for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.ok)return r;}catch{}await pause(100);}throw Error('Server not ready: '+url);}
let ws,id=1;const pending=new Map();
async function send(method,params={}){const current=id++;return await new Promise((resolve,reject)=>{pending.set(current,{resolve,reject});ws.send(JSON.stringify({id:current,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timed out: '+expression);}
async function shot(name,full=false){await pause(250);const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full});writeFileSync(join(media,name),Buffer.from(image.data,'base64'));}
async function viewport(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await pause(350);}
let frameCount=0,recording=false,timestamps=[];
async function record(){recording=true;const begun=Date.now();while(recording){const image=await send('Page.captureScreenshot',{format:'jpeg',quality:82,captureBeyondViewport:false});const file='frame-'+String(frameCount).padStart(4,'0')+'.jpg';writeFileSync(join(temp,file),Buffer.from(image.data,'base64'));timestamps.push({file,at:(Date.now()-begun)/1000});frameCount++;await pause(80);}}
function encode(){const lines=[];for(let i=0;i<timestamps.length;i++){lines.push(`file '${timestamps[i].file}'`);lines.push(`duration ${Math.max(.04,(timestamps[i+1]?.at??(timestamps[i].at+.12))-timestamps[i].at).toFixed(3)}`);}lines.push(`file '${timestamps.at(-1).file}'`);writeFileSync(join(temp,'frames.txt'),lines.join('\n')+'\n');const wide=join(media,'recall-demo-widescreen.mp4');const square=join(media,'recall-demo-square.mp4');const run=(args)=>{const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:temp,stdio:'pipe'});if(r.status!==0)throw Error(r.stderr.toString());};run(['-f','concat','-safe','0','-i','frames.txt','-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','medium','-crf','20','-movflags','+faststart','-an',wide]);run(['-i',wide,'-i',join(media,'01-today-desktop.png'),'-filter_complex','[0:v]crop=1080:900:248:0,pad=1080:1080:0:90:color=0x132f38[base];[1:v]crop=155:47:18:34[logo];[base][logo]overlay=25:21,format=yuv420p[out]','-map','[out]','-c:v','libx264','-preset','medium','-crf','21','-movflags','+faststart','-an',square]);return {wide,square};}
try{
 await available('http://127.0.0.1:'+port+'/');
 const tabs=await (await available('http://127.0.0.1:'+debug+'/json/list')).json();
 ws=new WebSocket(tabs[0].webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);};
 await send('Page.enable');await send('Runtime.enable');await viewport(1440,900);
 await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await until("document.querySelector('.today-hero h1')");
 await shot('01-today-desktop.png');
 await evaluate("document.querySelector('[data-view=library]').click()");await until("document.querySelector('.card-row')");await shot('02-library-desktop.png');
 await evaluate("document.querySelector('[data-view=insights]').click()");await until("document.querySelector('.insight-band')");await shot('03-insights-desktop.png');
 await evaluate("document.querySelector('[data-view=data]').click()");await until("document.querySelector('.backup-hero')");await shot('04-backup-desktop.png');
 await viewport(390,844);await evaluate("document.querySelector('[data-view=today]').click()");await until("document.querySelector('.today-hero h1')");await shot('05-today-mobile.png');
 await evaluate("document.querySelector('[data-action=start]').click()");await until("document.querySelector('.study-question')");await evaluate("document.querySelector('[data-action=reveal]').click()");await until("document.querySelector('.rating-row')");await shot('06-study-mobile.png',true);
 await viewport(1440,900);await evaluate("document.querySelector('[data-action=exit-study]').click()");await until("document.querySelector('.today-hero')");
 const recordingPromise=record();
 await pause(2800);
 await evaluate("document.querySelector('[data-view=library]').click()");await until("document.querySelector('.card-row')");await pause(2500);
 await evaluate("document.querySelector('.deck-tile:nth-child(4)').click()");await pause(1100);
 await evaluate("document.querySelector('#card-search').value='coffee';document.querySelector('#card-search').dispatchEvent(new Event('input',{bubbles:true}))");await pause(1300);
 await evaluate("document.querySelector('.search-clear').click()");await pause(400);
 await evaluate("document.querySelector('[data-view=today]').click()");await until("document.querySelector('[data-action=start]')");await pause(1200);
 await evaluate("document.querySelector('[data-action=start]').click()");await until("document.querySelector('.study-question')");await pause(1500);
 await evaluate("document.querySelector('[data-action=reveal]').click()");await until("document.querySelector('.rating-row')");await pause(1700);
 await evaluate("document.querySelector('[data-rating=Good]').click()");await until("document.querySelector('.study-question')");await pause(1100);
 await evaluate("document.querySelector('[data-action=exit-study]').click()");await until("document.querySelector('.today-hero')");
 await evaluate("document.querySelector('[data-view=insights]').click()");await until("document.querySelector('.insight-band')");await pause(2700);
 await evaluate("document.querySelector('[data-view=data]').click()");await until("document.querySelector('.backup-hero')");await pause(1800);
 await evaluate("document.querySelector('[data-view=today]').click()");await until("document.querySelector('.today-hero')");await pause(1500);
 recording=false;await recordingPromise;
 const output=encode();console.log(JSON.stringify({frames:frameCount,...output,media},null,2));
}finally{recording=false;try{ws?.close();}catch{}app.kill('SIGTERM');chrome.kill('SIGTERM');await pause(400);rmSync(temp,{recursive:true,force:true});}
