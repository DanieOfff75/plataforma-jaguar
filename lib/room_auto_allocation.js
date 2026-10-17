/** Planificador puro: 18 grupos (9 por turno), como máximo dos grupos por aula.
 * No modifica horarios; se confirma únicamente mediante RPC transaccional. */
import {fail,overlaps} from './academic_tools_rules.js';
const shift = s => {const x=String(s||'').toLowerCase();return x.includes('matut')?'M':x.includes('vespert')?'V':'?';};
function rotateShuffle(items,seed){let x=(Number(seed)>>>0)||1;const a=[...items];for(let i=a.length-1;i>0;i--){x^=x<<13;x^=x>>>17;x^=x<<5;const j=(x>>>0)%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function planRoomAllocation({groups,rooms,schedule,group_counts,seed=1}){
 const active=groups.filter(g=>g.activo!==false);
 const ms=active.filter(g=>shift(g.turno)==='M'),vs=active.filter(g=>shift(g.turno)==='V');
 if(active.length!==18||ms.length!==9||vs.length!==9)fail(`Se requieren 18 grupos activos (9 matutinos y 9 vespertinos); hay ${active.length}, con ${ms.length} y ${vs.length}.`,409);
 // Un espacio activo no equivale a un salón ordinario: no asignar laboratorios, auditorios ni oficinas.
 const enabled=rooms.filter(r=>r.activo!==false&&r.tipo_espacio==='aula');
 if(enabled.length<9)fail(`Se requieren al menos 9 aulas ordinarias activas (no laboratorios, auditorios ni oficinas); hay ${enabled.length}.`,409);
 const schedules=new Map(active.map(g=>[Number(g.id),[]]));
 const occupants=new Map(enabled.map(r=>[Number(r.id),new Set()]));
 const existing=new Map(), unknown=[];
 const findRoom=name=>enabled.find(r=>String(r.nombre).trim().toUpperCase()===String(name).trim().toUpperCase());
 for(const h of schedule){const g=Number(h.grupo_materias?.grupo_id);if(!schedules.has(g))continue;schedules.get(g).push(h);
   if(!h.aula)continue;const room=findRoom(h.aula);if(!room){unknown.push({grupo_id:g,aula:h.aula});continue;}
   const old=existing.get(g);if(old&&old!==room.id)fail(`El grupo ${g} ya utiliza varias aulas; corrige sus asignaciones manualmente antes de automatizar.`,409);
   existing.set(g,room.id);occupants.get(room.id).add(g);
 }
 if(unknown.length)fail('Hay grupos con horarios asignados a espacios especiales, desconocidos o inactivos. Revísalos manualmente; no se reemplazan sus salones sin autorización.',409);
 if(active.some(g=>!schedules.get(Number(g.id)).length))fail('Hay grupos sin horario cargado. Registra sus horarios antes de asignar aulas automáticamente.',409);
 if([...occupants.values()].some(s=>s.size>2))fail('Hay aulas que ya utilizan más de dos grupos distintos. Corrige esos casos primero.',409);
 const groupById=new Map(active.map(g=>[Number(g.id),g]));
 const sorted=[...active].sort((a,b)=>Number(Boolean(existing.get(Number(b.id))))-Number(Boolean(existing.get(Number(a.id))))||schedules.get(b.id).length-schedules.get(a.id).length||a.id-b.id);
 const orderedRooms=rotateShuffle(enabled,seed),assignments=new Map(existing);
 const eligible=(g,r)=>{if(Number(group_counts[g.id]||0)>Number(r.capacidad))return false;
  const ids=occupants.get(r.id);if(ids.size>=2&&!ids.has(Number(g.id)))return false;
  for(const other of ids){if(other===Number(g.id))continue;
   if(shift(groupById.get(other)?.turno)===shift(g.turno))return false;
   for(const a of schedules.get(g.id))for(const b of schedules.get(other))if(overlaps(a,b))return false;
  }
  return true;};
 for(const g of sorted){if(assignments.has(g.id)){
     const r=enabled.find(x=>x.id===assignments.get(g.id));if(!eligible(g,r))fail(`El aula actual del grupo ${g.clave} incumple capacidad, turno o horario.`,409);continue;}
   const choices=orderedRooms.filter(r=>eligible(g,r));
   choices.sort((a,b)=>{const aa=occupants.get(a.id).size,bb=occupants.get(b.id).size;return bb-aa||orderedRooms.indexOf(a)-orderedRooms.indexOf(b);});
   if(!choices.length)fail(`No existe aula compatible para ${g.clave}. Revisa capacidad, horarios y aulas disponibles.`,409);
   const room=choices[0];assignments.set(g.id,room.id);occupants.get(room.id).add(g.id);
 }
 const pairs=active.map(g=>({grupo_id:Number(g.id),grupo:g.clave,turno:g.turno,aula_id:assignments.get(g.id),aula:enabled.find(r=>r.id===assignments.get(g.id))?.nombre,horarios:schedules.get(g.id).length,conservada:existing.has(g.id)}));
 return {pairs,actualizar:pairs.filter(p=>!p.conservada).length,conservadas:pairs.filter(p=>p.conservada).length};
}
