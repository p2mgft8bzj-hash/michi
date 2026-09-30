import {query,candidates,searchAreas} from './core.mjs';
const ENDPOINTS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
export function createSearch({fetcher=(...args)=>fetch(...args),timeout=20000,now=()=>Date.now(),random=Math.random}={}){
  const cache=new Map();
  return async function search(point,genre,radius,visited=[],skipped=[],progress=()=>{},{signal}={}){
    signal?.throwIfAborted();
    const key=query(genre,point,radius),stored=cache.get(key);
    if(stored&&now()-stored.time<300000){
      const cached=candidates(stored.elements,point,radius,visited,skipped);
      if(cached.length)return cached;
    }
    const areas=searchAreas(point,radius,random),collected=[];
    for(let areaIndex=0;areaIndex<areas.length;areaIndex++){
    const area=areas[areaIndex],text=query(genre,area.point,area.radius);
    const failures=[];
    let success=false;
    for(let attempt=0;attempt<ENDPOINTS.length;attempt++){
      progress(attempt?'検索先が混雑しているため、別の検索先で再試行しています…':areas.length===1?'選んだ範囲のスポットを検索しています…':'離れたエリアのスポットを検索しています（'+(areaIndex+1)+' / '+areas.length+'）…');
      signal?.throwIfAborted();
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      try{
        const response=await fetcher(ENDPOINTS[attempt]+'?'+new URLSearchParams({data:text}),{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw Error('HTTP '+response.status);
        const data=await response.json();signal?.throwIfAborted();
        if(data.remark||!Array.isArray(data.elements))throw Error('検索未完了');
        success=true;collected.push(...data.elements);
        cache.set(key,{time:now(),elements:collected});
        if(cache.size>4)cache.delete(cache.keys().next().value);
        const matches=candidates(data.elements,point,radius,visited,skipped);
        if(matches.length)return matches;
        break;
      }catch(e){
        if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
        failures.push(e.name==='AbortError'?'時間切れ':e instanceof TypeError?'通信失敗':e.message);
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
    }
    if(!success)throw Error('検索サービスに接続できませんでした（'+failures.join(' / ')+'）。少し待って再度お試しください。');
    }
    if(areas.length>1)throw Error('調べたエリアには未訪問の候補がありませんでした。もう一度検索すると別の方角を探します。');
    return [];
  };
}
