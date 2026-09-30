import {distance,arrivalEligible,validPoint} from './core.mjs';
import {createSearch} from './search.mjs';
import {createWalkMap} from './map.mjs';
const $=s=>document.querySelector(s);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const array=key=>{const v=read(key,[]);return Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[]};
let notes=array('michi-log'),visited=array('michi-visited'),skipped=read('michi-skipped',[]);
if(!Array.isArray(skipped))skipped=[];
let trip=read('michi-trip',null);
if(!trip||!validPoint(trip.spot?.point)||typeof trip.spot?.id!=='string')trip=null;
let genre=trip?.genre||'おまかせ',km=trip?.radius?trip.radius/1000:1.2,watch=null,trackingEpoch=0,busy=false,active=false,remaining=null,fix=null,insideSince=null,toastTimer;
let editingIndex=null,searchController=null,searchRequest=0,resumeAfterSearch=false;
function message(text,error=false){$('#message').textContent=text;$('#message').classList.toggle('error',error)}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000)}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{message('保存容量が不足しているか、保存が許可されていません。バックアップを取得してください。',true);return false}}
function persist(){write('michi-trip',trip)}
const walkMap=createWalkMap();
function ui(){
  $('#setup').hidden=!!trip;$('#start').disabled=busy;
  $('#start').textContent=busy?'検索中…':'行き先を探す';
  $('#cancel-search').hidden=!busy;
  for(const selector of ['#genres button','#length button','#finish','#pause','#locate'])document.querySelectorAll(selector).forEach(b=>b.disabled=busy);
  $('#resume').hidden=!trip||active||trip.arrived;$('#resume').disabled=busy;
  $('#pause').hidden=!active;$('#skip').hidden=!trip||trip.arrived;$('#skip').disabled=busy;
  $('#finish').hidden=!trip;$('#overview').hidden=!trip;
  $('#phase').textContent=busy?'検索中':trip?.arrived?'到着':trip?active?'散歩中':'一時停止':'WALK';
  $('#destination').textContent=trip?.arrived?trip.spot.name:'今日の行き先';
  walkMap.setTrip(trip);
  $('#hint').textContent=trip?.arrived?'到着しました。日記に残しておきましょう。':!trip?'ジャンルと範囲を選んでください。':!active?'目的地は保存されています。':'地図を動かして、歩く道を確認できます。';
}
$('#overview').onclick=()=>walkMap.overview();
$('#map-retry').onclick=()=>walkMap.retry();
$('#locate').onclick=()=>{
  if(!navigator.geolocation){message('位置情報を利用できません。',true);return}
  $('#locate').disabled=true;
  navigator.geolocation.getCurrentPosition(p=>{
    walkMap.setCurrent([p.coords.latitude,p.coords.longitude],p.coords.accuracy);
    walkMap.centerCurrent();$('#locate').disabled=false;
  },e=>{geoError(e);$('#locate').disabled=false},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
};
function stop(){trackingEpoch++;if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;active=false;insideSince=null;walkMap.markStale()}
function geoError(e){insideSince=null;walkMap.markStale();$('#gps').textContent=e.code===1?'位置情報が許可されていません。ブラウザの設定をご確認ください。':'現在地を取得できません。空の見える場所で再開してください。';if(e.code===1){stop();ui()}}
function update(p){
  if(!trip||trip.arrived||!active)return;
  const c=p.coords,point=[c.latitude,c.longitude];
  if(!validPoint(point)||Date.now()-p.timestamp>15000){insideSince=null;return}
  fix=p;remaining=distance(point,trip.spot.point);walkMap.setCurrent(point,c.accuracy);trip.lastPoint=point;persist();
  $('#gps').textContent='GPS精度 約±'+Math.round(c.accuracy)+' m · '+new Date(p.timestamp).toLocaleTimeString('ja-JP')+' 更新';
  if(!Number.isFinite(c.accuracy)||c.accuracy>60){insideSince=null;$('#gps').textContent+=' · 精度が低いため到着判定を保留';}
  if(arrivalEligible(remaining,c.accuracy)){
    if(insideSince===null)insideSince=p.timestamp;
    else if(p.timestamp-insideSince>=5000){arrive();return}
  }else insideSince=null;
  ui();
}
function track(){
  if(!navigator.geolocation){message('このブラウザでは位置情報を利用できません。',true);return}
  stop();active=true;fix=null;
  const epoch=trackingEpoch;
  watch=navigator.geolocation.watchPosition(p=>{if(epoch===trackingEpoch)update(p)},e=>{if(epoch===trackingEpoch)geoError(e)},{enableHighAccuracy:true,maximumAge:0,timeout:20000});ui();
}
function arrive(){
  trip.arrived=true;trip.arrivedAt=new Date().toISOString();
  if(!visited.some(v=>v.id===trip.spot.id)){visited.push({...trip.spot,date:trip.arrivedAt,genre:trip.genre});write('michi-visited',visited)}
  persist();stop();ui();toast('到着しました。おつかれさま。');
}
const search=createSearch();
async function begin(replace=false){
  if(busy)return;
  if(!navigator.onLine){message('新しい目的地の検索にはインターネット接続が必要です。',true);return}
  if(!navigator.geolocation){message('位置情報を利用できません。',true);return}
  const request=++searchRequest;
  searchController=new AbortController();
  resumeAfterSearch=active;const wasActive=active;const oldTrip=trip;
  if(active)stop();busy=true;ui();message('現在地を確認しています…');
  try{
    const p=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:20000}));
    if(request!==searchRequest)return;
    if(!Number.isFinite(p.coords.accuracy)||p.coords.accuracy>100)throw Error('現在地の誤差が大きいため、空の見える場所で再度お試しください。');
    const rejected=replace&&oldTrip?[...new Set([...(oldTrip.rejected||[]),oldTrip.spot.id])]:[];
    const list=await search([p.coords.latitude,p.coords.longitude],genre,km*1000,visited,[...skipped,...rejected],text=>message(text),{signal:searchController.signal});
    if(request!==searchRequest)return;
    if(!list.length)throw Error('この範囲には未訪問の候補がありません。ジャンルか距離を変更してください。');
    trip={spot:list[Math.floor(Math.random()*list.length)],genre,radius:km*1000,rejected,origin:[p.coords.latitude,p.coords.longitude],startedAt:new Date().toISOString(),arrived:false};
    remaining=trip.spot.meters;walkMap.setCurrent(trip.origin,p.coords.accuracy);persist();message('行き先が決まりました。');track();
  }catch(e){if(request!==searchRequest)return;
    if(wasActive&&trip)track();
    message(e.code===1?'位置情報の利用を許可してください。':e.name==='AbortError'?'検索が時間切れになりました。再度お試しください。':e.message||'現在地を取得できませんでした。',true)}
  finally{if(request===searchRequest){busy=false;searchController=null;ui()}}
}
$('#start').onclick=()=>begin();
$('#cancel-search').onclick=()=>{searchRequest++;searchController?.abort();searchController=null;busy=false;if(resumeAfterSearch&&trip)track();message(trip?'検索を中止しました。元の目的地を残しています。':'検索を中止しました。');ui()};
$('#pause').onclick=()=>{stop();ui()};
$('#resume').onclick=()=>{message('');track()};
$('#finish').onclick=()=>{if(!trip.arrived&&!confirm('この散歩を終了しますか？訪問済みにはしません。'))return;stop();trip=null;remaining=null;persist();$('#gps').textContent='';message('');ui()};
$('#skip').onclick=()=>begin(true);
$('#genres').onclick=e=>{const b=e.target.closest('button');if(!b||busy)return;genre=b.textContent;for(const x of $('#genres').children){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))}};
$('#length').onclick=e=>{const b=e.target.closest('button');if(!b||busy)return;km=Number(b.dataset.km);for(const x of $('#length').children){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))}};
function view(diary){if(!diary)requestAnimationFrame(()=>walkMap.resize());$('#walk-view').hidden=diary;$('#diary-view').hidden=!diary;$('#diary-tab').classList.toggle('active',diary);$('#walk-tab').classList.toggle('active',!diary)}
$('#walk-tab').onclick=()=>view(false);$('#diary-tab').onclick=()=>view(true);
function renderNotes(){
  $('#count').textContent=notes.length+'件';$('#entries').replaceChildren();
  if(!notes.length){$('#entries').textContent='散歩の途中のひとことを、ここに。';return}
  for(const [index,n] of notes.entries()){const article=document.createElement('article');article.className='entry';const content=document.createElement('div'),title=document.createElement('p'),meta=document.createElement('p');title.className='entry-title';title.textContent=n.title;meta.className='entry-meta';meta.textContent=[n.date,n.genre,n.place].filter(Boolean).join(' · ');content.append(title,meta);
    const actions=document.createElement('div');actions.className='actions note-actions';
    const edit=document.createElement('button'),remove=document.createElement('button');edit.textContent='編集';remove.textContent='削除';
    edit.onclick=()=>openEditor(index);remove.onclick=()=>{if(!confirm('この日記を削除しますか？'))return;const next=notes.filter((_,i)=>i!==index);if(write('michi-log',next)){notes=next;renderNotes();toast('日記を削除しました')}};
    actions.append(edit,remove);content.append(actions);article.append(content);$('#entries').append(article)}
}
function openEditor(index=null){editingIndex=index;$('#editor-title').textContent=index===null?'日記を書く':'日記を編集';$('#note').value=index===null?'':notes[index].title;$('#editor').showModal();$('#note').focus()}
$('#save').onclick=()=>openEditor();
$('#cancel-note').onclick=()=>$('#editor').close();
$('#note-form').onsubmit=e=>{e.preventDefault();const title=$('#note').value.trim();if(!title)return;const next=editingIndex===null?[{title,date:new Date().toLocaleDateString('ja-JP'),genre:trip?.genre||genre,place:trip?.arrived?trip.spot.name:null},...notes]:notes.map((note,index)=>index===editingIndex?{...note,title}:note);if(!write('michi-log',next))return;notes=next;renderNotes();$('#editor').close();$('#note').value='';view(true);toast('散歩日記に保存しました')};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,notes,visited,skipped,trip},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='michi-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)};
document.addEventListener('visibilitychange',()=>{if(document.hidden){walkMap.markStale()}else if(active&&trip){track();message('画面復帰後の現在地を確認しています…')}});
window.addEventListener('pagehide',()=>{stop()});
window.addEventListener('pageshow',()=>ui());
setInterval(()=>{if(active&&fix&&Date.now()-fix.timestamp>20000){insideSince=null;walkMap.markStale();$('#gps').textContent='GPS情報が古くなっています。現在地を取得中…';}},2000);
$('#today').textContent=new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
function connectivity(){$('#offline').textContent=navigator.onLine?'michi 0.4 · 日記はこの端末に保存':'michi 0.4 · オフライン（新規検索不可）'}
window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').hidden=false});
$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{type:'module'}).catch(()=>message('オフライン用の保存ができませんでした。オンラインでは利用できます。',true));
for(const b of document.querySelectorAll('#genres button')){b.classList.toggle('active',b.textContent===genre);b.setAttribute('aria-pressed',String(b.textContent===genre))}
for(const b of document.querySelectorAll('#length button')){b.classList.toggle('active',Number(b.dataset.km)===km);b.setAttribute('aria-pressed',String(Number(b.dataset.km)===km))}
renderNotes();connectivity();ui();
if(trip?.lastPoint||trip?.origin)walkMap.setCurrent(trip.lastPoint||trip.origin,null,true);
if(trip)message(trip.arrived?'前回の到着記録です。':'前回の散歩を再開できます。');
