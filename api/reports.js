import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { requireRoles } from '../lib/_admin.js';
import { getInstitution } from './institution.js';
import { listResponsibleUsers } from './responsables.js';
import { registerVerifiableDocument, qrPng, deleteVerifiableDocument } from './documentos.js';

const days = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
const GREEN = rgb(0.027,0.361,0.302);
const GREEN2 = rgb(0.039,0.412,0.345);
const PALE = rgb(0.886,0.937,0.922);
const PAPER = rgb(0.988,0.992,0.969);
const INK = rgb(0.090,0.235,0.212);
const GRAY = rgb(0.400,0.463,0.451);
const LINE = rgb(0.624,0.722,0.706);
const GOLD = rgb(0.718,0.592,0.306);
const GOLD_DARK = rgb(0.505,0.350,0.075);
const GOLD_SOFT = rgb(0.953,0.925,0.845);
const GOLD_CELL = rgb(0.985,0.972,0.928);
const CELL = rgb(0.941,0.961,0.953);

function safe(s){return String(s??'').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ _-]/g,'_').slice(0,80);}
function short(s,max=42){const v=String(s??'—');return v.length>max?v.slice(0,Math.max(1,max-1))+'…':v;}
function textWidth(font,text,size){return font.widthOfTextAtSize(String(text??''),size);}
function fitText(font,text,maxWidth,size,maxSize=size,minSize=6.5){let s=maxSize;const v=String(text??'');while(s>minSize&&textWidth(font,v,s)>maxWidth)s-=.25;return {text:short(v,Math.max(1,Math.floor(maxWidth/(s*.48)))),size:s};}
function drawCentered(page,regular,bold,text,cx,y,maxWidth,size,isBold=false){const f=isBold?bold:regular;const fit=fitText(f,text,maxWidth,size,size,6.5);page.drawText(fit.text,{x:cx-textWidth(f,fit.text,fit.size)/2,y,size:fit.size,font:f,color:INK});}
function rect(page,x,y,w,h,fill,border=LINE,bw=.7){page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:border,borderWidth:bw});}
function line(page,x1,y1,x2,y2,color=LINE,width=.7){page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness:width});}
function drawFloral(page,W,H,theme={}){
  const primary=theme.primary||GREEN;
  const primary2=theme.primary2||GREEN2;
  const pale=theme.pale||PALE;
  const gold=theme.gold||GOLD;
  page.drawRectangle({x:0,y:0,width:W,height:H,color:theme.paper||PAPER});
  const leaves=[
    [28,H-38,18,42,-18],[65,H-68,15,34,20],[W-28,H-38,18,42,18],[W-65,H-68,15,34,-20],
    [28,75,20,45,18],[68,42,16,34,-18],[W-28,75,20,45,-18],[W-68,42,16,34,18]
  ];
  for(const [x,y,rx,ry,rot] of leaves){
    page.drawEllipse({x,y,xScale:rx,yScale:ry,rotate:degrees(rot),color:pale,borderColor:theme.leaf||rgb(.72,.82,.79),borderWidth:.7,opacity:.42});
  }
  for(const [x,y] of [[48,H-48],[W-48,H-48],[48,48],[W-48,48]]){
    page.drawCircle({x,y,size:3.5,color:gold,opacity:.25});
    page.drawCircle({x:x+12,y:y+8,size:2.5,color:primary2,opacity:.22});
  }
  page.drawRectangle({x:0,y:0,width:W,height:17,color:primary});
  page.drawRectangle({x:0,y:17,width:W,height:2,color:gold});
}
async function loadLogo(){
  try{return await readFile(new URL('../assets/ithla-logo.png',import.meta.url));}
  catch{return null;}
}
async function activeCycle(admin){
  try{
    const {data,error}=await admin.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1).maybeSingle();
    if(!error && data?.ciclo_escolar) return data.ciclo_escolar;
  }catch{}
  const legacy=await admin.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle();
  return legacy.data?.ciclo_escolar||'2026-2027';
}

async function institutionForPdf(admin){return await getInstitution(admin);}
function mottoLines(institution,maxLines=4,maxChars=22){
  const motto=String(institution?.lema||'').trim() || String(institution?.lema_traduccion||'').trim() || '';
  if(!motto) return [];
  const words=motto.split(/\s+/).filter(Boolean);
  const lines=[]; let current='';
  for(const word of words){
    const next=current?`${current} ${word}`:word;
    if(current && next.length>maxChars){lines.push(current);current=word;}else current=next;
  }
  if(current) lines.push(current);
  if(lines.length<=maxLines) return lines;
  const head=lines.slice(0,maxLines-1);
  const rest=lines.slice(maxLines-1).join(' ');
  head.push(short(rest,maxChars));
  return head;
}
function getTurnSlots(turno){
  const t=String(turno||'').toUpperCase();
  if(t.includes('VES')) return [
    '15:00|16:00','16:00|17:00','17:00|18:00',
    '18:30|19:30','19:30|20:30','20:30|21:30'
  ];
  return [
    '07:00|08:00','08:00|09:00','09:00|10:00',
    '10:30|11:30','11:30|12:30','12:30|13:30'
  ];
}
function getSlots(rows,turno=null){
  if(turno) return getTurnSlots(turno);
  return [...new Set((rows||[]).map(r=>`${String(r.hora_inicio||'').slice(0,5)}|${String(r.hora_fin||'').slice(0,5)}`))].sort((a,b)=>a.localeCompare(b));
}
function uniqueSubjects(rows,teacherMode=false){
  const seen=new Map();
  for(const r of rows||[]){
    const materia=r.grupo_materias?.materias?.nombre||'Materia';
    const docente=r.docente?.nombre_completo||'Sin docente';
    const grupo=r.grupo_materias?.grupos?.clave||'—';
    const key=teacherMode?`${materia}|${grupo}|${docente}`:`${materia}|${docente}`;
    if(!seen.has(key))seen.set(key,{materia,docente,grupo});
  }
  return [...seen.values()].sort((a,b)=>a.materia.localeCompare(b.materia,'es',{sensitivity:'base'}));
}
function cellText(page,font,txt,x,y,w,h,size,bold=false,color=INK){
  const f=font;
  const fit=fitText(f,txt,w-8,size,size,6.2);
  page.drawText(fit.text,{x:x+(w-textWidth(f,fit.text,fit.size))/2,y:y+(h-fit.size)/2+2,size:fit.size,font:f,color});
}
function hexToRgb(value,fallback){
  const v=String(value||'').replace('#','');
  if(!/^[0-9a-fA-F]{6}$/.test(v)) return fallback;
  return rgb(parseInt(v.slice(0,2),16)/255,parseInt(v.slice(2,4),16)/255,parseInt(v.slice(4,6),16)/255);
}


async function loadSignatureImage(pdf, admin, path, diagnostics=null){
  if(!path || typeof path!=='string' || !path.trim()){
    if(diagnostics) diagnostics.push({path:null,ok:false,error:'firma_path vacío'});
    return null;
  }
  const raw=path.trim();
  const clean=raw.replace(/^\/+/, '').replace(/^firmas-institucionales\//i,'');
  const candidates=[clean,raw].filter(Boolean);
  for(const candidate of [...new Set(candidates)]){
    try{
      const storage=admin.storage.from('firmas-institucionales');
      let data=null,error=null;
      ({data,error}=await storage.download(candidate));
      if(error || !data){
        const signed=await storage.createSignedUrl(candidate,300);
        if(!signed?.error && signed?.data?.signedUrl){
          const response=await fetch(signed.data.signedUrl);
          if(response.ok){
            const bytes=Buffer.from(await response.arrayBuffer());
            try{const image=await pdf.embedPng(bytes);if(diagnostics)diagnostics.push({path:candidate,ok:true,method:'signed-url',format:'png'});return {kind:'png',image};}catch{}
            try{const image=await pdf.embedJpg(bytes);if(diagnostics)diagnostics.push({path:candidate,ok:true,method:'signed-url',format:'jpg'});return {kind:'jpg',image};}catch{}
            if(diagnostics)diagnostics.push({path:candidate,ok:false,error:'Formato no compatible con pdf-lib; posiblemente WEBP'});
          }
        }
        if(diagnostics) diagnostics.push({path:candidate,ok:false,error:error?.message||'No se pudo descargar'});
        continue;
      }
      const bytes=Buffer.from(await data.arrayBuffer());
      try{const image=await pdf.embedPng(bytes);if(diagnostics)diagnostics.push({path:candidate,ok:true,method:'download',format:'png'});return {kind:'png',image};}catch{}
      try{const image=await pdf.embedJpg(bytes);if(diagnostics)diagnostics.push({path:candidate,ok:true,method:'download',format:'jpg'});return {kind:'jpg',image};}catch{}
      if(diagnostics)diagnostics.push({path:candidate,ok:false,error:'Archivo descargado pero pdf-lib no pudo decodificarlo; posiblemente WEBP'});
    }catch(e){
      if(diagnostics)diagnostics.push({path:candidate,ok:false,error:e.message||'Error leyendo firma'});
    }
  }
  return null;
}

async function addQrToPage(page,pdf,qrBytes,{x=700,y=28,size=68}={}){
  try{
    const image=await pdf.embedPng(qrBytes);
    page.drawRectangle({x:x-4,y:y-4,width:size+8,height:size+8,color:rgb(1,1,1),borderColor:LINE,borderWidth:.6});
    page.drawImage(image,{x,y,width:size,height:size});
    return true;
  }catch{return false;}
}

function normalizePersonName(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9@._ -]/g,'')
    .replace(/\s+/g,' ').trim().toLowerCase();
}

async function profileSignatureCandidates(admin, {authUserId=null, fallbackName=null, fallbackEmail=null, fallbackRole=null}={}){
  const candidates=[];
  const push=(row,source='profile')=>{
    if(!row?.firma_path || !String(row.firma_path).trim()) return;
    const key=String(row.id||'')+'|'+String(row.firma_path);
    if(!candidates.some(x=>String(x.id||'')+'|'+String(x.firma_path)===key)) candidates.push({...row,__signature_source:source});
  };
  const select='id,nombre_completo,rol,correo,correo_auth,firma_path,firma_sha256,firma_subida_at';
  if(authUserId){
    const {data,error}=await admin.from('perfiles').select(select).eq('id',authUserId).maybeSingle();
    if(error) throw error;
    push(data,'auth_user_id');
  }
  const targetName=normalizePersonName(fallbackName);
  const targetEmail=String(fallbackEmail||'').trim().toLowerCase();
  if(targetEmail || targetName){
    const {data:profiles,error}=await admin.from('perfiles').select(select).not('firma_path','is',null).neq('firma_path','').limit(2000);
    if(error) throw error;
    for(const row of profiles||[]){
      const rowName=normalizePersonName(row.nombre_completo);
      const rowEmails=[row.correo,row.correo_auth].map(x=>String(x||'').trim().toLowerCase()).filter(Boolean);
      const emailMatch=targetEmail && rowEmails.includes(targetEmail);
      const nameMatch=targetName && rowName===targetName;
      const roleMatch=!fallbackRole || String(row.rol||'').toLowerCase()===String(fallbackRole||'').toLowerCase();
      if(roleMatch && (emailMatch||nameMatch)) push(row,emailMatch?'email':'nombre');
    }
  }
  return candidates;
}

