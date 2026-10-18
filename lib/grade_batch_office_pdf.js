import {PDFDocument} from 'pdf-lib';
import {C,prepareInstitutionalPdf,chroma,textFit,centered,footer,signature} from './institutional_pdf_theme.js';
import {institutionalName,sortInstitutionalPeople} from './institutional_names.js';

// V5.8.6: oficio-carta de validación + anexo de alumnos. No altera notas ni estados.
const W=612,H=792,LEFT=39,RIGHT=573;
const safe=(v,fallback='—')=>String(v??'').replace(/\s+/g,' ').trim()||fallback;
const grade=v=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(2);
const asDate=v=>{
 if(!v)return 'Fecha de emisión: no disponible';
 const d=new Date(v);return Number.isNaN(d.valueOf())?'Fecha de emisión: no disponible':`Estado de México, ${new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Mexico_City'}).format(d)}`;
};
function wrap(font,paragraph,maxWidth,size){
 const lines=[];let current='';
 for(const word of String(paragraph).trim().split(/\s+/)){
  const next=current?`${current} ${word}`:word;
  if(current&&font.widthOfTextAtSize(next,size)>maxWidth){lines.push(current);current=word;}else current=next;
 }
 if(current)lines.push(current);
 return lines;
}
function paragraph(page,font,str,x,y,maxWidth,{size=9.25,lineHeight=15.9,color=C.INK}={}){
 for(const line of wrap(font,str,maxWidth,size)){textFit(page,font,line,x,y,maxWidth,{size,min:size-.4,color});y-=lineHeight;}
 return y;
}
function heading(page,theme,{section='OFICIO ACADÉMICO',title,folio,subtitle}={}){
 chroma(page,theme,{kind:'CONTROL ESCOLAR  /  CORRESPONDENCIA INSTITUCIONAL'});
 centered(page,theme.title,title,H-127,{size:15.0});
 centered(page,theme.regular,`OFICIO NÚM. ${folio}`,H-147,{size:8.3,color:C.TEAL});
 if(subtitle)centered(page,theme.regular,subtitle,H-165,{size:8.5,color:C.MUTED});
}
function metaLine(page,theme,label,value,y){
 textFit(page,theme.bold,label,49,y,105,{size:8.4,color:C.NAVY});
 textFit(page,theme.regular,value,154,y,407,{size:8.4,color:C.INK});
}
export async function buildGradeBatchOfficePdf({revision,batch,subject,teacher,students,logoBytes,loadSignature}){
 const accepted=revision?.estado==='aceptada';
 const originalRows=Array.isArray(revision?.notas_originales)?revision.notas_originales:[];
 const resultRows=accepted&&Array.isArray(revision?.notas_finales)?revision.notas_finales:originalRows;
 if(!originalRows.length)throw Error('El oficio no tiene calificaciones originales para respaldar.');
 const pdf=await PDFDocument.create();const theme=await prepareInstitutionalPdf(pdf,{logoBytes});
 const stMap=new Map((students||[]).map(s=>[Number(s.id),s]));
 const originals=new Map(originalRows.map(r=>[Number(r.alumno_id),r]));
 const rows=sortInstitutionalPeople(resultRows.map(r=>({...r,...(stMap.get(Number(r.alumno_id))||{})})))
  .map((r,i)=>({...r,number:i+1,student:stMap.get(Number(r.alumno_id))||{}}));
 const folio=`ITHLA-REV-${revision.id}`;
 const teacherName=teacher?.nombre_completo?institutionalName(teacher):'DOCENTE PENDIENTE DE IDENTIFICAR';
 const issuerRaw=String(batch.actor_nombre||'').trim();
 const issuerName=issuerRaw&&!issuerRaw.includes('@')?institutionalName(issuerRaw):'RESPONSABLE DEL DEPARTAMENTO';
 const issuerRole=safe(String(batch.actor_rol||'control_escolar').replaceAll('_',' ').replace(/\b\p{L}/gu,c=>c.toLocaleUpperCase('es')));
 const group=safe(subject?.grupo),matter=safe(subject?.nombre),period=safe(batch?.periodo,'Periodo');
 const status=accepted?'ACEPTADO POR EL DOCENTE':'PENDIENTE DE REVISIÓN Y ACEPTACIÓN';
 const signatures=[{name:issuerName,path:batch.firma_departamento_path,label:'RESPONSABLE DEL DEPARTAMENTO EMISOR'},
   {name:teacherName,path:accepted?revision.firma_docente_path:null,label:'DOCENTE RESPONSABLE'}];
 for(const signer of signatures){
  if(signer.path&&typeof loadSignature==='function')try{const r=await loadSignature(pdf,signer.path);signer.image=r?.image||null;}catch{}
 }
 // 1. Oficio formal de remisión: separado del listado y de la aceptación del docente.
 {
  const page=pdf.addPage([W,H]);
  heading(page,theme,{title:'OFICIO DE REMISIÓN DE CALIFICACIONES',folio});
  textFit(page,theme.regular,asDate(batch.creado_at),LEFT+8,H-190,505,{size:8.7,color:C.MUTED});
  page.drawLine({start:{x:LEFT,y:H-204},end:{x:RIGHT,y:H-204},color:C.LINE,thickness:.7});
  metaLine(page,theme,'ASUNTO','Revisión y validación de calificaciones',H-229);
  metaLine(page,theme,'GRUPO / PERIODO',`${group}  ·  ${period}`,H-246);
  metaLine(page,theme,'ASIGNATURA',matter,H-263);
  metaLine(page,theme,'ESTADO',status,H-280);
  let y=H-302;
  textFit(page,theme.bold,`C. ${teacherName}`,LEFT+8,y,510,{size:10.0,color:C.NAVY});y-=18;
  textFit(page,theme.regular,'DOCENTE RESPONSABLE DE LA ASIGNATURA',LEFT+8,y,510,{size:8.3,color:C.INK});y-=19;
  textFit(page,theme.bold,'P R E S E N T E',LEFT+8,y,510,{size:8.5,color:C.NAVY});y-=36;
  const p1=`Por medio del presente, el Departamento de ${issuerRole} remite a usted la relación de ${rows.length} calificaciones correspondiente a ${matter}, del grupo ${group}, durante ${period}, para su revisión académica y validación en Plataforma Jaguar.`;
  const p2=accepted?
    'La relación anexa cuenta con aceptación docente registrada en el sistema. Los valores originales y los definitivamente aceptados se muestran por separado para conservar su trazabilidad.':
    'Se solicita cotejar los datos y valores contenidos en el anexo. Si identifica alguna discrepancia, podrá proponer los ajustes necesarios, dejando constancia de su justificación antes de emitir su aceptación en el sistema.';
  const p3='La presente comunicación y su anexo constituyen respaldo del trámite. No sustituyen la boleta oficial ni autorizan, por sí mismos, la modificación de calificaciones o el cierre de un periodo académico.';
  y=paragraph(page,theme.regular,p1,LEFT+8,y,516,{size:9.25});y-=20;
  y=paragraph(page,theme.regular,p2,LEFT+8,y,516,{size:9.25});y-=20;
  y=paragraph(page,theme.regular,p3,LEFT+8,y,516,{size:9.25});
  const closingY=Math.min(y-22,214);
  textFit(page,theme.regular,'Sin otro particular, agradecemos su atención y colaboración.',LEFT+8,closingY,510,{size:9.0,color:C.INK});
  centered(page,theme.bold,'A T E N T A M E N T E',165,{size:8.8,color:C.NAVY});
  signature(page,theme,{...signatures[0],status:issuerRole},{x:150,y:93,width:312,role:'DEPARTAMENTO EMISOR'});
  footer(page,theme,1,Math.ceil(rows.length/20)+1,`Oficio ${folio} · Documento interno de revisión académica`);
 }
 // 2. Anexo de calificaciones: páginas equilibradas y acuse únicamente al final.
 const annexPages=Math.max(1,Math.ceil(rows.length/20));
 const per=Math.ceil(rows.length/annexPages),pages=1+annexPages,rowHeight=20;
 for(let p=0;p<annexPages;p++){
  const page=pdf.addPage([W,H]);
  heading(page,theme,{title:'ANEXO DE CALIFICACIONES',folio,
   subtitle:`${group}  ·  ${matter}  ·  ${period}`});
  page.drawRectangle({x:LEFT,y:H-206,width:RIGHT-LEFT,height:29,color:C.PALE,borderColor:C.LINE,borderWidth:.5});
  textFit(page,theme.bold,`${status}  ·  ${rows.length} ALUMNOS`,LEFT+12,H-196,510,{size:8,color:accepted?C.TEAL:C.NAVY});
  const headerY=H-242;
  page.drawRectangle({x:LEFT,y:headerY,width:RIGHT-LEFT,height:25,color:C.NAVY});
  for(const [str,x,width] of [['N.º',47,28],['APELLIDOS Y NOMBRE(S)',84,217],['MATRÍCULA',309,130],['RECIBIDA',443,58],['VALIDADA',511,58]])
    textFit(page,theme.bold,str,x,headerY+9,width,{size:6.9,min:6.3,color:C.WHITE});
  const chunk=rows.slice(p*per,(p+1)*per);
  for(const [i,r] of chunk.entries()){
   const y=headerY-rowHeight*(i+1),st=r.student;
   if(i%2===0)page.drawRectangle({x:LEFT,y,width:RIGHT-LEFT,height:rowHeight,color:C.PALE,opacity:.86});
   page.drawLine({start:{x:LEFT,y},end:{x:RIGHT,y},color:C.LINE,thickness:.3});
   textFit(page,theme.regular,String(r.number),47,y+6,30,{size:7.0,color:C.NAVY});
   textFit(page,theme.bold,institutionalName(st),84,y+6,211,{size:7.0,min:6.2,color:C.INK});
   textFit(page,theme.regular,st.matricula||'—',309,y+6,126,{size:6.8,color:C.MUTED});
   textFit(page,theme.regular,grade(originals.get(Number(r.alumno_id))?.calificacion??r.calificacion),448,y+6,53,{size:7.5,color:C.INK});
   textFit(page,theme.bold,accepted?grade(r.calificacion):'PEND.',513,y+6,52,{size:7.6,color:accepted?C.TEAL:C.NAVY});
  }
  if(p===annexPages-1){
   signature(page,theme,{...signatures[1],status:accepted?'Aceptación registrada en Jaguar':'Pendiente de aceptación en Jaguar'},
    {x:155,y:91,width:302,role:'REVISIÓN Y ACEPTACIÓN DEL DOCENTE'});
  }
  footer(page,theme,p+2,pages,`Anexo del oficio ${folio} · No sustituye la boleta oficial`);
 }
 pdf.setTitle(`ITHLA · Oficio de remisión y anexo de calificaciones · ${folio}`);
 pdf.setSubject('Solicitud institucional de revisión y validación de calificaciones');
 return new Uint8Array(await pdf.save());
}
