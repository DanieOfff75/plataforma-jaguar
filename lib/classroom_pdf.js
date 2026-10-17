/** PDF institucional de códigos de Classroom. Descarga sólo por personal autorizado. */
import {readFile} from 'node:fs/promises';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
const BOOK=new URL('../assets/fonts/Garet-Book.ttf',import.meta.url);
const HEAVY=new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url);
const LOGO=new URL('../assets/ithla-logo.png',import.meta.url);
const BLUE=rgb(27/255,54/255,93/255),GOLD=rgb(177/255,138/255,50/255),INK=rgb(.17,.21,.27),LIGHT=rgb(.95,.97,.98);
const tidy=s=>String(s??'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
function shrink(f,t,start,width,min=6){let size=start;while(size>min&&f.widthOfTextAtSize(t,size)>width)size-=.25;return size;}
function put(page,font,t,x,y,maxWidth,size=9,color=INK){const text=tidy(t);let adjusted=shrink(font,text,size,maxWidth);page.drawText(text,{x,y,size:adjusted,font,color,maxWidth});}
export async function buildClassroomDirectory({cycle,group,rows,school='Instituto Tecnológico e Histórico Latinoamericano'}){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [b,h,logo]=await Promise.all([readFile(BOOK),readFile(HEAVY),readFile(LOGO)]);
 const regular=await pdf.embedFont(b,{subset:true}),bold=await pdf.embedFont(h,{subset:true}),img=await pdf.embedPng(logo);
 const W=612,H=792;let page,n=0,y;
 function newPage(){page=pdf.addPage([W,H]);n++;page.drawRectangle({x:0,y:H-13,width:W,height:13,color:BLUE});page.drawImage(img,{x:45,y:H-105,width:65,height:71});
  put(page,bold,'PLATAFORMA JAGUAR · SERVICIOS DOCENTES',126,H-47,435,9,BLUE);put(page,bold,school,126,H-67,435,11,BLUE);put(page,regular,`Ciclo escolar ${cycle} · Grupo ${group}`,126,H-88,435,9,INK);
  page.drawLine({start:{x:44,y:H-120},end:{x:W-44,y:H-120},thickness:1.4,color:GOLD});
  put(page,bold,'DIRECTORIO DE CÓDIGOS DE GOOGLE CLASSROOM',44,H-148,W-88,12,BLUE);
  put(page,regular,'El código de cada clase es exclusivo para el grupo correspondiente.',44,H-167,W-88,8,INK);
  y=H-195;page.drawRectangle({x:44,y:y-11,width:524,height:24,color:BLUE});
  [['ASIGNATURA',52],['DOCENTE',253],['CÓDIGO',464]].forEach(([t,x])=>put(page,bold,t,x,y-3,205,8,rgb(1,1,1)));y-=34;
 }
 newPage();
 const ordered=[...rows].sort((a,b)=>(a.materia||'').localeCompare(b.materia||'','es'));
 for(let i=0;i<ordered.length;i++){
  const row=ordered[i];if(y<110)newPage();
  const bg=i%2===0?LIGHT:rgb(1,1,1);page.drawRectangle({x:44,y:y-19,width:524,height:47,color:bg});
  put(page,bold,row.materia||'Materia',52,y+9,191,8,BLUE);
  put(page,regular,row.docente||'Pendiente de asignación',253,y+9,192,7.8,INK);
  put(page,bold,row.codigo_union||'PENDIENTE',464,y+9,100,8.1,row.codigo_union?BLUE:GOLD);
  if(row.enlace_clase){put(page,regular,row.enlace_clase,52,y-9,500,6.9,INK);}
  else put(page,regular,'Clase pendiente de crear o registrar',52,y-9,500,7.4,INK);
  y-=52;
 }
 const count=pdf.getPageCount();for(let i=0;i<count;i++){const p=pdf.getPage(i);p.drawLine({start:{x:44,y:61},end:{x:W-44,y:61},thickness:.8,color:GOLD});
  put(p,regular,'Documento generado desde Plataforma Jaguar · Distribuir sólo a alumnos del grupo',44,46,430,7,INK);
  put(p,bold,`${i+1} / ${count}`,520,46,46,7,BLUE);
 }
 return await pdf.save();
}
