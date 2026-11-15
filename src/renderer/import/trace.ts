import type { Entity, Point } from '../model/schema';
import { simplifyRDP } from '../geom/simplify';
import { pointInPolygon } from '../geom/hitTest';
export interface TraceOptions { width:number; height:number; pixels:Uint8ClampedArray; sensitivity:number; waterColor?:number[]; mask?:Uint8Array }
export interface TraceResult { width:number; height:number; mask:Uint8Array; land:Point[][][]; lakes:Point[][][]; rivers:Array<{points:Point[];width:number}>; waterFraction:number; warnings?:string[] }

function signedArea(r:Point[]){return r.reduce((s,p,i)=>{const q=r[(i+1)%r.length]!;return s+p.x*q.y-q.x*p.y;},0)/2;}
/** Trace binary pixel boundaries without allocating a polygon for every pixel. */
export function maskPolygons(mask:Uint8Array,w:number,h:number):Point[][][] {
  const stride=w+1,edges=new Map<number,number[]>();
  const edge=(a:number,b:number)=>{const list=edges.get(a)??[];list.push(b);edges.set(a,list);};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
    const a=y*stride+x,b=a+1,c=b+stride,d=a+stride;
    if(y===0||!mask[(y-1)*w+x])edge(a,b);
    if(x===w-1||!mask[y*w+x+1])edge(b,c);
    if(y===h-1||!mask[(y+1)*w+x])edge(c,d);
    if(x===0||!mask[y*w+x-1])edge(d,a);
  }
  const loops:Point[][]=[];
  while(edges.size){
    const first=edges.keys().next().value!;let current=first,previous=-1;
    const ring:Point[]=[];
    for(let guard=0;guard<(w+1)*(h+1)*4;guard++){
      ring.push({x:current%stride,y:Math.floor(current/stride)});
      const nexts=edges.get(current);if(!nexts?.length)break;
      let index=0;
      if(previous>=0&&nexts.length>1){
        const dir=(a:number,b:number)=>b-a===1?0:b-a===stride?1:b-a===-1?2:3;
        const incoming=dir(previous,current),rank=[1,0,3,2];
        index=nexts.reduce((best,n,i)=>rank[(dir(current,n)-incoming+4)%4]!<rank[(dir(current,nexts[best]!)-incoming+4)%4]!?i:best,0);
      }
      const next=nexts.splice(index,1)[0]!;if(!nexts.length)edges.delete(current);
      previous=current;current=next;if(current===first)break;
    }
    if(ring.length>=3&&Math.abs(signedArea(ring))>=2){const simple=simplifyRDP(ring,Math.max(.65,Math.min(w,h)/400),true);if(simple.length>=3)loops.push(simple);}
  }
  const outers=loops.filter(r=>signedArea(r)>0).map(r=>[r]);
  for(const hole of loops.filter(r=>signedArea(r)<0)){
    const outer=outers.filter(p=>pointInPolygon(hole[0]!,[p[0]!])).sort((a,b)=>Math.abs(signedArea(a[0]!))-Math.abs(signedArea(b[0]!)))[0];
    outer?.push(hole);
  }
  return outers;
}