async function readableSignatureProfile(admin, profiles, diagnostics=null){
  for(const profile of profiles||[]){
    const probe=await PDFDocument.create();
    const detail=[];
    const sig=await loadSignatureImage(probe,admin,profile.firma_path,detail);
    if(diagnostics) diagnostics.push({profile_id:profile.id||null,nombre:profile.nombre_completo||null,firma_path:profile.firma_path||null,source:profile.__signature_source||null,readable:Boolean(sig),detail});
    if(sig) return profile;
  }
  return null;
}

async function profileSignatureByRole(admin, role){
  const depMap={direccion_escolar:'DIR',control_escolar:'CE',control:'CE',servicios_docentes:'SD',servicios_estudiantiles:'SE',prefectura:'PRE',coordinacion_academica:'CA'};
  const depKey=depMap[String(role||'')];
  if(depKey){
    try{
      const responsible=(await listResponsibleUsers(admin,depKey))[0];
      if(responsible?.perfil?.firma_path){
        const readable=await readableSignatureProfile(admin,[responsible.perfil]);
        if(readable)return readable;
      }
    }catch(e){
      if(!/responsables_departamento|schema cache|does not exist/i.test(e?.message||''))throw e;
    }
  }
  const {data,error}=await admin.from('perfiles').select('id,nombre_completo,rol,firma_path,firma_sha256').eq('rol',role).not('firma_path','is',null).neq('firma_path','').order('id',{ascending:true}).limit(50);
  if(error) throw error;
  return readableSignatureProfile(admin,data||[]);
}

async function profileSignatureByAuth(admin, authUserId, fallbackName=null, fallbackRole=null, fallbackEmail=null){
  const candidates=await profileSignatureCandidates(admin,{authUserId,fallbackName,fallbackRole,fallbackEmail});
  // IMPORTANT: only return a profile when its actual private image is readable.
  // A stale/broken firma_path must not prevent the report from trying the teacher's
  // latest accepted schedule signature as a fallback.
  return readableSignatureProfile(admin,candidates);
}
async function drawSignatureBox(page,pdf,admin,{x,y,w,h,label,profile,showName=true,missingText='FIRMA NO REGISTRADA',signatureImage=null}){
  rect(page,x,y,w,h,rgb(1,1,1,.86),LINE,.65);
  const title=String(label||'FIRMA').toUpperCase();
  page.drawText(title,{x:x+6,y:y+h-12,size:5.5,font:await pdf.embedFont(StandardFonts.HelveticaBold),color:GRAY});
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const sig=signatureImage || (profile?.firma_path?await loadSignatureImage(pdf,admin,profile.firma_path):null);
  if(sig){
    const iw=Math.min(w-18,110), ih=Math.min(h-28,32); const ratio=Math.min(iw/sig.image.width,ih/sig.image.height);
    page.drawImage(sig.image,{x:x+(w-sig.image.width*ratio)/2,y:y+22,width:sig.image.width*ratio,height:sig.image.height*ratio});
  } else {
    const italic=await pdf.embedFont(StandardFonts.HelveticaOblique);
    const nf=fitText(italic,missingText,w-18,5.8,5.8,4.6);
    page.drawText(nf.text,{x:x+(w-textWidth(italic,nf.text,nf.size))/2,y:y+28,size:nf.size,font:italic,color:GRAY});
  }
  page.drawLine({start:{x:x+10,y:y+17},end:{x:x+w-10,y:y+17},thickness:.55,color:GRAY});
  if(showName){
    const nm=profile?.nombre_completo||'';
    if(nm){const f=fitText(regular,nm,w-12,5.8,5.8,4.8);page.drawText(f.text,{x:x+(w-textWidth(regular,f.text,f.size))/2,y:y+6,size:f.size,font:regular,color:INK});}
  }
}

