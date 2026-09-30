export function createWalkMap(){
  const status=document.querySelector('#map-status');
  let map,current,target,currentMarker,targetMarker,targetId=null,loadFailed=false,lastTrip=null,lastAccuracy=null;
  const lngLat=p=>[p[1],p[0]];
  function ensure(point){
    if(map)return true;
    if(!navigator.onLine){status.textContent='オフラインです。地図の表示には通信が必要です。';document.querySelector('#map-retry').hidden=false;return false}
    if(!globalThis.maplibregl||!globalThis.pmtiles){status.textContent='地図を読み込めません。通信を確認して再読み込みしてください。';return false}
    try{
      const protocol=new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles',protocol.tile);
      map=new maplibregl.Map({container:'walk-map',style:'./map-style.json',center:lngLat(point),zoom:15,minZoom:4,maxZoom:18,pitch:0,bearing:0,dragRotate:false,touchPitch:false,attributionControl:true});
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      document.querySelector('#map-placeholder')?.remove();
      map.on('error',()=>{loadFailed=true;document.querySelector('#map-retry').hidden=false;status.textContent='地図を読み込めませんでした。通信を確認し、再読み込みしてください。'});
      map.on('idle',()=>{if(!loadFailed){status.textContent='';document.querySelector('#map-retry').hidden=true;}});
      map.on('load',()=>{if(!loadFailed){status.textContent='';document.querySelector('#map-retry').hidden=true;}map.resize()});
      status.textContent='地図を読み込んでいます…';
      if(point[0]<20||point[0]>46||point[1]<122||point[1]>154)status.textContent='この地図の提供範囲は日本国内です。';
      return true;
    }catch{status.textContent='このブラウザでは地図を表示できません。別のブラウザでお試しください。';return false}
  }
  function overview(){
    if(!map)return;
    map.resize();
    if(current&&target)map.fitBounds(new maplibregl.LngLatBounds(lngLat(current),lngLat(current)).extend(lngLat(target.point)),{padding:65,maxZoom:16,duration:0});
    else if(target)map.jumpTo({center:lngLat(target.point),zoom:15});
    else if(current)map.jumpTo({center:lngLat(current),zoom:15});
  }
  const api={
    setTrip(trip){
      lastTrip=trip;
      const nextId=trip?.spot.id||null,changed=targetId!==nextId;
      targetId=nextId;target=trip?.spot||null;
      if(!target){targetMarker?.remove();targetMarker=null;return}
      if(!ensure(target.point))return;
      if(!targetMarker){
        const wrapper=document.createElement('div'),pin=document.createElement('div'),text=document.createElement('span');
        pin.className='secret-pin';text.textContent='?';pin.append(text);wrapper.append(pin);
        targetMarker=new maplibregl.Marker({element:wrapper,anchor:'bottom'}).setLngLat(lngLat(target.point)).addTo(map);
        targetMarker.setPopup(new maplibregl.Popup({offset:30}));
      }
      const label=trip.arrived?String(target.name):'目的地';
      targetMarker.setLngLat(lngLat(target.point));
      targetMarker.getElement().setAttribute('aria-label',label);
      targetMarker.getElement().querySelector('span').textContent=trip.arrived?'✓':'?';
      targetMarker.getPopup().setText(trip.arrived?String(target.name):'目的地');
      if(changed)overview();
    },
    setCurrent(point,accuracy,stale=false){
      const first=!current;current=point;lastAccuracy=accuracy;
      if(!ensure(point))return;
      if(!currentMarker){
        const dot=document.createElement('div');dot.className='person-pin';dot.setAttribute('aria-label','現在地');
        currentMarker=new maplibregl.Marker({element:dot}).setLngLat(lngLat(point)).addTo(map);
      }
      currentMarker.getElement().classList.toggle('stale',stale||accuracy>60);
      currentMarker.getElement().setAttribute('aria-label',stale?'前回取得した現在地':'現在地');
      currentMarker.setLngLat(lngLat(point));
      if(first)overview();
    },
    markStale(){currentMarker?.getElement().classList.add('stale');currentMarker?.getElement().setAttribute('aria-label','前回取得した現在地')},
    retry(){
      const point=current||target?.point;if(!point)return;
      const savedTrip=lastTrip,savedCurrent=current,accuracy=lastAccuracy;
      map?.remove();map=null;currentMarker=null;targetMarker=null;targetId=null;loadFailed=false;
      document.querySelector('#map-retry').hidden=true;
      if(!ensure(point))return;
      if(savedCurrent)api.setCurrent(savedCurrent,accuracy,true);
      api.setTrip(savedTrip);overview();
    },
    centerCurrent(){if(map&&current){map.resize();map.jumpTo({center:lngLat(current),zoom:16})}},
    overview,
    resize(){map?.resize()}
  };
  return api;
}