function cleanSmall(mask:Uint8Array,w:number,h:number,value:number,minimum:number){
  const seen=new Uint8Array(mask.length);
  for(let i=0;i<mask.length;i++)if(mask[i]===value&&!seen[i]){
    const queue=[i];seen[i]=1;let border=false;
    for(let j=0;j<queue.length;j++){const n=queue[j]!,x=n%w,y=Math.floor(n/w);border ||= x===0||y===0||x===w-1||y===h-1;
      for(const q of [x?n-1:-1,x<w-1?n+1:-1,y?n-w:-1,y<h-1?n+w:-1])if(q>=0&&!seen[q]&&mask[q]===value){seen[q]=1;queue.push(q);}
    }
    if(queue.length<minimum&&!border)for(const n of queue)mask[n]=1-value;
  }
}
function thin(mask:Uint8Array,w:number,h:number){
  const out=new Uint8Array(mask);let changed=true;
  while(changed){changed=false;
    for(let phase=0;phase<2;phase++){
      const remove:number[]=[];
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const i=y*w+x;if(!out[i])continue;
        const p=[out[i-w]!,out[i-w+1]!,out[i+1]!,out[i+w+1]!,out[i+w]!,out[i+w-1]!,out[i-1]!,out[i-w-1]!];
        const count=p.reduce((s,n)=>s+n,0),changes=p.reduce((s,n,j)=>s+(!n&&p[(j+1)%8]?1:0),0);
        if(count<2||count>6||changes!==1)continue;
        const a=phase?p[0]!*p[2]!*p[6]!:p[0]!*p[2]!*p[4]!,b=phase?p[0]!*p[4]!*p[6]!:p[2]!*p[4]!*p[6]!;
        if(!a&&!b)remove.push(i);
      }
      for(const i of remove)out[i]=0;
      changed ||= remove.length>0;
    }
  }
  return out;
}

export function traceGeography(options:TraceOptions):TraceResult {
  const {width:w,height:h,pixels,sensitivity,waterColor}=options;
  if(w<2||h<2||pixels.length!==w*h*4)throw new Error('Invalid backdrop pixels.');
  const mask=options.mask?new Uint8Array(options.mask):new Uint8Array(w*h);
  if(!options.mask){
    const border=new Map<string,{count:number;color:number[]}>();
    for(let i=0;i<w*h;i++){const x=i%w,y=Math.floor(i/w);if(x>2&&y>2&&x<w-3&&y<h-3)continue;
      const r=pixels[i*4]!,g=pixels[i*4+1]!,b=pixels[i*4+2]!;if(b-r<8||b<g*.78)continue;
      const key=`${r>>4},${g>>4},${b>>4}`,entry=border.get(key)??{count:0,color:[r,g,b]};entry.count++;border.set(key,entry);
    }
    const auto=[...border.values()].sort((a,b)=>b.count-a.count)[0]?.color;
    const target=waterColor??auto;
    for(let i=0;i<mask.length;i++){
      const r=pixels[i*4]!,g=pixels[i*4+1]!,b=pixels[i*4+2]!;
      const blueTone=b-r>=12&&b>=g*.88;
      const match=target&&(waterColor||blueTone)&&Math.hypot(r-target[0]!,g-target[1]!,b-target[2]!)<=sensitivity;
      const blue=!waterColor&&b-r>18&&b>=g*.92;
      mask[i]=pixels[i*4+3]!>16&&(match||blue)?1:0;
    }
    cleanSmall(mask,w,h,0,Math.max(4,Math.round(w*h/100000)));
    cleanSmall(mask,w,h,1,Math.max(15,Math.round(w*h/6000)));
  }
  const distance=new Float32Array(w*h).fill(w+h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(!mask[i])distance[i]=0;
    else distance[i]=Math.min(distance[i]!,x?distance[i-1]!+1:1,y?distance[i-w]!+1:1);
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;distance[i]=Math.min(distance[i]!,x<w-1?distance[i+1]!+1:1,y<h-1?distance[i+w]!+1:1);}
  const body=new Uint8Array(w*h);
  for(let i=0;i<body.length;i++)if(distance[i]!>=3)body[i]=1;
  for(let pass=0;pass<3;pass++){
    const before=new Uint8Array(body);
    for(let i=0;i<body.length;i++)if(mask[i]&&!body[i]){const x=i%w,y=Math.floor(i/w);if((x&&before[i-1])||(x<w-1&&before[i+1])||(y&&before[i-w])||(y<h-1&&before[i+w]))body[i]=1;}
  }
  const riverMask=new Uint8Array(mask.map((n,i)=>n&&!body[i]?1:0)),skeleton=thin(riverMask,w,h);
  const adjacent=(i:number)=>{
    const x=i%w,y=Math.floor(i/w),out:number[]=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&skeleton[i+dy*w+dx]){
      // Prefer orthogonal connections to avoid spurious three-way diagonal nodes.
      if(dx&&dy&&(skeleton[i+dx]||skeleton[i+dy*w]))continue;
      out.push(i+dy*w+dx);
    }return out;
  };
  const visited=new Set<string>(),rivers:TraceResult['rivers']=[];
  let ambiguousChannels=0;
  const minRiverLength=Math.max(6,Math.round(Math.min(w,h)*.035));
  const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  for(let start=0;start<skeleton.length;start++)if(skeleton[start]&&adjacent(start).length!==2){
    for(const next of adjacent(start)){
      if(visited.has(edgeKey(start,next)))continue;
      const chain=[start];let previous=start,at=next;visited.add(edgeKey(previous,at));
      while(true){chain.push(at);const ns=adjacent(at);if(ns.length!==2)break;const q=ns.find(n=>n!==previous)!;if(visited.has(edgeKey(at,q)))break;visited.add(edgeKey(at,q));previous=at;at=q;}
      if(chain.length<minRiverLength)continue;
      let points=chain.map(i=>({x:i%w+.5,y:Math.floor(i/w)+.5}));
      for(const end of [0,points.length-1]){
        const p=points[end]!;let best:Point|undefined,dist=6;
        for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const x=Math.floor(p.x)+dx,y=Math.floor(p.y)+dy;if(x<0||y<0||x>=w||y>=h||!body[y*w+x])continue;const d=Math.hypot(dx,dy);if(d<dist){dist=d;best={x:x+.5,y:y+.5};}}
        if(best)points[end]=best;
      }
      points=simplifyRDP(points,Math.max(.7,Math.min(w,h)/500),false);
      if(points.length>=2){
        if(Math.hypot(points[0]!.x-points[points.length-1]!.x,points[0]!.y-points[points.length-1]!.y)<1){ambiguousChannels++;continue;}
        rivers.push({points,width:Math.max(1,chain.reduce((sum,i)=>sum+distance[i]!*2,0)/chain.length)});
      }
    }
  }
  const landSource=options.mask?mask:body;
  const landMask=new Uint8Array(landSource.map(n=>n?0:1));
  const waterPolygons=maskPolygons(body,w,h);
  const lakes=waterPolygons.filter(poly=>!poly[0]!.some(p=>p.x<=0||p.y<=0||p.x>=w||p.y>=h));
  return {width:w,height:h,mask,land:maskPolygons(landMask,w,h),lakes,rivers,waterFraction:mask.reduce((sum,n)=>sum+n,0)/mask.length,
    warnings:ambiguousChannels?[`${ambiguousChannels} closed or collapsed channels were omitted as ambiguous artwork. Review lakes and add any missing river paths.`]:[]};
}

