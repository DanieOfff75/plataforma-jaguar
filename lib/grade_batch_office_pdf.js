import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const NAVY=rgb(.105,.212,.365),GOLD=rgb(.831,.686,.247),GRAY=rgb(.39,.44,.50),WHITE=rgb(1,1,1),TEAL=rgb(0,.50,.50);
const ascii=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ');
function text(page,font,value,x,y,size=9,color=NAVY){page.drawText(ascii(value).slice(0,130),{x,y,size,font,color});}
export async function buildGradeBatchOfficePdf({revision,batch,subject,teacher,students,logoBytes,loadSignature}){
 const doc=await PDFDocument.create();const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 let logo=null;try{if(logoBytes)logo=await doc.embedPng(logoBytes)}catch{}
 const rows=(revision.estado==='aceptada'?revision.notas_finales:revision.notas_originales)||[];
 const names=new Map((students||[]).map(s=>[Number(s.id),s]));
 const perPage=22,total=Math.max(1,Math.ceil(rows.length/perPage));
 for(let i=0;i<total;i++){
  const page=doc.addPage([612,792]);const w=612,h=792;
  page.drawRectangle({x:0,y:h-12,width:w,height:12,color:NAVY});page.drawRectangle({x:0,y:h-16,width:w,height:4,color:GOLD});
  if(logo)page.drawImage(logo,{x:36,y:710,width:55,height:55});
  text(page,bold,'INSTITUTO TECNOLOGICO E HISTORICO LATINOAMERICANO',104,758,11,NAVY);
  text(page,bold,'OFICIO DE VALIDACION DE CALIFICACIONES',104,735,12,NAVY);
  text(page,regular,`Folio interno: ITHLA-REV-${revision.id}`,104,717,8,GRAY);
  text(page,regular,`Grupo: ${subject?.grupo||'-'}   Periodo: ${batch?.periodo||'-'}`,38,686,9,NAVY);
  text(page,regular,`Materia: ${subject?.nombre||'-'}`,38,671,9,NAVY);
  text(page,regular,`Emite: ${batch.actor_nombre}  |  ${String(batch.actor_rol||'').replaceAll('_',' ')}`,38,656,9,NAVY);
  text(page,regular,`Docente destinatario: ${teacher?.nombre_completo||'Sin asignar'}`,38,641,9,NAVY);
  text(page,bold,revision.estado==='aceptada'?'ESTADO: ACEPTADO POR EL DOCENTE':'ESTADO: PENDIENTE DE ACEPTACION',38,620,9,revision.estado==='aceptada'?TEAL:NAVY);
  page.drawRectangle({x:38,y:590,width:536,height:20,color:NAVY});
  text(page,bold,'N.o',44,597,8,WHITE);text(page,bold,'MATRICULA / ESTUDIANTE',76,597,8,WHITE);text(page,bold,'ORIGINAL',415,597,8,WHITE);text(page,bold,'FINAL',507,597,8,WHITE);
  const chunk=rows.slice(i*perPage,(i+1)*perPage);
  for(let j=0;j<chunk.length;j++){
   const row=chunk[j],st=names.get(Number(row.alumno_id))||{},orig=(revision.notas_originales||[]).find(x=>Number(x.alumno_id)===Number(row.alumno_id));
   const y=576-j*20;
   if(j%2===0)page.drawRectangle({x:38,y:y-4,width:536,height:20,color:rgb(.95,.96,.97)});
   text(page,regular,String(i*perPage+j+1),45,y+2,8);
   text(page,bold,st.matricula||'Sin matricula',76,y+2,7.8);
   text(page,regular,String(st.nombre_completo||'').slice(0,40),212,y+2,7.4);
   text(page,regular,Number(orig?.calificacion??row.calificacion).toFixed(2),429,y+2,8);
   text(page,bold,revision.estado==='aceptada'?Number(row.calificacion).toFixed(2):'PEND.',514,y+2,8);
  }
  if(i===total-1){
   for(const [idx,sg] of [{name:batch.actor_nombre,path:batch.firma_departamento_path,label:'FIRMA DEPARTAMENTAL'},
     {name:teacher?.nombre_completo||'Docente asignado',path:revision.estado==='aceptada'?revision.firma_docente_path:null,label:'ACEPTACION DOCENTE'}].entries()){
    const x=38+idx*278;
    text(page,bold,sg.label,x,105,8,NAVY);
    if(sg.path&&typeof loadSignature==='function')try{
      const result=await loadSignature(doc,sg.path),img=result?.image;
      if(img){const scale=Math.min(140/img.width,33/img.height);page.drawImage(img,{x:x+42,y:69,width:img.width*scale,height:img.height*scale})}
    }catch{}
    page.drawLine({start:{x:x+12,y:65},end:{x:x+236,y:65},thickness:.7,color:NAVY});
    text(page,regular,sg.name,x+12,53,7.7,GRAY);
   }
  }
  text(page,regular,'Originales conservados. Todo cambio exige justificacion y aceptacion del docente.',38,30,7,GRAY);
  text(page,regular,`${i+1}/${total}`,550,30,7,GRAY);
 }
 return new Uint8Array(await doc.save());
}
