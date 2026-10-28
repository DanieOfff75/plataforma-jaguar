/* PDF de lectura del diseño de una rúbrica heredada. No copia calificaciones ni firmas. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const safe = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?').trim();
const bound = (value, max=240) => safe(value).slice(0,max);
export async function buildHandoverRubricPdf({rubric,components,sourceTeacher='',group='',subject='',period=''}) {
  const pdf=await PDFDocument.create();
  pdf.setTitle(`Rúbrica para relevo docente - ${bound(rubric?.titulo,80)}`);
  pdf.setAuthor('ITHLA | Plataforma Jaguar');
  const normal=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(.105,.211,.364),teal=rgb(0,.49,.49),gray=rgb(.39,.45,.53),gold=rgb(.79,.63,.21);
  const W=595,H=842,LEFT=47,RIGHT=548;
  let page,y;
  function newPage(){ page=pdf.addPage([W,H]);y=H-55;page.drawRectangle({x:0,y:H-15,width:W,height:15,color:navy});page.drawText('ITHLA  |  PLATAFORMA JAGUAR', {x:LEFT,y,font:bold,size:10,color:navy});y-=30; }
  function line(text,{size=10,weight=false,color=navy,indent=0,gap=17}={}) {
    if(y<75)newPage();
    page.drawText(bound(text,320),{x:LEFT+indent,y,size,font:weight?bold:normal,color});y-=gap;
  }
  function wrap(text,max=82) {
    const words=safe(text).split(/\s+/).filter(Boolean);const rows=[];let row='';
    for(const word of words){if((row+' '+word).trim().length>max&&row){rows.push(row);row='';}row=(row+' '+word).trim();}
    if(row)rows.push(row);return rows.length?rows:['—'];
  }
  newPage();
  line('VISTA PREVIA DE RÚBRICA - RELEVO DOCENTE',{size:15,weight:true,gap:27});
  line('Documento de consulta. La rúbrica y las notas originales no se modifican.',{size:9,color:gray,gap:27});
  page.drawRectangle({x:LEFT,y:y-6,width:RIGHT-LEFT,height:1.8,color:gold});y-=25;
  const fields=[['Título',rubric?.titulo],['Docente de origen',sourceTeacher],['Grupo',group],['Asignatura',subject],['Periodo',period],['Estado original',rubric?.estado],['Escala máxima',rubric?.escala_maxima ?? 10]];
  for(const [name,value] of fields){for(const [i,row] of wrap(`${name}: ${value||'No indicado'}`,86).entries()){line(row,{size:10,weight:i===0,gap:16});}} 
  y-=15;line('CRITERIOS DE EVALUACIÓN',{weight:true,size:11,gap:23});
  const ordered=[...(components||[])].sort((a,b)=>Number(a.orden||0)-Number(b.orden||0));
  let sum=0;
  if(!ordered.length)line('No se registraron criterios para esta rúbrica.',{color:gray});
  for(let i=0;i<ordered.length;i++){
    const c=ordered[i];const percent=Number(c.ponderacion||0);sum+=percent;
    if(y<96)newPage();
    page.drawRectangle({x:LEFT,y:y-9,width:RIGHT-LEFT,height:38,color:i%2===0?rgb(.94,.96,.97):rgb(1,1,1)});
    const title=wrap(`${i+1}. ${c.nombre||'Criterio'}`,60);
    line(title[0],{weight:true,size:10,gap:16});
    for(const rest of title.slice(1))line(rest,{size:9,gap:15});
    line(`Ponderación: ${percent.toLocaleString('es-MX')} %    |    Máximo: ${Number(c.maximo||10).toLocaleString('es-MX')}`,{size:9,color:gray,gap:22});
  }
  y-=8;line(`PONDERACIÓN TOTAL: ${sum.toLocaleString('es-MX')} %`,{weight:true,color:teal});
  y-=18;
  for(const row of wrap('La adopción crea una rúbrica editable del docente sustituto. Las evaluaciones históricas conservan la autoría y calificaciones del docente anterior.',90))line(row,{size:9,color:gray,gap:15});
  const pages=pdf.getPages();
  pages.forEach((pg,index)=>{pg.drawLine({start:{x:LEFT,y:46},end:{x:RIGHT,y:46},thickness:.6,color:rgb(.78,.82,.86)});pg.drawText(`Documento informativo · ${index+1}/${pages.length}`,{x:LEFT,y:32,font:normal,size:8,color:gray});});
  return Buffer.from(await pdf.save());
}
