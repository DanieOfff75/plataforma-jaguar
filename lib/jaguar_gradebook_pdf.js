/**
 * PDF de la bitácora docente, versión documental Jaguar V4.
 * Entrada ya autorizada por api/reports.js. No altera rúbricas, notas ni registros.
 * Las columnas y alumnos se paginan: nunca se descartan silenciosamente.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
const NAVY=rgb(27/255,54/255,93/255), TEAL=rgb(0,128/255,128/255);
const GOLD=rgb(177/255,138/255,50/255), INK=rgb(.14,.21,.29);
const MUTED=rgb(.42,.48,.52), LINE=rgb(.83,.87,.88), PALE=rgb(.947,.972,.971);
const W=792,H=612, L=30,R=762;
function str(x){return String(x??'').trim();}
function num(x){return x==null||x===''||!Number.isFinite(Number(x))?'—':Number(x).toFixed(1);}
/** Reparte sin páginas residuales: 39 alumnos = 20 + 19, no 19 + 19 + 1. */
function balancedChunks(items,limit){
  if(!items.length)return [[]];
  const count=Math.ceil(items.length/Math.max(1,limit));
  const base=Math.floor(items.length/count),extra=items.length%count;
  const parts=[];let pos=0;
  for(let i=0;i<count;i++){
    const size=base+(i<extra?1:0);
    parts.push(items.slice(pos,pos+size));pos+=size;
  }
  return parts;
}
/** Los vacíos no son faltas: quedan en blanco para diferenciarse del signo '-'. */
function attendanceMark(raw){
  if(raw===null||raw===undefined||['','—','–'].includes(String(raw).trim()))return '';
  const s=String(raw).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(['presente','p','asistio','asistencia','present'].includes(s))return '·';
  if(['falta','f','-','ausente','inasistencia','absent'].includes(s))return '-';
  if(['justificado','justificada','j','falta justificada','inasistencia justificada'].includes(s))return 'J';
  if(['retardo','r','tarde','retraso','late'].includes(s))return 'R';
  // Un valor no reconocido NO debe interpretarse como presente ni falta.
  return '?';
}
function compactDate(raw){
  const s=String(raw||'');
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:s;
}
function clipped(font,raw,maxWidth,size=7,minSize=5.2){let s=size,t=str(raw);while(s>minSize&&font.widthOfTextAtSize(t,s)>maxWidth)s-=.2;while(t.length>1&&font.widthOfTextAtSize(t,s)>maxWidth)t=t.slice(0,-2)+'…';return {text:t,size:s};}
function drawFit(page,font,text,{x,y,w,size=7,bold=false,color=INK,align='left'}){
  const f=clipped(font,text,w,size);const textW=font.widthOfTextAtSize(f.text,f.size);
  const xx=align==='center'?x+(w-textW)/2:align==='right'?x+w-textW:x;
  page.drawText(f.text,{x:Math.max(x,xx),y,size:f.size,font,color});
}
export async function buildDailyGradebookPdf({institution={},snapshot={},group={},subject={},teacher={},students=[],state={}}){
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const [bookBytes,heavyBytes]=await Promise.all([
    readFile(new URL('../assets/fonts/Garet-Book.ttf',import.meta.url)),
    readFile(new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url))
  ]);
  const regular=await pdf.embedFont(bookBytes,{subset:true});
  const bold=await pdf.embedFont(heavyBytes,{subset:true});
  const titleFont=await pdf.embedFont(StandardFonts.TimesRomanBold);
  let logo=null;try{logo=await pdf.embedPng(await readFile(new URL('../assets/ithla-logo.png',import.meta.url)))}catch{}
  const name=str(institution.nombre_institucion)||'INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO';
  const acts=Array.isArray(state.activities)?state.activities:[];
  const rubric=state.rubric||{components:[],total:snapshot.ponderacion_total||0};
  const components=Array.isArray(rubric.components)?rubric.components:[];
  const attendance=state.attendance||{};
  const dates=[...new Set(Object.keys(attendance).map(k=>k.split('|')[1]).filter(Boolean))].sort();
  const studentList=students||[];
  let totalPages=0;
  function newPage(title,label){
    const page=pdf.addPage([W,H]);
    page.drawRectangle({x:0,y:0,width:W,height:H,color:rgb(1,1,1)});
    page.drawRectangle({x:0,y:H-9,width:W,height:9,color:NAVY});
    page.drawRectangle({x:0,y:H-13,width:W,height:4,color:GOLD});
    if(logo)page.drawImage(logo,{x:32,y:H-80,width:48,height:51});
    drawFit(page,bold,name,{x:90,y:H-42,w:470,size:11,color:NAVY});
    drawFit(page,regular,`${str(institution.siglas)||'ITHLA'} · C.C.T. ${str(institution.cct)||'—'} · ${str(snapshot.fecha_clase)||'—'}`,{x:90,y:H-56,w:450,size:7,color:MUTED});
    drawFit(page,titleFont,title,{x:31,y:H-105,w:530,size:18,color:NAVY});
    drawFit(page,regular,`DOCENTE: ${teacher.nombre_completo||'—'} · ${group.clave||'—'} · ${subject.nombre||'—'}`,{x:31,y:H-122,w:690,size:8,color:INK});
    page.drawLine({start:{x:31,y:H-134},end:{x:W-31,y:H-134},color:GOLD,thickness:1});
    drawFit(page,regular,label,{x:31,y:42,w:660,size:7,color:MUTED});
    page.drawLine({start:{x:31,y:34},end:{x:W-31,y:34},color:LINE,thickness:.7});
    totalPages++;
    return page;
  }
  /**
   * Filas adaptadas al espacio útil sin texto microscópico. El margen inferior
   * reserva la leyenda de asistencias y el pie institucional.
   */
  function dataTable(page,headers,rows,{attendanceMode=false}={}){
    const variable=Math.max(0,headers.length-(attendanceMode?2:3));
    const main=attendanceMode?[35,140]:[28,214,111];
    const available=R-L-main.reduce((a,b)=>a+b,0);
    const widths=[...main,...Array.from({length:variable},()=>available/Math.max(variable,1))];
    const top=H-151;
    const bottom=attendanceMode?76:66;
    const rowH=Math.min(20.2,(top-bottom)/(rows.length+1));
    const drawRow=(cells,ri,head=false)=>{
      const y=top-(ri+1)*rowH;
      page.drawRectangle({x:L,y,width:R-L,height:rowH,color:head?NAVY:ri%2===0?PALE:rgb(1,1,1),borderColor:LINE,borderWidth:.35});
      let x=L;
      widths.forEach((w,i)=>{
        if(i>0)page.drawLine({start:{x,y},end:{x,y:y+rowH},color:LINE,thickness:.3});
        const isMark=attendanceMode&&!head&&i>=2;
        const fsize=head?(attendanceMode?7.1:7.0):(isMark?10.1:7.4);
        drawFit(page,head?bold:regular,cells[i]??'',{x:x+3,y:y+(rowH-fsize)/2+2,w:w-6,size:fsize,color:head?rgb(1,1,1):INK,align:(!attendanceMode&&i===1)?'left':'center'});
        x+=w;
      });
    };
    drawRow(headers,0,true);
    rows.forEach((r,i)=>drawRow(r,i+1,false));
    if(!rows.length){drawFit(page,regular,'Sin registros para mostrar en esta sección.',{x:42,y:top-42,w:660,size:10,color:MUTED});}
    if(attendanceMode){
      drawFit(page,bold,'ASISTENCIA:',{x:31,y:62,w:78,size:7,color:NAVY});
      drawFit(page,regular,'· Presente    - Falta    J Justificado    R Retardo    (vacío) Sin registro    ? Revisar dato',{x:105,y:62,w:645,size:7,color:MUTED});
    }
  }
  function renderSection(title,allCols,buildCells,{prefix='',footer='',attendanceMode=false,maxCols=8}={}){
    const studentChunks=balancedChunks(studentList,24);
    const colChunks=balancedChunks(allCols,maxCols);
    for(const colPart of colChunks){
      let studentStart=0;
      for(const stPart of studentChunks){
        const page=newPage(title,`Respaldo #${snapshot.id||'—'} · Versión ${snapshot.version||'—'} · ${prefix} · ${footer}`);
        const headers=attendanceMode?['N.º','MATRÍCULA',...colPart.map(c=>c.label)]:['N.º','ESTUDIANTE','MATRÍCULA',...colPart.map(c=>c.label)];
        const rows=stPart.map((st,i)=>attendanceMode
          ?[String(studentStart+i+1),st.matricula||'—',...colPart.map(c=>buildCells(st,c))]
          :[String(studentStart+i+1),st.nombre_completo||'—',st.matricula||'—',...colPart.map(c=>buildCells(st,c))]);
        dataTable(page,headers,rows,{attendanceMode});
        studentStart+=stPart.length;
      }
    }
  }
  renderSection('BITÁCORA · ASISTENCIAS',dates.map(date=>({date,label:compactDate(date)})),(st,c)=>attendanceMark(attendance[`${st.id}|${c.date}`]),{prefix:'Asistencia histórica',attendanceMode:true,maxCols:12});
  renderSection('BITÁCORA · ACTIVIDADES',acts.map(a=>({key:a.key,label:a.nombre||'Actividad'})),(st,c)=>num(state.activityScores?.[`${st.id}|${c.key}`]),{prefix:`${acts.length} actividades registradas`,maxCols:8});
  const componentsCols=components.map(c=>({id:c.id,label:`${c.nombre||'Rúbrica'} ${Number(c.ponderacion||0)}%`}));
  const totals=Object.fromEntries(studentList.map(st=>{
    let sum=0,weight=0;
    components.forEach(c=>{const raw=state.weightedValues?.[`${st.id}|${c.id}`];if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(Number(raw))){sum+=Number(raw)*Number(c.ponderacion||0);weight+=Number(c.ponderacion||0)}});
    return [st.id,weight?num(sum/weight):'—'];
  }));
  // Cada bloque incluye el total global de la rúbrica, calculado con todas las columnas.
  const componentChunks=balancedChunks(componentsCols,7);
  const weightedStudentChunks=balancedChunks(studentList,24);
  for(const cols of componentChunks){
    const list=[...cols,{id:'__total',label:'VALOR TOTAL'}];
    for(const [k,part] of weightedStudentChunks.entries()){
      const page=newPage('BITÁCORA · PONDERACIONES',`Rúbrica ${rubric.titulo||'del periodo'} · Ponderación oficial ${Number(rubric.total||0)}% · Respaldo ${snapshot.id||'—'}`);
      const headers=['N.º','ESTUDIANTE','MATRÍCULA',...list.map(c=>c.label)];
      const previous=weightedStudentChunks.slice(0,k).reduce((n,p)=>n+p.length,0);
      const rows=part.map((st,i)=>[String(previous+i+1),st.nombre_completo||'—',st.matricula||'—',...list.map(c=>c.id==='__total'?totals[st.id]:num(state.weightedValues?.[`${st.id}|${c.id}`]))]);
      dataTable(page,headers,rows);
    }
  }
  const pages=pdf.getPages();pages.forEach((page,i)=>{
    drawFit(page,regular,`JAGUAR · ${i+1} / ${pages.length}`,{x:W-175,y:23,w:143,size:7,align:'right',color:MUTED});
  });
  return pdf.save();
}
