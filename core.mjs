const rad = Math.PI / 180;
export const normalize = x => ((x % 360) + 360) % 360;
export const delta = (a, b) => ((b - a + 540) % 360) - 180;
export function distance(a, b) {
  const x = Math.sin((b[0]-a[0])*rad/2)**2 +
    Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin((b[1]-a[1])*rad/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1,x))));
}
export function bearing(a,b) {
  const d=(b[1]-a[1])*rad;
  return normalize(Math.atan2(Math.sin(d)*Math.cos(b[0]*rad),
    Math.cos(a[0]*rad)*Math.sin(b[0]*rad)-Math.sin(a[0]*rad)*Math.cos(b[0]*rad)*Math.cos(d))/rad);
}
export const validPoint = p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite) && Math.abs(p[0])<=90 && Math.abs(p[1])<=180;
export const formatDistance = m => m < 1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km';
const filters = {
  'ひと息': ['["amenity"="cafe"]','["leisure"="park"]','["leisure"="garden"]'],
  '街の発見': ['["historic"~"^(monument|memorial)$"]','["amenity"="place_of_worship"]','["amenity"="library"]'],
  '緑を歩く': ['["leisure"="park"]','["leisure"="garden"]'],
  '写真散歩': ['["tourism"~"^(viewpoint|artwork)$"]','["historic"~"^(monument|memorial)$"]']
};
export function query(genre,point,radius) {
  if(!validPoint(point)||!Number.isFinite(radius)||radius<200||radius>5000) throw Error('検索範囲が不正です');
  const selected=genre==='おまかせ'?[...new Set(Object.values(filters).flat())]:filters[genre];
  if(!selected) throw Error('ジャンルが不正です');
  return '[out:json][timeout:20];('+selected.map(f=>'nwr'+f+'[name]["access"!~"^(private|no|customers|permit)$"]["foot"!~"^(private|no)$"](around:'+radius+','+point.join(',')+');').join('')+');out center tags;';
}
export function candidates(elements,origin,radius,visited=[],skipped=[]) {
  const seen=new Set();
  return elements.flatMap(el=>{
    const tags=el.tags||{},point=[el.lat??el.center?.lat,el.lon??el.center?.lon],id=el.type+'/'+el.id;
    if(!['node','way','relation'].includes(el.type)||!Number.isFinite(el.id)||!validPoint(point)||!tags.name||seen.has(id))return [];
    seen.add(id);
    if(/^(private|no|customers|permit)$/.test(tags.access)||/^(private|no)$/.test(tags.foot)||tags.disused==='yes'||tags.abandoned==='yes')return [];
    const meters=distance(origin,point);
    if(meters<150||meters>radius||skipped.includes(id))return [];
    // Legacy visits lack IDs: only match identical recorded coordinates, never exclude adjacent POIs by radius.
    if(visited.some(v=>v.id===id||(!v.id&&validPoint(v.point)&&distance(v.point,point)<1)))return [];
    return [{id,point,name:String(tags.name),meters}];
  });
}
export function compassHeading(event,angle=0) {
  if(Number.isFinite(event.webkitCompassHeading)) {
    if(Number.isFinite(event.webkitCompassAccuracy)&&(event.webkitCompassAccuracy<0||event.webkitCompassAccuracy>30))return null;
    return normalize(event.webkitCompassHeading+angle);
  }
  if(!(event.absolute===true||event.type==='deviceorientationabsolute')||!Number.isFinite(event.alpha))return null;
  if(!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return normalize(360-event.alpha+angle);
  // Project the top edge of the displayed screen into Earth's horizontal plane.
  const a=event.alpha*rad,b=event.beta*rad,g=event.gamma*rad,s=angle*rad;
  const x=Math.cos(a)*Math.cos(g)-Math.sin(a)*Math.sin(b)*Math.sin(g);
  const y=Math.sin(a)*Math.cos(g)+Math.cos(a)*Math.sin(b)*Math.sin(g);
  const east=x*Math.sin(s)-Math.sin(a)*Math.cos(b)*Math.cos(s);
  const north=y*Math.sin(s)+Math.cos(a)*Math.cos(b)*Math.cos(s);
  if(Math.hypot(east,north)<.2)return null;
  return normalize(Math.atan2(east,north)/rad);
}
export const arrivalEligible=(remaining,accuracy)=>Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=35&&remaining<=50;