export function traceEntities(result:TraceResult,image:Extract<Entity,{type:'image'}>,layerId:string):Entity[]{
  const transform=(p:Point):Point=>{const x=p.x/result.width*image.w,y=p.y/result.height*image.h;return{x:image.x+x*Math.cos(image.rotation)-y*Math.sin(image.rotation),y:image.y+x*Math.sin(image.rotation)+y*Math.cos(image.rotation)};};
  const base=()=>({id:crypto.randomUUID(),layerId,origin:'manual' as const,rev:0});
  const entities:Entity[]=[...result.land.map(rings=>({...base(),type:'area' as const,role:'land' as const,name:'Traced land',rings:rings.map(r=>r.map(transform))})),...result.lakes.map(rings=>({...base(),type:'area' as const,role:'water' as const,waterKind:'lake' as const,name:'Traced lake',rings:rings.map(r=>r.map(transform))}))];
  const nodes=new Map<string,string>();
  const node=(p:Point)=>{const key=`${p.x.toFixed(2)},${p.y.toFixed(2)}`;if(!nodes.has(key))nodes.set(key,crypto.randomUUID());return nodes.get(key)!;};
  for(const river of result.rivers)entities.push({...base(),type:'path',role:'river',name:'Traced river',points:river.points.map(transform),width:Math.min(river.width*image.w/result.width,Math.max(6,river.width*12)),closed:false,startNodeId:node(river.points[0]!),endNodeId:node(river.points[river.points.length-1]!)});
  return entities;
}
