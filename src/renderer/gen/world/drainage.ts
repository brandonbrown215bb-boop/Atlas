import type { Terrain } from './terrain';

/** Outlet-rooted priority flood. Raised flats have a tiny consistent drainage slope. */
export function drainTerrain(terrain: Terrain): number[] {
  const cells=terrain.cells, visited=new Uint8Array(cells.length),downstream=cells.map(()=>-1);
  const heap:Array<{i:number;h:number}>=[];
  const push=(i:number,h:number)=>{let n=heap.length;heap.push({i,h});while(n){const p=(n-1)>>1;if(heap[p]!.h<h||(heap[p]!.h===h&&heap[p]!.i<=i))break;heap[n]=heap[p]!;n=p;}heap[n]={i,h};};
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&(heap[c+1]!.h<heap[c]!.h||(heap[c+1]!.h===heap[c]!.h&&heap[c+1]!.i<heap[c]!.i)))c++;if(heap[c]!.h>last.h||(heap[c]!.h===last.h&&heap[c]!.i>=last.i))break;heap[n]=heap[c]!;n=c;}heap[n]=last;}return first;};
  const ring=terrain.region[0]!,x0=Math.min(...ring.map(p=>p.x)),y0=Math.min(...ring.map(p=>p.y));
  const maxX=(Math.max(...ring.map(p=>p.x))-x0)/terrain.size,maxY=(Math.max(...ring.map(p=>p.y))-y0)/terrain.size;
  cells.forEach((c,i)=>{if(!c.land||c.ring.some(p=>p.x<1e-9||p.y<1e-9||p.x>maxX-1e-9||p.y>maxY-1e-9)){visited[i]=1;push(i,c.elevation);}});
  if(!heap.length&&cells.length){let i=0;cells.forEach((c,j)=>{if(c.elevation<cells[i]!.elevation)i=j;});visited[i]=1;push(i,cells[i]!.elevation);}
  while(heap.length){const current=pop();for(const j of cells[current.i]!.neighbors){if(visited[j])continue;visited[j]=1;downstream[j]=current.i;cells[j]!.elevation=Math.max(cells[j]!.elevation,current.h+1e-9);push(j,cells[j]!.elevation);}}
  return downstream;
}