async function drawSchedulePdf({admin,student=null,teacher=null,group:groupInfo=null,rows=[],cycle,workshop='Sin taller asignado',req,verification}){
  const institution=await institutionForPdf(admin);
  const p=await PDFDocument.create();
  const page=p.addPage([841.89,595.28]);
  const regular=await p.embedFont(StandardFonts.Helvetica);
  const bold=await p.embedFont(StandardFonts.HelveticaBold);
  const W=841.89,H=595.28;
  const theme=teacher?{primary:GOLD_DARK,primary2:GOLD,pale:GOLD_SOFT,gold:GOLD,leaf:rgb(.82,.72,.49),paper:rgb(.995,.99,.965)}:{primary:GREEN,primary2:GREEN2,pale:PALE,gold:GOLD,leaf:rgb(.72,.82,.79),paper:PAPER};
  drawFloral(page,W,H,theme);

  const logoBytes=await loadLogo();
  if(logoBytes){
    const logo=await p.embedPng(logoBytes);
    page.drawImage(logo,{x:27,y:H-73,width:58,height:61});
  }
  line(page,105,H-30,105,H-98,rgb(.616,.702,.682),.7);
  page.drawText(institution.siglas||'ITHLA',{x:115,y:H-42,size:13,font:bold,color:theme.primary===GOLD_DARK?INK:INK});
  page.drawText(short(institution.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',78),{x:115,y:H-54,size:7.1,font:bold,color:INK});
  page.drawText(`CCT ${institution.cct||'—'} · ${institution.clave_rvoe||'—'} · Zona ${institution.zona_escolar||'—'} · Sector ${institution.sector||'—'}`,{x:115,y:H-65,size:5.8,font:regular,color:GRAY});
  page.drawText(`${institution.entidad||'—'} · ${institution.telefono||'—'} · ${short(institution.direccion||'—',92)}`,{x:115,y:H-76,size:5.2,font:regular,color:GRAY});
  page.drawText('SISTEMA DE GESTIÓN ESCOLAR · HORARIO ACADÉMICO',{x:115,y:H-87,size:5.8,font:regular,color:GRAY});
  line(page,700,H-30,700,H-98,GOLD,.8);
  const scheduleMotto=mottoLines(institution,4,22);
  scheduleMotto.forEach((lineText,i)=>page.drawText(lineText,{x:712,y:H-48-i*10,size:7.2,font:regular,color:theme.primary}));

  page.drawText('HORARIO SEMANAL DE CLASES',{x:27,y:H-102,size:19,font:bold,color:theme.primary});
  page.drawText(`Ciclo escolar ${cycle}`,{x:27,y:H-116,size:8.5,font:bold,color:theme.primary===GOLD_DARK?INK:INK});

  const rightX=650;
  rect(page,rightX,H-121,165,24,rgb(1,1,1,.78),theme.primary,.9);
  const group=student?.grupos?.clave||groupInfo?.clave||'—';
  if(teacher){
    page.drawText('DOCUMENTO',{x:rightX+9,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText('CICLO',{x:rightX+91,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText('HORARIO DOCENTE',{x:rightX+9,y:H-118,size:7.0,font:bold,color:INK});
    page.drawText(String(cycle||'—'),{x:rightX+124,y:H-118,size:7.2,font:bold,color:INK});
  }else if(student){
    page.drawText('DOCUMENTO',{x:rightX+9,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText('CICLO',{x:rightX+91,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText('HORARIO DEL ALUMNO',{x:rightX+9,y:H-118,size:7.0,font:bold,color:INK});
    page.drawText(String(cycle||'—'),{x:rightX+124,y:H-118,size:7.2,font:bold,color:INK});
  }else{
    page.drawText('DOCUMENTO',{x:rightX+9,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText('CICLO',{x:rightX+91,y:H-108,size:6.5,font:bold,color:theme.primary});
    page.drawText(`HORARIO ${group||'GRUPO'}`,{x:rightX+9,y:H-118,size:7.0,font:bold,color:INK});
    page.drawText(String(cycle||'—'),{x:rightX+124,y:H-118,size:7.2,font:bold,color:INK});
  }

  const infoY=H-159, infoH=32, gap=4;
  const info=teacher
    ? [['Docente',teacher.nombre_completo||'—',1.55],['No. empleado',teacher.numero_empleado||'—',.85],['Especialidad',teacher.especialidad||'—',1.0],['Ciclo escolar',cycle||'—',1.25]]
    : groupInfo && !student
      ? [['Grupo',groupInfo.clave||group||'—',1.0],['Grado',groupInfo.grado?`${groupInfo.grado}°`:'—',.75],['Turno',groupInfo.turno||'—',.9],['Ciclo escolar',cycle||'—',1.25]]
      : [['Alumno',student?.nombre_completo||'—',1.55],['Matrícula',student?.matricula||'—',.85],['Grado / grupo',student?.grupos?.grado?`${student.grupos.grado}° ${student.grupos?.clave||''}`:group||'—',1.0],['Turno',student?.grupos?.turno||groupInfo?.turno||'—',.75],['Taller extracurricular',workshop,1.25]];
  if(teacher){
    info.splice(0,info.length,
      ['Docente',teacher.nombre_completo||'—',1.75],
      ['No. empleado',teacher.numero_empleado||'—',.78],
      ['Especialidad',teacher.especialidad||'—',1.15],
      ['Ciclo escolar',cycle,.8]
    );
  } else if(groupInfo){
    info.splice(0,info.length,
      ['Grupo',groupInfo.clave||'—',.9],
      ['Grado',groupInfo.grado?`${groupInfo.grado}°`: '—',.65],
      ['Turno',groupInfo.turno||'—',1.05],
      ['Ciclo escolar',cycle,1.0]
    );
  }
  const totalW=W-54-gap*(info.length-1); const sum=info.reduce((a,x)=>a+x[2],0);
  let ix=27;
  for(const [label,value,weight] of info){
    const iw=totalW*(weight/sum);rect(page,ix,infoY,iw,infoH,rgb(1,1,1,.84),LINE,.7);
    page.drawText(label.toUpperCase(),{x:ix+7,y:infoY+20,size:5.8,font:bold,color:GRAY});
    const fit=fitText(bold,value,iw-14,8.8,8.8,6.2);
    page.drawText(fit.text,{x:ix+7,y:infoY+8,size:fit.size,font:bold,color:theme.primary===GOLD_DARK?INK:INK});
    ix+=iw+gap;
  }

  // Materias y docentes: solo se imprime en horario de alumno/grupo.
  // El horario docente empieza directamente con su tabla semanal.
  let listTop=infoY-15;
  let shown=[];
  let listRow=0;
  if(!teacher){
    const sectionTitleY=infoY-15;
    page.drawRectangle({x:27,y:sectionTitleY-16,width:W-54,height:16,color:theme.primary});
    page.drawText('MATERIAS Y DOCENTES',{x:34,y:sectionTitleY-11,size:8.5,font:bold,color:rgb(1,1,1)});
    const subjects=uniqueSubjects(rows,false);
    const availableRows=Math.min(18,Math.max(1,Math.floor((H-220)/12)));
    shown=subjects.slice(0,availableRows);
    listRow=Math.max(10,Math.min(15,180/Math.max(1,shown.length)));
    const col1=27,col2=57,col3=470,col4=W-27;
    const tableH=(shown.length+1)*listRow;
    const listBottom=sectionTitleY-16-tableH;
    rect(page,col1,listBottom,col4-col1,tableH,rgb(1,1,1,.86),LINE,.7);
    line(page,col2,sectionTitleY-16,col2,listBottom,LINE,.7);
    line(page,col3,sectionTitleY-16,col3,listBottom,LINE,.7);
    page.drawText('No.',{x:35,y:sectionTitleY-27,size:7.2,font:bold,color:theme.primary});
    page.drawText('NOMBRE DE MATERIA / ASIGNATURA',{x:col2+7,y:sectionTitleY-27,size:7.2,font:bold,color:theme.primary});
    page.drawText('DOCENTE',{x:col3+7,y:sectionTitleY-27,size:7.2,font:bold,color:theme.primary});
    line(page,col1,sectionTitleY-32,col4,sectionTitleY-32,LINE,.7);
    shown.forEach((subj,i)=>{
      const yTop=sectionTitleY-32-i*listRow;
      if(i>0)line(page,col1,yTop,col4,yTop,LINE,.55);
      cellText(page,bold,String(i+1),col1,yTop-listRow,col2-col1,listRow,7.2,true,theme.primary);
      cellText(page,bold,subj.materia,col2,yTop-listRow,col3-col2,listRow,7.1,true,INK);
      cellText(page,regular,subj.docente,col3,yTop-listRow,col4-col3,listRow,6.7,false,GRAY);
    });
    if(subjects.length>shown.length){
      const extra=subjects.length-shown.length;
      const yTop=sectionTitleY-32-shown.length*listRow;
      cellText(page,regular,`+ ${extra} materia(s) no mostradas en este resumen`,col2,yTop-listRow,col4-col2,listRow,6.5,false,GRAY);
    }
    listTop=listBottom;
  }
  // Horario semanal
  const schedTitleY=listTop-10;
  page.drawRectangle({x:27,y:schedTitleY-16,width:W-54,height:16,color:theme.primary});
  page.drawText('HORARIO SEMANAL',{x:34,y:schedTitleY-11,size:8.5,font:bold,color:rgb(1,1,1)});
  const tableTop=schedTitleY-16;
  const slots=getSlots(rows, student?.grupos?.turno || groupInfo?.turno || null);
  const usableH=Math.max(130,tableTop-48);
  const rowH=Math.min(31,Math.max(22,usableH/(Math.max(1,slots.length)+1)));
  const timeW=64, dayW=(W-54-timeW)/5, x0=27;
  rect(page,x0,tableTop-(slots.length+1)*rowH,timeW+dayW*5,(slots.length+1)*rowH,rgb(1,1,1,.9),LINE,.75);
  page.drawRectangle({x:x0,y:tableTop-rowH,width:timeW,height:rowH,color:theme.pale,borderColor:LINE,borderWidth:.5});
  cellText(page,bold,'HORA',x0,tableTop-rowH,timeW,rowH,8.5,true,theme.primary);
  days.forEach((d,i)=>{const x=x0+timeW+i*dayW;page.drawRectangle({x,y:tableTop-rowH,width:dayW,height:rowH,color:theme.pale,borderColor:LINE,borderWidth:.5});cellText(page,bold,d,x,tableTop-rowH,dayW,rowH,8.2,true,theme.primary);});
  slots.forEach((slot,ri)=>{
    const [start,end]=slot.split('|'); const y=tableTop-(ri+2)*rowH;
    page.drawRectangle({x:x0,y,width:timeW,height:rowH,color:rgb(.95,.97,.96),borderColor:LINE,borderWidth:.5});
    cellText(page,bold,`${start}–${end}`,x0,y,timeW,rowH,7.5,true,INK);
    days.forEach((_,di)=>{
      const x=x0+timeW+di*dayW;
      const r=(rows||[]).find(z=>Number(z.dia_semana)===di+1&&String(z.hora_inicio||'').slice(0,5)===start&&String(z.hora_fin||'').slice(0,5)===end);
      page.drawRectangle({x,y,width:dayW,height:rowH,color:r?(r.subject_color?hexToRgb(r.subject_color, teacher?GOLD_CELL:CELL):(teacher?GOLD_CELL:CELL)):rgb(1,1,1,.82),borderColor:LINE,borderWidth:.5});
      if(r){
        const materia=r.grupo_materias?.materias?.nombre||'Materia';
        const subY=y+rowH/2+1;
        const f=fitText(bold,materia,dayW-8,rowH>=27?8.3:7.7,rowH>=27?8.3:7.7,6.1);
        page.drawText(f.text,{x:x+(dayW-textWidth(bold,f.text,f.size))/2,y:subY,size:f.size,font:bold,color:theme.primary===GOLD_DARK?INK:INK});
        const second=teacher
          ? (r.grupo_materias?.grupos?.clave||'—')
          : (r.docente?.nombre_completo ? `${r.docente.nombre_completo}${r.aula?' · '+r.aula:''}` : (r.aula||'Sin docente'));
        const sf=fitText(regular,second,dayW-8,6.4,6.4,5.0);
        page.drawText(sf.text,{x:x+(dayW-textWidth(regular,sf.text,sf.size))/2,y:y+5,size:sf.size,font:regular,color:GRAY});
      }
    });
  });

  page.drawText('Documento generado automáticamente por ITHLA',{x:27,y:29,size:6.2,font:regular,color:rgb(1,1,1)});
  page.drawText('HORARIO ESCOLAR',{x:W-125,y:29,size:6.2,font:bold,color:rgb(1,1,1)});

  // Página 2: firmas oficiales. Para alumnos incluye a todos los docentes del grupo;
  // para docentes funciona como constancia de aceptación del horario.
  const signPage=p.addPage([W,H]);
  drawFloral(signPage,W,H,theme);
  if(logoBytes){const logo2=await p.embedPng(logoBytes);signPage.drawImage(logo2,{x:27,y:H-73,width:58,height:61});}
  signPage.drawText('ITHLA',{x:105,y:H-42,size:13,font:bold,color:INK});
  signPage.drawText(teacher?'CONSTANCIA DE ACEPTACIÓN DEL HORARIO':'VALIDACIÓN DEL HORARIO DEL ALUMNO',{x:105,y:H-55,size:8,font:bold,color:theme.primary});
  signPage.drawText(`Ciclo escolar ${cycle}`,{x:105,y:H-68,size:7,font:regular,color:GRAY});

  const authorities=teacher
    ? [['Servicios Docentes','servicios_docentes'],['Coordinación Académica','coordinacion_academica'],['Dirección Escolar','direccion_escolar']]
    : [['Servicios Estudiantiles','servicios_estudiantiles'],['Coordinación Académica','coordinacion_academica'],['Control Escolar','control_escolar'],['Dirección Escolar','direccion_escolar']];
  const ap=await Promise.all(authorities.map(async ([label,role])=>[label,await profileSignatureByRole(admin,role)]));
  signPage.drawRectangle({x:27,y:H-105,width:W-54,height:18,color:theme.primary});
  signPage.drawText('FIRMAS DE AUTORIDADES',{x:34,y:H-99,size:8,font:bold,color:rgb(1,1,1)});
  let schedulePages=2;
  const cols=teacher?3:4, aw=(W-54-(cols-1)*6)/cols;
  for(let i=0;i<ap.length;i++){
    const [label,profile]=ap[i];
    const x=27+i*(aw+6);
    await drawSignatureBox(signPage,p,admin,{x,y:H-205,w:aw,h:88,label,profile});
  }

  if(teacher){
    const acceptance=await admin.from('aceptaciones_horario_docente').select('*').eq('docente_id',teacher.id).eq('ciclo_escolar',cycle).maybeSingle();
    let tp=null;
    if(acceptance?.data?.estado==='aceptado' && acceptance?.data?.firma_path){
      tp={id:teacher.auth_user_id||null,nombre_completo:teacher.nombre_completo,rol:'docente',firma_path:acceptance.data.firma_path,firma_sha256:acceptance.data.firma_sha256||null};
    }
    signPage.drawRectangle({x:27,y:H-238,width:W-54,height:18,color:theme.primary});
    signPage.drawText('ACEPTACIÓN DEL DOCENTE',{x:34,y:H-232,size:8,font:bold,color:rgb(1,1,1)});
    await drawSignatureBox(signPage,p,admin,{x:27,y:H-370,w:260,h:112,label:acceptance?.data?.estado==='aceptado'?'Horario aceptado':'Firma del docente',profile:tp,showName:false,missingText:acceptance?.data?.estado==='aceptado'?'FIRMA NO DISPONIBLE':'PENDIENTE DE ACEPTACIÓN'});
    signPage.drawText(acceptance?.data?.estado==='aceptado'?`Aceptado el ${new Date(acceptance.data.aceptado_at).toLocaleString('es-MX')}`:'El docente aún no ha aceptado este horario.',{x:305,y:H-290,size:8,font:bold,color:acceptance?.data?.estado==='aceptado'?theme.primary:GRAY});
    signPage.drawText('La firma registrada se utiliza como método de aceptación y permanece en almacenamiento privado.',{x:305,y:H-308,size:6.5,font:regular,color:GRAY});
  } else {
    const teacherProfiles=[];
    const seen=new Set();
    for(const r of rows||[]){const t=r.docente;if(!t||seen.has(t.id||t.nombre_completo))continue;seen.add(t.id||t.nombre_completo);let prof=await profileSignatureByAuth(admin,t.auth_user_id,t.nombre_completo,'docente',t.correo);if(!prof?.firma_path){const acc=await admin.from('aceptaciones_horario_docente').select('firma_path,firma_sha256,aceptado_at').eq('docente_id',t.id).eq('ciclo_escolar',cycle).eq('estado','aceptado').maybeSingle();if(acc.data?.firma_path)prof={id:t.auth_user_id||null,nombre_completo:t.nombre_completo,rol:'docente',firma_path:acc.data.firma_path,firma_sha256:acc.data.firma_sha256||null};}teacherProfiles.push({name:t.nombre_completo,profile:prof});}
    signPage.drawRectangle({x:27,y:H-238,width:W-54,height:18,color:theme.primary});
    signPage.drawText('FIRMAS DE DOCENTES DEL GRUPO',{x:34,y:H-232,size:8,font:bold,color:rgb(1,1,1)});
    const max=teacherProfiles.slice(0,20), tw=(W-54-15*5)/4;
    for(let i=0;i<max.length;i++){
      const t=max[i],col=i%4,row=Math.floor(i/4);
      await drawSignatureBox(signPage,p,admin,{x:27+col*(tw+5),y:H-340-row*68,w:tw,h:58,label:t.name,profile:t.profile,showName:false});
    }
    if(teacherProfiles.length>20){schedulePages=3;const extra=p.addPage([W,H]);drawFloral(extra,W,H,theme);if(logoBytes){const logo3=await p.embedPng(logoBytes);extra.drawImage(logo3,{x:27,y:H-73,width:58,height:61});}extra.drawText(institution.siglas||'ITHLA',{x:105,y:H-42,size:13,font:bold,color:INK});extra.drawText('FIRMAS DOCENTES · CONTINUACIÓN',{x:105,y:H-55,size:8,font:bold,color:theme.primary});const rest=teacherProfiles.slice(20);for(let i=0;i<rest.length;i++){const t=rest[i],col=i%4,row=Math.floor(i/4);await drawSignatureBox(extra,p,admin,{x:27+col*(tw+5),y:H-145-row*68,w:tw,h:58,label:t.name,profile:t.profile,showName:false});}extra.drawRectangle({x:27,y:15,width:W-54,height:17,color:theme.primary});extra.drawText(`${institution.siglas||'ITHLA'} · DOCUMENTO OFICIAL`,{x:35,y:21,size:5.2,font:bold,color:rgb(1,1,1)});}

  }
  signPage.drawRectangle({x:27,y:15,width:W-54,height:17,color:theme.primary});
  signPage.drawText('ITHLA · DOCUMENTO OFICIAL',{x:35,y:21,size:5.2,font:bold,color:rgb(1,1,1)});
  signPage.drawText(`Página 2 de ${schedulePages}`,{x:W-83,y:21,size:5.2,font:bold,color:rgb(1,1,1)});
  if(verification?.qrBytes){await addQrToPage(signPage,p,verification.qrBytes,{x:W-82,y:39,size:55});signPage.drawText('ESCANEA PARA VALIDAR',{x:W-205,y:42,size:5.1,font:bold,color:theme.primary});}
  return {pdf_base64:Buffer.from(await p.save()).toString('base64')};
}

async function studentSchedulePdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const {data:s}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(!s)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const {data:rows,error}=await admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materia_id,grupo_materias!inner(id,grupo_id,materias(nombre),grupos!inner(id,clave,turno)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',s.grupo_id).eq('ciclo_escolar',cycle).order('hora_inicio').order('dia_semana');
  if(error)throw error;
  const gmIds=[...new Set((rows||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){ const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,docentes(id,nombre_completo,auth_user_id)').in('grupo_materia_id',gmIds).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae; const amap=new Map((as||[]).map(a=>[String(a.grupo_materia_id),a.docentes])); for(const r of rows||[]){ if(!r.docente) r.docente=amap.get(String(r.grupo_materia_id))||null; }}
  const teacherIds=[...new Set((rows||[]).map(r=>r.docente?.id).filter(Boolean))];
  let colorMap=new Map();
  if(teacherIds.length){const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('docente_id,materia_id,color_hex').in('docente_id',teacherIds);if(ce)throw ce;colorMap=new Map((colors||[]).map(c=>[`${c.docente_id}|${c.materia_id}`,c.color_hex]));}
  for(const r of rows||[]){const mid=r.grupo_materias?.materia_id;const tid=r.docente?.id;r.subject_color=colorMap.get(`${tid}|${mid}`)||null;}
  const {data:workshop}=await admin.from('inscripciones_talleres').select('talleres(nombre),estado,ciclo_escolar').eq('alumno_id',id).eq('estado','inscrito').order('id',{ascending:false}).limit(1).maybeSingle();
  const folio=`HOR-${cycle.replace(/[^0-9]/g,'')}-${String(s.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'horario_alumno',titulo:'HORARIO DEL ALUMNO',alumno_id:s.id,created_by:null,req,payload:{alumno:{nombre:s.nombre_completo,matricula:s.matricula,grupo:s.grupos?.clave,grado:s.grupos?.grado?`${s.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:(await institutionForPdf(admin)).siglas,nombre_institucion:(await institutionForPdf(admin)).nombre_institucion},detalle:(rows||[]).slice(0,40).map(r=>({label:`${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)} · ${days[(Number(r.dia_semana)||1)-1]||''}`,value:`${r.grupo_materias?.materias?.nombre||'Materia'} · ${r.docente?.nombre_completo||'Sin docente'}${r.aula?' · '+r.aula:''}`}))}});
  try{
    verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});
    const pdf=await drawSchedulePdf({admin,student:s,rows:rows||[],cycle,workshop:workshop?.talleres?.nombre||'Sin taller asignado',req,verification});
    return {...pdf,folio,filename:`ITHLA-Horario-${safe(s.matricula||s.nombre_completo)}.pdf`};
  }catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}

async function teacherSchedulePdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const {data:t}=await admin.from('docentes').select('id,nombre_completo,numero_empleado,especialidad,auth_user_id').eq('id',id).maybeSingle();
  if(!t)throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const {data:rows,error}=await admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materia_id,grupo_materias(id,materia_id,materias(nombre),grupos(clave)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('docente_id',id).eq('ciclo_escolar',cycle).order('hora_inicio').order('dia_semana');
  if(error)throw error;
  const gmIds=[...new Set((rows||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,grupo_materias(materia_id)').eq('docente_id',id).eq('activo',true).in('grupo_materia_id',gmIds);if(ae)throw ae;const mids=new Set((as||[]).map(a=>String(a.grupo_materias?.materia_id)).filter(Boolean));if(mids.size){const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('materia_id,color_hex').eq('docente_id',id).in('materia_id',[...mids]);if(ce)throw ce;const cmap=new Map((colors||[]).map(c=>[String(c.materia_id),c.color_hex]));for(const r of rows||[]){r.subject_color=cmap.get(String(r.grupo_materias?.materia_id))||null;}}}
  const folio=`HDT-${cycle.replace(/[^0-9]/g,'')}-${String(t.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const institution=await institutionForPdf(admin);
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'horario_docente',titulo:'HORARIO DEL DOCENTE',created_by:null,req,payload:{alumno:{},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Docente',value:t.nombre_completo},{label:'No. empleado',value:t.numero_empleado||'—'},{label:'Ciclo escolar',value:cycle},...(rows||[]).slice(0,40).map(r=>({label:`${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)} · ${days[(Number(r.dia_semana)||1)-1]||''}`,value:`${r.grupo_materias?.materias?.nombre||'Materia'} · ${r.grupo_materias?.grupos?.clave||'—'}${r.aula?' · '+r.aula:''}`}))]}});
  try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const pdf=await drawSchedulePdf({admin,teacher:t,rows:rows||[],cycle,req,verification});return {...pdf,folio,filename:`ITHLA-Horario-Docente-${safe(t.numero_empleado||t.nombre_completo)}.pdf`};}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}

async function groupSchedulePdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const {data:g}=await admin.from('grupos').select('id,clave,grado,letra,turno').eq('id',id).maybeSingle();
  if(!g)throw Object.assign(new Error('Grupo no encontrado.'),{status:404});
  const {data:rows,error}=await admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materia_id,grupo_materias!inner(id,grupo_id,materias(nombre),grupos!inner(id,clave,turno)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',id).eq('ciclo_escolar',cycle).order('hora_inicio').order('dia_semana');
  if(error)throw error;
  const gmIds=[...new Set((rows||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){ const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,docentes(id,nombre_completo,auth_user_id)').in('grupo_materia_id',gmIds).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae; const amap=new Map((as||[]).map(a=>[String(a.grupo_materia_id),a.docentes])); for(const r of rows||[]){ if(!r.docente) r.docente=amap.get(String(r.grupo_materia_id))||null; }}
  const teacherIds=[...new Set((rows||[]).map(r=>r.docente?.id).filter(Boolean))];
  let colorMap=new Map();
  if(teacherIds.length){const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('docente_id,materia_id,color_hex').in('docente_id',teacherIds);if(ce)throw ce;colorMap=new Map((colors||[]).map(c=>[`${c.docente_id}|${c.materia_id}`,c.color_hex]));}
  for(const r of rows||[]){const mid=r.grupo_materias?.materia_id;const tid=r.docente?.id;r.subject_color=colorMap.get(`${tid}|${mid}`)||null;}
  const folio=`HGR-${cycle.replace(/[^0-9]/g,'')}-${String(g.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const institution=await institutionForPdf(admin);
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'horario_grupo',titulo:`HORARIO DEL GRUPO ${g.clave||''}`,created_by:null,req,payload:{institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Grupo',value:g.clave||'—'},{label:'Grado',value:g.grado?`${g.grado}°`:'—'},{label:'Turno',value:g.turno||'—'},{label:'Ciclo escolar',value:cycle},...(rows||[]).slice(0,40).map(r=>({label:`${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)} · ${days[(Number(r.dia_semana)||1)-1]||''}`,value:`${r.grupo_materias?.materias?.nombre||'Materia'} · ${r.docente?.nombre_completo||'Sin docente'}${r.aula?' · '+r.aula:''}`}))]}});
  try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const pdf=await drawSchedulePdf({admin,group:g,groupInfo:g,rows:rows||[],cycle,req,verification});return {...pdf,folio,filename:`ITHLA-Horario-Grupo-${safe(g.clave||id)}.pdf`};}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}


async function credentialPdf(admin,id,req=null){
  const institution=await institutionForPdf(admin);
  const {data:s,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,turno,grado_ingreso,sexo,auth_user_id,grupos(id,clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(error) throw error;
  if(!s) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const cycle=await activeCycle(admin);
  const profileQ=await admin.from('perfiles').select('correo,correo_recuperacion,matricula').eq('matricula',s.matricula).maybeSingle();
  if(profileQ.error) throw profileQ.error;
  const email=profileQ.data?.correo||'';
  const W=242.65,H=153.07; // 85.6 × 54 mm, tamaño de credencial
  const p=await PDFDocument.create();
  const regular=await p.embedFont(StandardFonts.Helvetica);
  const bold=await p.embedFont(StandardFonts.HelveticaBold);
  const logoBytes=await loadLogo();
  const logo=logoBytes?await p.embedPng(logoBytes):null;
  const green=GREEN, dark=rgb(.018,.20,.17), gold=GOLD, goldDark=GOLD_DARK, paper=rgb(.985,.99,.975), muted=GRAY;
  const group=s.grupos?.clave||'—';
  const grade=s.grupos?.grado||s.grado_ingreso||'—';
  const turn=s.grupos?.turno||s.turno||'—';
  const folio=`CRD-${cycle.replace(/[^0-9]/g,'')}-${String(s.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const shortName=short(s.nombre_completo||'Alumno',30);
  const drawBg=(page,back=false)=>{
    page.drawRectangle({x:0,y:0,width:W,height:H,color:paper});
    page.drawRectangle({x:0,y:H-34,width:W,height:34,color:dark});
    page.drawRectangle({x:0,y:H-37,width:W,height:3,color:gold});
    page.drawRectangle({x:0,y:0,width:7,height:H,color:green});
    page.drawCircle({x:W-20,y:20,size:38,color:rgb(.85,.91,.88),opacity:.24});
    page.drawCircle({x:W-36,y:H-10,size:22,color:gold,opacity:.10});
    if(back) page.drawRectangle({x:W-4,y:0,width:4,height:H,color:gold,opacity:.75});
  };
  const text=(page,t,x,y,size,font=regular,color=INK)=>page.drawText(String(t??''),{x,y,size,font,color});
  const fit=(page,t,x,y,maxW,size,font=regular,color=INK)=>{const z=fitText(font,t,maxW,size,size,4.7);text(page,z.text,x,y,z.size,font,color);return z;};
  const label=(page,t,x,y)=>text(page,String(t).toUpperCase(),x,y,4.7,bold,muted);
  const value=(page,t,x,y,maxW=145,size=7)=>fit(page,t,x,y,maxW,size,bold,INK);
  const box=(page,x,y,w,h,border=LINE,fill=rgb(1,1,1,.82))=>page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:border,borderWidth:.65});

  // Frente
  {
    const page=p.addPage([W,H]);drawBg(page,false);
    if(logo) page.drawImage(logo,{x:13,y:H-29,width:25,height:27});
    text(page,institution.siglas||'ITHLA',45,H-14,9,bold,rgb(1,1,1));
    text(page,'CREDENCIAL ESCOLAR',45,H-24,5.3,regular,rgb(.84,.92,.89));
    text(page,'ALUMNO(A)',W-65,H-14,5.2,bold,gold);
    text(page,`CICLO ${cycle}`,W-70,H-24,4.8,bold,rgb(1,1,1));

    // Área de fotografía / identificación visual.
    box(page,13,48,58,62,green,rgb(.94,.97,.95));
    page.drawCircle({x:42,y:88,size:12,color:rgb(.80,.85,.82)});
    page.drawRectangle({x:25,y:55,width:34,height:25,color:rgb(.80,.85,.82)});
    text(page,'FOTO',31,51,5,bold,green);

    label(page,'Alumno',80,104); value(page,shortName,80,92,147,8.4);
    label(page,'Matrícula',80,78); value(page,s.matricula||'—',80,67,80,8.2);
    label(page,'Grupo',168,78); value(page,group,168,67,50,8.2);
    label(page,'Grado',80,54); value(page,`${grade}°`,80,43,45,7.8);
    label(page,'Turno',130,54); value(page,turn,130,43,60,7.8);
    label(page,'Folio de credencial',80,29); value(page,folio,80,18,135,6.3);
    page.drawLine({start:{x:13,y:37},end:{x:W-13,y:37},color:LINE,thickness:.55});
    text(page,'VÁLIDA COMO IDENTIFICACIÓN ESCOLAR',13,8,4.7,bold,green);
    text(page,'Servicios Estudiantiles',W-91,8,4.7,bold,goldDark);
  }
  // Reverso
  {
    const page=p.addPage([W,H]);drawBg(page,true);
    text(page,'DATOS DE EMERGENCIA S.O.S',17,H-50,8.2,bold,green);
    box(page,14,78,W-28,54,green,rgb(1,1,1,.88));
    label(page,'Contacto institucional',23,119); value(page,'Servicios Estudiantiles',23,108,190,7.5);
    label(page,'Alumno',23,96); value(page,shortName,23,85,190,7.2);
    label(page,'Matrícula',23,73); value(page,s.matricula||'—',23,62,75,7.1);
    label(page,'Correo institucional',108,73); value(page,email||'—',108,62,105,6.3);
    text(page,'DATOS DE ESCUELA',17,47,7.5,bold,green);
    box(page,14,14,W-28,27,goldDark,rgb(1,1,1,.9));
    text(page,short(institution.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',70),22,31,5.5,bold,rgb(1,1,1));
    text(page,`${institution.siglas||'ITHLA'} · CONTROL ESCOLAR`,22,22,5.1,regular,rgb(1,1,1));
    text(page,'FOLIO AUTH.',22,8,4.4,bold,muted);text(page,folio,W-105,8,4.4,bold,green);
  }
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'credencial',titulo:'CREDENCIAL ESCOLAR',alumno_id:s.id,req,payload:{alumno:{nombre:s.nombre_completo,matricula:s.matricula,grupo:group,grado:`${grade}°`,ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Turno',value:turn},{label:'Tipo',value:'Credencial escolar'}]}});
  try{const qr=await qrPng(verification.verificationUrl,{size:150});const qri=await p.embedPng(qr);p.getPages()[1].drawRectangle({x:W-62,y:H-68,width:54,height:54,color:rgb(1,1,1),borderColor:green,borderWidth:.7});p.getPages()[1].drawImage(qri,{x:W-58,y:H-64,width:46,height:46});const bytes=await p.save();return {folio,verification_url:verification.verificationUrl,pdf_base64:Buffer.from(bytes).toString('base64'),filename:`${institution.siglas||'ITHLA'}-Credencial-${safe(s.matricula||s.nombre_completo)}.pdf`};}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}

async function boletaPdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const institution=await institutionForPdf(admin);
  const {data:s,error:se}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,turno,grupos(clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(se) throw se;
  if(!s) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});

  const [gradesQ,periodsQ,attendanceQ,incidentsQ,scheduleTeachersQ]=await Promise.all([
    admin.from('calificaciones').select('id,calificacion,periodo_id,docente_id,observaciones,periodos_escolares(id,nombre,ciclo_escolar),grupo_materias(id,materia_id,materias(id,nombre),grupos(id,clave,grado,letra,turno))').eq('alumno_id',id).order('grupo_materia_id').order('periodo_id'),
    admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,numero_periodo,es_periodo_actual').eq('ciclo_escolar',cycle).order('numero_periodo',{ascending:true}).order('id',{ascending:true}),
    admin.from('asistencias').select('id,fecha,estado,observaciones,grupo_materia_id').eq('alumno_id',id).order('fecha',{ascending:true}).limit(5000),
    admin.from('incidencias_prefectura').select('id,tipo,titulo,descripcion,fecha,estado,observaciones').eq('alumno_id',id).order('fecha',{ascending:false}).limit(500),
    admin.from('horarios').select('grupo_materias!inner(grupo_id),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',s.grupo_id).eq('ciclo_escolar',cycle)
  ]);
  for(const q of [gradesQ,periodsQ,attendanceQ,incidentsQ,scheduleTeachersQ]) if(q.error) throw q.error;

  let periods=(periodsQ.data||[]).filter(p=>p.ciclo_escolar===cycle);
  if(!periods.length){
    const seen=new Map();
    for(const g of gradesQ.data||[]){if(g.periodos_escolares?.ciclo_escolar!==cycle)continue;const p=g.periodos_escolares;if(!seen.has(p.id))seen.set(p.id,p);}
    periods=[...seen.values()].sort((a,b)=>Number(a.id)-Number(b.id));
  }
  periods=periods.sort((a,b)=>Number(a.numero_periodo||0)-Number(b.numero_periodo||0)||Number(a.id)-Number(b.id));
  const periodLabels=periods.map((p,i)=>({id:p.id,label:`P${Number(p.numero_periodo||i+1)}`}));
  const periodIndex=new Map(periodLabels.filter(p=>p.id!=null).map((p,i)=>[String(p.id),i]));

  const subjectMap=new Map();
  for(const g of gradesQ.data||[]){
    if(g.periodos_escolares?.ciclo_escolar!==cycle) continue;
    const sid=g.grupo_materias?.materia_id||g.grupo_materia_id;
    const name=g.grupo_materias?.materias?.nombre||'Materia';
    if(!subjectMap.has(String(sid))) subjectMap.set(String(sid),{materia_id:sid,name,grades:{},teachers:new Set(),observations:[]});
    const x=subjectMap.get(String(sid));
    const pi=periodIndex.get(String(g.periodo_id));
    if(pi!==undefined) x.grades[pi]=(g.calificacion!==null&&g.calificacion!==''&&Number.isFinite(Number(g.calificacion)))?Number(g.calificacion):null;
    if(g.docente_id) x.teachers.add(String(g.docente_id));
    if(g.observaciones) x.observations.push(String(g.observaciones));
  }
  const teacherIds=[...new Set([...subjectMap.values()].flatMap(x=>[...x.teachers]).concat((scheduleTeachersQ.data||[]).map(r=>r.docente?.id).filter(Boolean).map(String)))];
  let teacherNames=new Map();
  if(teacherIds.length){
    const {data:ts,error:te}=await admin.from('docentes').select('id,nombre_completo,correo,auth_user_id').in('id',teacherIds);
    if(te)throw te; teacherNames=new Map((ts||[]).map(t=>[String(t.id),t.nombre_completo]));
  }
  const subjects=[...subjectMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));
  for(const x of subjects){
    x.teacher=[...x.teachers].map(t=>teacherNames.get(t)).filter(Boolean)[0]||'Sin docente';
    const vals=Object.values(x.grades).filter(v=>v!==null&&Number.isFinite(v));
    x.avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }

  const attendance=attendanceQ.data||[];
  const attCounts={presente:0,retardo:0,falta:0,justificada:0};
  for(const a of attendance){const k=String(a.estado||'').toLowerCase();if(k in attCounts)attCounts[k]++;}
  const attTotal=Object.values(attCounts).reduce((a,b)=>a+b,0);
  const attPresent=attCounts.presente+attCounts.justificada;
  const attRate=attTotal?Math.round(attPresent/attTotal*100):null;
  const incidents=incidentsQ.data||[];
  const incidentCounts={}; for(const r of incidents){const k=String(r.tipo||'otro');incidentCounts[k]=(incidentCounts[k]||0)+1;}
  const allGrades=subjects.flatMap(x=>Object.values(x.grades)).filter(v=>Number.isFinite(v));
  const overall=allGrades.length?allGrades.reduce((a,b)=>a+b,0)/allGrades.length:null;
  const approved=subjects.filter(x=>x.avg!=null&&x.avg>=6).length;
  const failed=subjects.filter(x=>x.avg!=null&&x.avg<6).length;
  const observations=[...new Set(subjects.flatMap(x=>x.observations))].filter(Boolean).slice(0,4);
  const folio=`${institution.siglas||'ITHLA'}-${cycle.replace(/[^0-9]/g,'')}-${String(s.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;

  const verification=await registerVerifiableDocument(admin,{folio,tipo:'boleta',titulo:'BOLETA DE CALIFICACIONES',alumno_id:s.id,req,payload:{alumno:{nombre:s.nombre_completo,matricula:s.matricula,grupo:s.grupos?.clave,grado:s.grupos?.grado?`${s.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:subjects.slice(0,40).map(x=>({label:x.name,value:`${periodLabels.map((_,i)=>x.grades[i]==null?'—':Number(x.grades[i]).toFixed(1)).join(' · ')} · Promedio ${x.avg==null?'—':x.avg.toFixed(2)}`}))}});
  let verificationQr=null;
  try{verificationQr=await qrPng(verification.verificationUrl,{size:180});}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}

  const p=await PDFDocument.create();
  const regular=await p.embedFont(StandardFonts.Helvetica);
  const bold=await p.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89;
  const logoBytes=await loadLogo();
  let logo=null;if(logoBytes) logo=await p.embedPng(logoBytes);

  function bg(page,page2=false){
    page.drawRectangle({x:0,y:0,width:W,height:H,color:PAPER});
    page.drawRectangle({x:0,y:0,width:4,height:H,color:GREEN});
    const circles=[[W-35,H-115,48],[30,90,55],[W-15,80,36],[18,H-35,30]];
    for(const [x,y,r] of circles) page.drawCircle({x,y,size:r,color:PALE,opacity:.22,borderColor:LINE,borderWidth:.35});
    page.drawRectangle({x:0,y:H-6,width:W,height:6,color:GREEN});
    page.drawRectangle({x:0,y:H-9,width:W,height:3,color:GOLD});
    if(page2) page.drawRectangle({x:W-7,y:0,width:7,height:H,color:GOLD,opacity:.55});
  }
  function txt(page,text,x,y,size,font=regular,color=INK){page.drawText(String(text??''),{x,y,size,font,color});}
  function fit(page,text,x,y,maxW,size,font=regular,color=INK){const f=fitText(font,text,maxW,size,size,5.2);txt(page,f.text,x,y,f.size,font,color);return f;}
  function box(page,x,y,w,h,fill=rgb(1,1,1,.86),border=LINE,bw=.6){page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:border,borderWidth:bw});}
  function centered(page,text,x,y,w,size,font=regular,color=INK){const f=fitText(font,text,w-6,size,size,5.1);txt(page,f.text,x+(w-textWidth(font,f.text,f.size))/2,y+(size-f.size)/2+2,f.size,font,color);}
  function sectionBar(page,title,y){page.drawRectangle({x:28,y:y-16,width:W-56,height:16,color:GREEN});txt(page,title.toUpperCase(),35,y-11,7,bold,rgb(1,1,1));return y-16;}
  function field(page,label,value,x,y,w,h){box(page,x,y,w,h,rgb(1,1,1,.82),LINE,.5);txt(page,label.toUpperCase(),x+6,y+h-11,5.1,bold,GRAY);fit(page,value,x+6,y+6,w-12,7.2,bold,INK);}
  function tableCell(page,text,x,y,w,h,size=6.2,font=regular,color=INK,fill=null){if(fill)page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:LINE,borderWidth:.45});else page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1,.84),borderColor:LINE,borderWidth:.45});centered(page,text,x,y,w,size,font,color);}

  // PAGE 1 — plantilla visual recuperada, ahora alimentada por datos reales.
  {const page=p.addPage([W,H]);bg(page);
    if(logo) page.drawImage(logo,{x:28,y:H-78,width:48,height:51});
    else {box(page,28,H-78,48,51,rgb(1,1,1,.85),GREEN,1);centered(page,'IN\nETCH',28,H-78,48,9,bold,GREEN);}
    txt(page,institution.siglas||'ITHLA',88,H-39,6.5,bold,GREEN);
    fit(page,institution.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',88,H-55,330,11.5,bold,INK);
    txt(page,'SISTEMA DE CONTROL ESCOLAR',88,H-68,6.5,bold,GRAY);
    const boletaMotto=mottoLines(institution,4,14);
    boletaMotto.forEach((lineText,i)=>fit(page,lineText,470,H-42-i*10,97,7.2,regular,GREEN));
    page.drawLine({start:{x:28,y:H-94},end:{x:W-28,y:H-94},thickness:1.8,color:GREEN});
    txt(page,'BOLETA DE CALIFICACIONES',28,H-112,17,bold,GREEN);
    txt(page,`Ciclo escolar ${cycle}  |  ${periodLabels.length?`Periodos: ${periodLabels.map(x=>x.label).join(' · ')}`:'Sin periodos registrados'}`,28,H-126,6.6,bold,GRAY);
    box(page,442,H-133,125,34,rgb(1,1,1,.86),GREEN,.8);txt(page,'FOLIO',451,H-111,5.2,bold,GRAY);fit(page,folio,451,H-126,108,7.2,bold,GREEN);
    let fy=H-176; const gap=4; const fw=(W-56-gap*2)/3;
    const fields=[['Nombre completo',s.nombre_completo||'—'],['Matrícula',s.matricula||'—'],['Grupo',s.grupos?.clave||'—'],['Grado',s.grupos?.grado?`${s.grupos.grado}°`:'—'],['Turno',s.grupos?.turno||s.turno||'—'],['Ciclo escolar',cycle]];
    for(let i=0;i<fields.length;i++){const col=i%3,row=Math.floor(i/3);field(page,fields[i][0],fields[i][1],28+col*(fw+gap),fy-row*31,fw,28);}
    let y=fy-70; y=sectionBar(page,'Evaluación académica',y);
    const headerY=y-19;
    const availableW=W-56;
    const noW=20, subjectW=188, teacherW=94, averageW=52;
    const periodW=Math.max(36,Math.min(58,Math.floor((availableW-noW-subjectW-teacherW-averageW)/Math.max(1,periodLabels.length))));
    const tableW=noW+subjectW+(periodW*periodLabels.length)+averageW+teacherW;
    const cols=[28,28+noW,28+noW+subjectW];
    for(let i=0;i<periodLabels.length;i++) cols.push(cols[cols.length-1]+periodW);
    cols.push(cols[cols.length-1]+averageW,28+tableW);
    const labels=['No.','Asignatura / materia',...periodLabels.map(x=>x.label),'Promedio','Docente'];
    for(let i=0;i<labels.length;i++) tableCell(page,labels[i],cols[i],headerY,cols[i+1]-cols[i],18,Math.max(4.5,Math.min(5.3,38/Math.max(1,periodLabels.length))),bold,GREEN,GOLD_SOFT);
    const rowH=Math.max(17,Math.min(22, (headerY-55)/Math.max(1,subjects.length)));
    let yy=headerY-rowH;
    subjects.slice(0,Math.max(1,Math.floor((headerY-55)/rowH))).forEach((x,i)=>{
      tableCell(page,String(i+1),cols[0],yy,noW,rowH,5.8,bold,GREEN);
      tableCell(page,x.name,cols[1],yy,subjectW,rowH,6.0,bold,INK);
      periodLabels.forEach((_,pi)=>tableCell(page,x.grades[pi]==null?'—':Number(x.grades[pi]).toFixed(1),cols[2+pi],yy,periodW,rowH,6.0,bold,INK));
      const avgIndex=2+periodLabels.length;
      tableCell(page,x.avg==null?'—':x.avg.toFixed(2),cols[avgIndex],yy,averageW,rowH,6.0,bold,GREEN);
      tableCell(page,x.teacher,cols[avgIndex+1],yy,teacherW,rowH,5.1,regular,INK);
      yy-=rowH;
    });
    if(!subjects.length){tableCell(page,'Sin calificaciones registradas para este ciclo.',cols[0],yy,tableW,24,6.3,regular,GRAY);yy-=24;}
    if(subjects.length>Math.floor((headerY-55)/rowH)){txt(page,`Se muestran las primeras ${Math.floor((headerY-55)/rowH)} materias; el expediente conserva el resto.`,28,yy+4,5.2,regular,GRAY);}
    const lowerY=75;
    box(page,28,lowerY,250,78,rgb(1,1,1,.84),LINE,.6);sectionBar(page,'Resumen académico',lowerY+78);tableCell(page,'Promedio general',35,lowerY+39,145,20,6.2,bold,GREEN,GOLD_SOFT);tableCell(page,overall==null?'—':overall.toFixed(2),180,lowerY+39,90,20,7,bold,GREEN);tableCell(page,'Materias aprobadas',35,lowerY+19,145,20,6.2,bold,GREEN,GOLD_SOFT);tableCell(page,`${approved} / ${subjects.length}`,180,lowerY+19,90,20,7,bold,GREEN);tableCell(page,'Materias reprobadas',35,lowerY,145,19,6.2,bold,GREEN,GOLD_SOFT);tableCell(page,String(failed),180,lowerY,90,19,7,bold,GREEN);
    box(page,286,lowerY,281,78,rgb(1,1,1,.84),GREEN,.8);sectionBar(page,'Promedio final',lowerY+78);txt(page,overall==null?'—':overall.toFixed(2),315,lowerY+28,25,bold,GREEN);txt(page,'PROMEDIO GENERAL DEL CICLO',315,lowerY+12,6.2,bold,GRAY);txt(page,`Asistencia registrada: ${attRate==null?'—':attRate+'%'}`,435,lowerY+27,7,bold,INK);txt(page,`Faltas: ${attCounts.falta}`,435,lowerY+15,6.2,regular,GRAY);
    const footerY=35;page.drawRectangle({x:28,y:footerY,width:W-56,height:17,color:GREEN});txt(page,'DISCIPLINA · ESFUERZO · EXCELENCIA',35,footerY+6,5.2,bold,rgb(1,1,1));txt(page,'Página 1 de 3',W-83,footerY+6,5.2,bold,rgb(1,1,1));
  }

  // PAGE 2 — asistencia, incidencias, observaciones y firmas.
  {const page=p.addPage([W,H]);bg(page,true);
    if(logo) page.drawImage(logo,{x:28,y:H-78,width:48,height:51});
    txt(page,institution.siglas||'ITHLA',88,H-39,6.5,bold,GREEN);fit(page,institution.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',88,H-55,330,11.5,bold,INK);txt(page,'SISTEMA DE CONTROL ESCOLAR · INFORMACIÓN COMPLEMENTARIA',88,H-68,6.2,bold,GRAY);
    txt(page,'BOLETA · INFORMACIÓN COMPLEMENTARIA',28,H-112,15,bold,GREEN);txt(page,`${s.nombre_completo||'—'}  ·  ${s.matricula||'—'}  ·  ${s.grupos?.clave||'—'}`,28,H-126,6.6,bold,GRAY);
    const page2Subjects=subjects.slice(0,9);
    let y=H-148; y=sectionBar(page,'Concentrado de calificaciones por periodo',y);const top=y-18;
    const cW=W-56, subW=210, avgW2=72, pw2=Math.max(34,Math.min(58,Math.floor((cW-subW-avgW2)/Math.max(1,periodLabels.length))));
    const c=[28,28+subW,...Array.from({length:periodLabels.length},(_,i)=>28+subW+(i*pw2)),28+subW+(periodLabels.length*pw2)];
    const avgX=c[c.length-1];
    tableCell(page,'Asignatura / materia',c[0],top,subW,18,5.3,bold,GREEN,GOLD_SOFT);
    periodLabels.forEach((p,i)=>tableCell(page,p.label,c[i+1],top,pw2,18,5.1,bold,GREEN,GOLD_SOFT));
    tableCell(page,'Promedio final',avgX,top,avgW2,18,5.1,bold,GREEN,GOLD_SOFT);
    let gy=top-20;
    page2Subjects.forEach((x)=>{tableCell(page,x.name,c[0],gy,subW,20,6.0,bold,INK);for(let pi=0;pi<periodLabels.length;pi++)tableCell(page,x.grades[pi]==null?'—':Number(x.grades[pi]).toFixed(1),c[1+pi],gy,pw2,20,6.0,bold,INK);tableCell(page,x.avg==null?'—':x.avg.toFixed(2),avgX,gy,avgW2,20,6.0,bold,GREEN);gy-=20;});
    const midY=470;box(page,28,midY,260,120,rgb(1,1,1,.84),LINE,.6);sectionBar(page,'Asistencia',midY+120);const aRows=[['Presentes',attCounts.presente],['Retardos',attCounts.retardo],['Faltas',attCounts.falta],['Justificadas',attCounts.justificada],['Total registros',attTotal],['Porcentaje',attRate==null?'—':`${attRate}%`]];aRows.forEach((r,i)=>{tableCell(page,r[0],35,midY+91-i*18,155,18,5.8,bold,GREEN,GOLD_SOFT);tableCell(page,String(r[1]),190,midY+91-i*18,90,18,6.2,bold,GREEN);});
    box(page,296,midY,271,120,rgb(1,1,1,.84),LINE,.6);sectionBar(page,'Incidencias',midY+120);const incRows=Object.entries(incidentCounts);if(!incRows.length){tableCell(page,'Sin incidencias registradas.',303,midY+72,257,22,6.2,regular,GRAY);}else incRows.slice(0,5).forEach((r,i)=>{tableCell(page,r[0].replace(/_/g,' '),303,midY+91-i*18,170,18,5.6,bold,INK,GOLD_SOFT);tableCell(page,String(r[1]),473,midY+91-i*18,87,18,6.2,bold,GREEN);});
    const obsY=320;box(page,28,obsY,539,78,rgb(1,1,1,.84),LINE,.6);sectionBar(page,'Observaciones',obsY+78);let obs=observations.join(' · ');if(!obs)obs=incidents[0]?.observaciones||incidents[0]?.descripcion||'Sin observaciones académicas registradas.';fit(page,obs,38,obsY+37,519,7,regular,INK);
    const signY=118;box(page,28,signY,539,92,rgb(1,1,1,.84),LINE,.6);sectionBar(page,'Firmas de autoridades',signY+92);
    const auth=[['Control Escolar','control_escolar'],['Coordinación Académica','coordinacion_academica'],['Dirección Escolar','direccion_escolar']];
    for(let i=0;i<auth.length;i++){
      const [label,role]=auth[i],x=28+i*180,prof=await profileSignatureByRole(admin,role);
      const sig=prof?.firma_path?await loadSignatureImage(p,admin,prof.firma_path):null;
      txt(page,label,x+8,signY+16,5.6,bold,GRAY);
      if(sig){const ratio=Math.min(125/sig.image.width,28/sig.image.height);page.drawImage(sig.image,{x:x+27-sig.image.width*ratio/2+62,y:signY+37,width:sig.image.width*ratio,height:sig.image.height*ratio});}
      page.drawLine({start:{x:x+20,y:signY+35},end:{x:x+145,y:signY+35},thickness:.6,color:GRAY});
      fit(page,prof?.firma_path?(prof?.nombre_completo||'Firma registrada'):'FIRMA NO REGISTRADA',x+20,signY+24,125,4.9,regular,GRAY);
    }
    const bottomY=38;box(page,28,bottomY,48,48,rgb(1,1,1,.9),LINE,.7);centered(page,'VALIDACIÓN',28,bottomY+17,48,5.1,bold,GREEN);centered(page,folio.slice(-8),28,bottomY+8,48,5.2,bold,GREEN);fit(page,`Documento generado desde el expediente académico de ${institution.siglas||'ITHLA'}. La validación institucional debe realizarse con el folio indicado.`,86,bottomY+24,390,5.2,regular,GRAY);const qr2=await p.embedPng(verificationQr);page.drawRectangle({x:505,y:bottomY-2,width:58,height:58,color:rgb(1,1,1),borderColor:GREEN,borderWidth:.7});page.drawImage(qr2,{x:510,y:bottomY+3,width:48,height:48});txt(page,'ESCANEA',513,bottomY-8,4.8,bold,GREEN);
    page.drawRectangle({x:28,y:15,width:W-56,height:17,color:GREEN});txt(page,`PLATAFORMA JAGUAR · ${institution.siglas||'ITHLA'}`,35,21,5.2,bold,rgb(1,1,1));txt(page,'Página 2 de 3',W-83,21,5.2,bold,rgb(1,1,1));
  }

  // Página 3 — firmas individuales de todos los docentes del alumno.
  {
    const page=p.addPage([W,H]);bg(page,true);
    if(logo) page.drawImage(logo,{x:28,y:H-78,width:48,height:51});
    txt(page,institution.siglas||'ITHLA',88,H-39,6.5,bold,GREEN);
    fit(page,institution.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',88,H-55,330,11.5,bold,INK);
    txt(page,'BOLETA · FIRMAS DEL CUERPO DOCENTE',88,H-68,6.2,bold,GRAY);
    txt(page,'FIRMAS DE LOS DOCENTES QUE ATIENDEN AL ALUMNO',28,H-112,15,bold,GREEN);
    txt(page,`${s.nombre_completo||'—'} · ${s.matricula||'—'} · ${s.grupos?.clave||'—'}`,28,H-126,6.6,bold,GRAY);
    const teacherProfiles=[]; const seenTeachers=new Set();
    const teacherData=new Map((await admin.from('docentes').select('id,nombre_completo,correo,auth_user_id').in('id',teacherIds)).data?.map(t=>[String(t.id),t])||[]);
    for(const tid of teacherIds){if(seenTeachers.has(String(tid)))continue;seenTeachers.add(String(tid));const t=teacherData.get(String(tid));let prof=await profileSignatureByAuth(admin,t?.auth_user_id,t?.nombre_completo||teacherNames.get(String(tid)),'docente',t?.correo);if(!prof?.firma_path){const acc=await admin.from('aceptaciones_horario_docente').select('firma_path,firma_sha256,aceptado_at').eq('docente_id',tid).eq('estado','aceptado').order('aceptado_at',{ascending:false}).limit(1).maybeSingle();if(acc.data?.firma_path)prof={id:t?.auth_user_id||null,nombre_completo:t?.nombre_completo||teacherNames.get(String(tid))||'Docente',rol:'docente',firma_path:acc.data.firma_path,firma_sha256:acc.data.firma_sha256||null};}teacherProfiles.push({name:t?.nombre_completo||teacherNames.get(String(tid))||'Docente',profile:prof});}
    const cols=2, gap=10, bw=(W-56-gap)/cols, bh=100;
    for(let i=0;i<teacherProfiles.length;i++){
      const t=teacherProfiles[i],col=i%cols,row=Math.floor(i/cols);
      await drawSignatureBox(page,p,admin,{x:28+col*(bw+gap),y:H-250-row*(bh+10),w:bw,h:bh,label:t.name,profile:t.profile,showName:false});
    }
    if(!teacherProfiles.length) txt(page,'No se encontraron docentes vinculados a las calificaciones del ciclo.',28,H-175,7,regular,GRAY);
    page.drawRectangle({x:28,y:15,width:W-56,height:17,color:GREEN});txt(page,`PLATAFORMA JAGUAR · ${institution.siglas||'ITHLA'}`,35,21,5.2,bold,rgb(1,1,1));txt(page,'Página 3 de 3',W-83,21,5.2,bold,rgb(1,1,1));
  }
  return {pdf_base64:Buffer.from(await p.save()).toString('base64'),filename:`${institution.siglas||'ITHLA'}-Boleta-${safe(s.matricula||s.nombre_completo)}.pdf`};
}

async function signatureDiagnostics(admin, body){
  const teacherId=Number(body?.docente_id||0);
  if(!teacherId) throw Object.assign(new Error('docente_id es obligatorio.'),{status:400});
  const {data:t,error:te}=await admin.from('docentes').select('id,nombre_completo,correo,auth_user_id,activo').eq('id',teacherId).maybeSingle();
  if(te) throw te;
  if(!t) throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const diagnostics=[];
  const profiles=await profileSignatureCandidates(admin,{authUserId:t.auth_user_id,fallbackName:t.nombre_completo,fallbackEmail:t.correo,fallbackRole:'docente'});
  const resolved=await readableSignatureProfile(admin,profiles,diagnostics);
  const {data:acceptance,error:ae}=await admin.from('aceptaciones_horario_docente').select('id,ciclo_escolar,estado,firma_path,firma_sha256,aceptado_at').eq('docente_id',teacherId).order('aceptado_at',{ascending:false}).limit(10);
  if(ae && !/aceptaciones_horario_docente|schema cache|does not exist/i.test(ae.message||'')) throw ae;
  return {docente:t,perfil_encontrado:Boolean(resolved),perfil:resolved?{id:resolved.id,nombre_completo:resolved.nombre_completo,firma_path:resolved.firma_path,fuente:resolved.__signature_source||null}:null,diagnostico:diagnostics,aceptaciones:acceptance||[],mensaje:resolved?'Firma encontrada y legible por el generador PDF.':'No se encontró una firma legible. Revisa el diagnóstico; si indica WEBP, vuelve a registrar la firma como PNG.'};
}


async function dailyGradebookPdf(admin,snapshotId,req){
  const {data:snap,error:se}=await admin.from('bitacora_excel_diaria').select('*,docentes(id,nombre_completo,numero_empleado),grupo_materias(id,grupo_id,materia_id,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave)),periodos_escolares(id,nombre,ciclo_escolar)').eq('id',Number(snapshotId)).maybeSingle();
  if(se) throw se; if(!snap) throw Object.assign(new Error('Respaldo diario no encontrado.'),{status:404});
  const gm=snap.grupo_materias||{},g=gm.grupos||{},m=gm.materias||{},state=snap.snapshot||{},acts=Array.isArray(state.activities)?state.activities:[],activityScores=state.activityScores||{},weighted=state.weightedValues||{},rubric=state.rubric||{components:[],total:snap.ponderacion_total||0};
  const {data:students,error:stErr}=await admin.from('alumnos').select('id,nombre_completo,matricula').eq('grupo_id',gm.grupo_id).eq('activo',true).order('nombre_completo'); if(stErr) throw stErr;
  const {data:inst}=await admin.from('institucion_config').select('*').limit(1).maybeSingle(); const logo=await loadLogo(); const pdf=await PDFDocument.create(); const awaitEmbedLogo=async(bytes)=>{try{return await pdf.embedPng(bytes)}catch{return await pdf.embedJpg(bytes)}}; const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold); const W=792,H=612;
  const newPage=()=>{const page=pdf.addPage([W,H]);drawFloral(page,W,H);return page;}; const header=(page,title)=>{if(logo){try{const img=awaitEmbedLogo(pdf,logo);page.drawImage(img,{x:30,y:H-68,width:42,height:42});}catch{}}page.drawText(String(inst?.nombre_institucion||'INSTITUCIÓN EDUCATIVA').toUpperCase(),{x:82,y:H-35,size:11,font:bold,color:INK});page.drawText(`${String(inst?.siglas||'ITHLA').toUpperCase()} · ${title}`,{x:82,y:H-51,size:8.5,font:regular,color:GRAY});page.drawText(`Folio interno: ${snap.id} · ${snap.fecha_clase} · Versión ${snap.version}`,{x:30,y:H-82,size:7,font:regular,color:GRAY});};
  const table=(page,rows,widths,x,y,rowH=19,fs=6.4)=>{let yy=y;for(let ri=0;ri<rows.length;ri++){let xx=x;for(let ci=0;ci<widths.length;ci++){const w=widths[ci];rect(page,xx,yy-rowH,w,rowH,ri===0?GOLD_SOFT:CELL);drawCentered(page,regular,bold,String(rows[ri][ci]??'—'),xx+w/2,yy-rowH+(rowH-fs)/2,w-4,fs,ri===0);xx+=w;}yy-=rowH;}return yy;};
  // Página 1: asistencia
  let page=newPage();header(page,'BITÁCORA DIARIA · ASISTENCIAS');page.drawText(`${String(m.nombre||'Materia').toUpperCase()} · ${g.clave||'—'} · Docente: ${snap.docentes?.nombre_completo||'—'}`,{x:30,y:H-104,size:8.5,font:bold,color:INK});let dates=Object.keys(state.attendance||{}).map(k=>k.split('|')[1]).filter(Boolean);dates=[...new Set(dates)].sort();const head=['#','Alumno','Matrícula',...dates.slice(0,12)];const rows=[head];(students||[]).forEach((st,i)=>rows.push([String(i+1),short(st.nombre_completo,30),short(st.matricula,16),...dates.slice(0,12).map(dt=>state.attendance?.[`${st.id}|${dt}`]||'—')]));table(page,rows,[28,230,105,...dates.slice(0,12).map(()=>42)],30,H-125,20,5.8);page.drawText('Las asistencias históricas forman parte de la evidencia y no se pueden alterar desde una carga posterior.',{x:30,y:30,size:6.5,font:bold,color:GRAY});
  // Página 2: actividades
  page=newPage();header(page,'BITÁCORA DIARIA · ACTIVIDADES');page.drawText(`Actividades registradas: ${acts.length} · La ponderación NO se captura por actividad.`,{x:30,y:H-104,size:8,font:regular,color:GRAY});const visible=acts.slice(0,10);const ar=[['#','Alumno','Matrícula',...visible.map(a=>short(a.nombre,14))]];(students||[]).forEach((st,i)=>ar.push([String(i+1),short(st.nombre_completo,30),short(st.matricula,16),...visible.map(a=>{const v=activityScores[`${st.id}|${a.key}`];return v==null?'—':Number(v).toFixed(1)})]));table(page,ar,[28,230,105,...visible.map(()=>40)],30,H-125,20,5.4);if(acts.length>10)page.drawText(`Se muestran 10 actividades por página; el archivo original conserva las ${acts.length}.`,{x:30,y:30,size:6.5,font:regular,color:GRAY});
  // Página 3: valores de ponderación
  page=newPage();header(page,'BITÁCORA DIARIA · VALORES DE PONDERACIÓN');page.drawText(`Rúbrica: ${rubric.titulo||'Evaluación del periodo'} · Valor total: ${Number(rubric.total||0).toFixed(2)}% · Máximo: 10 puntos`,{x:30,y:H-104,size:8,font:regular,color:GRAY});const comps=(rubric.components||[]).slice(0,8);const vr=[['#','Alumno','Matrícula',...comps.map(c=>`${short(c.nombre,12)}\n${Number(c.ponderacion||0).toFixed(1)}%`),'VALOR TOTAL']];(students||[]).forEach((st,i)=>{let sum=0,wt=0;const vals=comps.map(c=>{const v=weighted[`${st.id}|${c.id}`];if(v!=null&&v!==''){sum+=Number(v)*Number(c.ponderacion||0);wt+=Number(c.ponderacion||0);return Number(v).toFixed(1)}return '—'});const total=wt?Number((sum/wt).toFixed(2)):'—';vr.push([String(i+1),short(st.nombre_completo,28),short(st.matricula,15),...vals,total]);});table(page,vr,[24,205,100,...comps.map(()=>43),58],30,H-125,24,5.1);let y=30;page.drawText(`Ponderación total oficial: ${Number(rubric.total||0).toFixed(2)}% · Valor máximo: 10 puntos`,{x:30,y,size:6.5,font:bold,color:GRAY});page.drawText(`SHA-256: ${short(snap.archivo_sha256||'no registrado',64)}`,{x:390,y,size:6.5,font:regular,color:GRAY});
  const bytes=await pdf.save();return {pdf_base64:Buffer.from(bytes).toString('base64'),filename:`JAGUAR-Bitacora-${safe(g.clave||'grupo')}-${safe(m.nombre||'materia')}-${snap.fecha_clase}-v${snap.version}.pdf`};
}

export default async function handler(req,res){try{if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});const {user,profile,adminClient}=await requireRoles(req,['direccion_escolar','control_escolar','control','servicios_docentes','servicios_estudiantiles','coordinacion_academica','docente','alumno']);const b=req.body||{};if(b.action==='daily_gradebook_pdf'){if(!['servicios_docentes','control_escolar','control','direccion_escolar','coordinacion_academica'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});return res.status(200).json({ok:true,...await dailyGradebookPdf(adminClient,Number(b.snapshot_id||0),req)});}if(b.action==='signature_diagnostics'){if(!['direccion_escolar','control_escolar','control','servicios_docentes','coordinacion_academica'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});return res.status(200).json({ok:true,data:await signatureDiagnostics(adminClient,b)});}if(b.action==='group_schedule'){if(!['direccion_escolar','control_escolar','control','coordinacion_academica','servicios_estudiantiles'].includes(profile.rol))return res.status(403).json({ok:false,error:'Este perfil no puede generar el horario de un grupo.'});const gid=Number(b.grupo_id||0);if(!gid)return res.status(400).json({ok:false,error:'Grupo no válido.'});return res.status(200).json({ok:true,...await groupSchedulePdf(adminClient,gid,req)});}if(b.action==='teacher_schedule'){if(profile.rol!=='docente')return res.status(403).json({ok:false,error:'Solo el docente puede descargar su horario.'});const {data:t}=await adminClient.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle();if(!t)return res.status(404).json({ok:false,error:'Docente no vinculado.'});return res.status(200).json({ok:true,...await teacherSchedulePdf(adminClient,t.id,req)});}if(b.action==='student_schedule'){if(profile.rol!=='alumno')return res.status(403).json({ok:false,error:'Solo el alumno puede descargar su horario.'});const {data:s}=await adminClient.from('alumnos').select('id').eq('auth_user_id',user.id).maybeSingle();if(!s)return res.status(404).json({ok:false,error:'Alumno no vinculado.'});return res.status(200).json({ok:true,...await studentSchedulePdf(adminClient,s.id,req)});}if(b.action==='student_boleta'){if(profile.rol!=='alumno')return res.status(403).json({ok:false,error:'Solo el alumno puede descargar su boleta.'});const {data:s}=await adminClient.from('alumnos').select('id').eq('auth_user_id',user.id).maybeSingle();if(!s)return res.status(404).json({ok:false,error:'Alumno no vinculado.'});return res.status(200).json({ok:true,...await boletaPdf(adminClient,s.id,req)});}if(b.action==='student_credential'){if(profile.rol!=='servicios_estudiantiles')return res.status(403).json({ok:false,error:'Solo Servicios Estudiantiles puede tramitar y generar credenciales.'});const alumnoId=Number(b.alumno_id||0);if(!alumnoId)return res.status(400).json({ok:false,error:'Alumno no válido.'});return res.status(200).json({ok:true,...await credentialPdf(adminClient,alumnoId,req)});}if(b.action==='student_boleta_admin'){if(!['control_escolar','control','direccion_escolar'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Control Escolar o Dirección puede generar la boleta de otro alumno.'});const alumnoId=Number(b.alumno_id||0);if(!alumnoId)return res.status(400).json({ok:false,error:'Alumno no válido.'});return res.status(200).json({ok:true,...await boletaPdf(adminClient,alumnoId,req)});}return res.status(400).json({ok:false,error:'Acción de PDF no reconocida.'});}catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'Error generando PDF.'});}}
