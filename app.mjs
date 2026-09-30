import {distance,bearing,delta,formatDistance,query,candidates,compassHeading,arrivalEligible,validPoint} from './core.mjs';
const $=s=>document.querySelector(s);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const array=key=>{const v=read(key,[]);return Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[]};
let notes=array('michi-log'),visited=array('michi-visited'),skipped=read('michi-skipped',[]);
if(!Array.isArray(skipped))skipped=[];
let trip=read('michi-trip',null);
if(!trip||!validPoint(trip.spot?.point)||typeof trip.spot?.id!=='string')trip=null;
let genre='おまかせ',km=1.2,watch=null,trackingEpoch=0,busy=false,active=false,heading=null,headingAt=0,rotation=0,remaining=null,azimuth=null,fix=null,insideSince=null,toastTimer;
function message(text,error=false){$('#message').textContent=text;$('#message').classList.toggle('error',error)}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000)}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{message('保存容量が不足しているか、保存が許可されていません。バックアップを取得してください。',true);return false}}
function persist(){write('michi-trip',trip)}
function ui(){
  $('#setup').hidden=!!trip;$('#start').disabled=busy;
  $('#start').textContent=busy?'近くの場所を探しています…':'この散歩をはじめる';
  $('#resume').hidden=!trip||active||trip.arrived;$('#resume').disabled=busy;
  $('#pause').hidden=!active;$('#skip').hidden=!trip||trip.arrived;$('#skip').disabled=busy;
  $('#finish').hidden=!trip;$('#map').hidden=!trip;
  $('#phase').textContent=trip?.arrived?'きょうの発見':trip?active?'散歩中':'散歩を一時停止':'きょうの行き先';
  $('#destination').textContent=trip?.arrived?trip.spot.name:trip?'名前は、到着してから':'まだ名前のない場所';
  if(trip)$('#map').href='https://www.openstreetmap.org/?mlat='+trip.spot.point[0]+'&mlon='+trip.spot.point[1]+'#map=18/'+trip.spot.point.join('/');
  $('#distance').textContent=remaining===null?'—':formatDistance(remaining);
  paintCompass();
}
function paintCompass(){
  const available=active&&azimuth!==null&&heading!==null&&Date.now()-headingAt<5000&&!trip?.arrived;
  $('#needle').classList.toggle('unavailable',!available);
  if(available){rotation+=delta(((rotation%360)+360)%360,((azimuth-heading)%360+360)%360);$('#needle').style.transform='rotate('+rotation+'deg)';$('#needle').setAttribute('aria-label','目的地への方向');}
  $('#hint').textContent=trip?.arrived?'到着を記録しました。今日のひとことを残しましょう。':!trip?'ジャンルと距離を選んではじめましょう':!active?'再開すると現在地と方角を更新します':available?'スマホを水平に持ってください · 距離は直線です':azimuth===null?'現在地の更新を待っています':'方位未取得 · コンパスを有効にしてください（目的地は北基準で約'+Math.round(azimuth)+'°）';
}
function orientation(e){const h=compassHeading(e,screen.orientation?.angle??window.orientation??0);if(h===null)return;heading=heading===null?h:heading+delta(((heading%360)+360)%360,h)*.3;headingAt=Date.now();paintCompass()}
window.addEventListener('deviceorientationabsolute',orientation);
window.addEventListener('deviceorientation',orientation);
async function enableCompass(){
  try{
    if(typeof DeviceOrientationEvent==='undefined')throw Error('この端末では方位センサーを利用できません。距離表示と地図をご利用ください。');
    if(typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission(true)!=='granted')throw Error('コンパスの利用が許可されませんでした。ブラウザの設定をご確認ください。');
    toast('スマホを水平にして、方位の取得をお待ちください。');
  }catch(e){message(e.message,true)}
}
$('#compass').onclick=enableCompass;
function stop(){trackingEpoch++;if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;active=false;insideSince=null;paintCompass()}
function geoError(e){insideSince=null;azimuth=null;paintCompass();$('#gps').textContent=e.code===1?'位置情報が許可されていません。ブラウザの設定をご確認ください。':'現在地を取得できません。空の見える場所で再開してください。';if(e.code===1){stop();ui()}}
function update(p){
  if(!trip||trip.arrived||!active)return;
  const c=p.coords,point=[c.latitude,c.longitude];
  if(!validPoint(point)||Date.now()-p.timestamp>15000){insideSince=null;return}
  fix=p;remaining=distance(point,trip.spot.point);azimuth=bearing(point,trip.spot.point);
  $('#gps').textContent='GPS精度 約±'+Math.round(c.accuracy)+' m · '+new Date(p.timestamp).toLocaleTimeString('ja-JP')+' 更新';
  if(!Number.isFinite(c.accuracy)||c.accuracy>60){insideSince=null;azimuth=null;$('#gps').textContent+=' · 精度が低いため方角・到着判定を保留';}
  if(arrivalEligible(remaining,c.accuracy)){
    if(insideSince===null)insideSince=p.timestamp;
    else if(p.timestamp-insideSince>=5000){arrive();return}
  }else insideSince=null;
  ui();
}
function track(){
  if(!navigator.geolocation){message('このブラウザでは位置情報を利用できません。',true);return}
  stop();active=true;fix=null;azimuth=null;headingAt=0;
  const epoch=trackingEpoch;
  watch=navigator.geolocation.watchPosition(p=>{if(epoch===trackingEpoch)update(p)},e=>{if(epoch===trackingEpoch)geoError(e)},{enableHighAccuracy:true,maximumAge:0,timeout:20000});ui();
}
function arrive(){
  trip.arrived=true;trip.arrivedAt=new Date().toISOString();
  if(!visited.some(v=>v.id===trip.spot.id)){visited.push({...trip.spot,date:trip.arrivedAt,genre:trip.genre});write('michi-visited',visited)}
  persist();stop();ui();toast('到着しました。おつかれさま。');
}
async function search(point,g,r){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{
    const response=await fetch('https://overpass-api.de/api/interpreter?'+new URLSearchParams({data:query(g,point,r)}),{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error(response.status===429?'検索サービスが混み合っています。少し待ってお試しください。':'スポット検索に接続できませんでした。');
    const data=await response.json();if(data.remark||!Array.isArray(data.elements))throw Error('検索が完了しませんでした。少し待ってお試しください。');
    return candidates(data.elements,point,r,visited,skipped);
  }finally{clearTimeout(timer)}
}
async function begin(){
  if(busy)return;
  if(!navigator.onLine){message('新しい目的地の検索にはインターネット接続が必要です。',true);return}
  if(!navigator.geolocation){message('位置情報を利用できません。',true);return}
  busy=true;ui();message('現在地と、近くのスポットを確認しています…');
  try{
    const p=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:20000}));
    if(p.coords.accuracy>100)throw Error('現在地の誤差が大きいため、空の見える場所で再度お試しください。');
    const list=await search([p.coords.latitude,p.coords.longitude],genre,km*1000);
    if(!list.length)throw Error('この範囲には未訪問の候補がありません。ジャンルか距離を変更してください。');
    trip={spot:list[Math.floor(Math.random()*list.length)],genre,startedAt:new Date().toISOString(),arrived:false};
    remaining=trip.spot.meters;persist();message('行き先が決まりました。無理のない道で向かいましょう。');track();
  }catch(e){message(e.code===1?'位置情報の利用を許可してください。':e.name==='AbortError'?'検索が時間切れになりました。再度お試しください。':e.message||'現在地を取得できませんでした。',true)}
  finally{busy=false;ui()}
}
$('#start').onclick=()=>{void enableCompass();void begin()};
$('#pause').onclick=()=>{stop();ui()};
$('#resume').onclick=()=>{void enableCompass();message('');track()};
$('#finish').onclick=()=>{if(!trip.arrived&&!confirm('この散歩を終了しますか？訪問済みにはしません。'))return;stop();trip=null;remaining=null;azimuth=null;persist();$('#gps').textContent='';message('');ui()};
$('#skip').onclick=()=>{if(!confirm('この場所を今後の候補から外しますか？'))return;skipped.push(trip.spot.id);write('michi-skipped',skipped);stop();trip=null;remaining=null;azimuth=null;persist();ui();message('候補から外しました。条件を選んで新しい散歩をはじめられます。')};
$('#genres').onclick=e=>{const b=e.target.closest('button');if(!b||busy)return;genre=b.textContent;for(const x of $('#genres').children){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))}};
$('#length').onclick=e=>{const b=e.target.closest('button');if(!b||busy)return;km=Number(b.dataset.km);for(const x of $('#length').children){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))}};
function view(diary){$('#walk-view').hidden=diary;$('#diary-view').hidden=!diary;$('#diary-tab').classList.toggle('active',diary);$('#walk-tab').classList.toggle('active',!diary)}
$('#walk-tab').onclick=()=>view(false);$('#diary-tab').onclick=()=>view(true);
function renderNotes(){
  $('#count').textContent=notes.length+' entries';$('#entries').replaceChildren();
  if(!notes.length){$('#entries').textContent='散歩の途中のひとことを、ここに。';return}
  for(const n of notes){const article=document.createElement('article');article.className='entry';const content=document.createElement('div'),title=document.createElement('p'),meta=document.createElement('p');title.className='entry-title';title.textContent=n.title;meta.className='entry-meta';meta.textContent=[n.date,n.genre,n.place].filter(Boolean).join(' · ');content.append(title,meta);article.append(content);$('#entries').append(article)}
}
$('#save').onclick=()=>{$('#editor').showModal();$('#note').focus()};
$('#cancel-note').onclick=()=>$('#editor').close();
$('#note-form').onsubmit=e=>{e.preventDefault();const title=$('#note').value.trim();if(!title)return;const next=[{title,date:new Date().toLocaleDateString('ja-JP'),genre:trip?.genre||genre,place:trip?.arrived?trip.spot.name:null},...notes];if(!write('michi-log',next))return;notes=next;renderNotes();$('#editor').close();$('#note').value='';view(true);toast('散歩日記に保存しました')};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,notes,visited,skipped,trip},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='michi-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)};
document.addEventListener('visibilitychange',()=>{if(document.hidden){headingAt=0;paintCompass()}else if(active&&trip){track();message('画面復帰後の現在地を確認しています…')}});
window.addEventListener('pagehide',()=>{stop()});
window.addEventListener('pageshow',()=>ui());
setInterval(()=>{if(active&&fix&&Date.now()-fix.timestamp>20000){azimuth=null;insideSince=null;$('#gps').textContent='GPS情報が古くなっています。現在地を取得中…';}paintCompass()},2000);
$('#today').textContent=new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
function connectivity(){$('#offline').textContent=navigator.onLine?'michi 0.2 · 日記はこの端末に保存':'オフライン · 新しい目的地の検索はできません'}
window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').hidden=false});
$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{type:'module'}).catch(()=>message('オフライン用の保存ができませんでした。オンラインでは利用できます。',true));
renderNotes();connectivity();ui();
if(trip)message(trip.arrived?'前回の到着記録を復元しました。':'前回の目的地を復元しました。「散歩を再開」で続けられます。');
