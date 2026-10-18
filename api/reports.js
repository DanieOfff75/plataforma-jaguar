import {sortInstitutionalPeople} from '../lib/institutional_names.js';
import {renderBoletaVisual15} from '../lib/boleta_visual15.js';
import {buildStudentCredentialPDF} from '../lib/credencial_escolar_pdf.js';
import {readCredentialPhoto,saveCredentialPhoto} from '../lib/credential_photo.js';
import {buildDailyGradebookPdf} from '../lib/jaguar_gradebook_pdf.js';
import {academicGradeDetail,allowGradeExplorer} from '../lib/academic_grade_explorer.js';
import {buildAcademicGradesPdf} from '../lib/academic_grade_report_pdf.js';
import {buildGradeBatchOfficePdf} from '../lib/grade_batch_office_pdf.js';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { requireRoles } from '../lib/_admin.js';
import { getInstitution } from './institution.js';
import { listResponsibleUsers } from '../lib/responsables.js';
import { registerVerifiableDocument, qrPng, deleteVerifiableDocument } from '../lib/documentos.js';

const days = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
const normalizeSubjectName=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const GREEN = rgb(0.105,0.212,0.365); // azul marino institucional
const GREEN2 = rgb(0.000,0.420,0.420); // teal
const PALE = rgb(0.945,0.957,0.969);
const PAPER = rgb(1,1,1);
const INK = rgb(0.102,0.145,0.204);
const GRAY = rgb(0.365,0.400,0.455);
const LINE = rgb(0.760,0.792,0.827);
const GOLD = rgb(0.831,0.686,0.247);
const GOLD_DARK = rgb(0.545,0.431,0.145);
const GOLD_SOFT = rgb(0.945,0.929,0.867);
const GOLD_CELL = rgb(0.976,0.969,0.933);
const CELL = rgb(0.965,0.973,0.984);

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
/** Marco editorial para horarios; respeta las mismas coordenadas del contenido. */
function drawJaguarScheduleChrome(page,W,H,theme={}){
  const primary=theme.primary||GREEN;
  page.drawRectangle({x:0,y:0,width:W,height:H,color:PAPER});
  page.drawRectangle({x:0,y:H-8,width:W,height:8,color:primary});
  page.drawRectangle({x:0,y:H-12,width:W,height:4,color:GOLD});
  page.drawRectangle({x:0,y:0,width:W,height:17,color:primary});
  page.drawRectangle({x:0,y:17,width:W,height:2,color:GOLD});
  // Una cenefa inferior tenue da identidad sin interferir con las tablas.
  for(let i=0;i<9;i++)page.drawLine({start:{x:20+i*94,y:29},end:{x:59+i*94,y:29},color:LINE,thickness:.45,opacity:.55});
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
  const motto=String(institution?.eslogan||institution?.slogan||institution?.lema||'').trim() || String(institution?.lema_traduccion||'').trim() || '';
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
  // Combina los módulos oficiales con cualquier sesión extraordinaria registrada.
  // Antes el PDF ignoraba las horas ajenas al turno predefinido.
  const real=(rows||[]).map(r=>`${String(r.hora_inicio||'').slice(0,5)}|${String(r.hora_fin||'').slice(0,5)}`)
    .filter(s=>/^\d{2}:\d{2}\|\d{2}:\d{2}$/.test(s));
  // Se dibujan solo intervalos reales; las clases extraordinarias conservan su hora.
  return [...new Set(real)].sort((a,b)=>a.localeCompare(b));
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
async function drawSignatureBox(page,pdf,admin,{x,y,w,h,label,profile,showName=true,missingText='FIRMA NO REGISTRADA',signatureImage=null,fontRegular=null,fontBold=null,accentColor=INK}){
  rect(page,x,y,w,h,rgb(1,1,1),LINE,.65);
  page.drawRectangle({x,y:y+h-2.5,width:w,height:2.5,color:GOLD});
  const title=String(label||'FIRMA').toUpperCase();
  const headingFont=fontBold||await pdf.embedFont(StandardFonts.HelveticaBold);
  const tf=fitText(headingFont,title,w-14,6.4,6.4,4.8);
  page.drawText(tf.text,{x:x+7,y:y+h-13,size:tf.size,font:headingFont,color:accentColor});
  const regular=fontRegular||await pdf.embedFont(StandardFonts.Helvetica);
  const sig=signatureImage || (profile?.firma_path?await loadSignatureImage(pdf,admin,profile.firma_path):null);
  if(sig){
    const iw=Math.min(w-18,110), ih=Math.min(h-28,32); const ratio=Math.min(iw/sig.image.width,ih/sig.image.height);
    page.drawImage(sig.image,{x:x+(w-sig.image.width*ratio)/2,y:y+22,width:sig.image.width*ratio,height:sig.image.height*ratio});
  } else {
    const italic=fontRegular||await pdf.embedFont(StandardFonts.HelveticaOblique);
    const nf=fitText(italic,missingText,w-18,5.8,5.8,4.6);
    page.drawText(nf.text,{x:x+(w-textWidth(italic,nf.text,nf.size))/2,y:y+28,size:nf.size,font:italic,color:GRAY});
  }
  page.drawLine({start:{x:x+10,y:y+17},end:{x:x+w-10,y:y+17},thickness:.55,color:GRAY});
  if(showName){
    const nm=profile?.nombre_completo||'';
    if(nm){const f=fitText(regular,nm,w-12,5.8,5.8,4.8);page.drawText(f.text,{x:x+(w-textWidth(regular,f.text,f.size))/2,y:y+6,size:f.size,font:regular,color:INK});}
  }
}

/**
 * Horarios PDF Jaguar V5.2. Los horarios del grupo/alumno utilizan los colores
 * oficiales registrados por materia; el horario del docente es deliberadamente
 * monocromático en dorado, sin importar los colores privados de sus materias.
 * La vista es carta horizontal/A4 apaisado y mantiene validación, QR y firmas.
 */
async function drawSchedulePdf({admin,student=null,teacher=null,group:groupInfo=null,rows=[],cycle,workshop='Sin taller asignado',req,verification}){
  const institution=await institutionForPdf(admin);
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [bookBytes,heavyBytes,logoBytes]=await Promise.all([
    readFile(new URL('../assets/fonts/Garet-Book.ttf',import.meta.url)),
    readFile(new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url)),
    loadLogo()
  ]);
  const book=await pdf.embedFont(bookBytes,{subset:true});
  const heavy=await pdf.embedFont(heavyBytes,{subset:true});
  const serif=await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic=await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const W=841.89,H=595.28,M=30,right=W-M;
  const teacherMode=Boolean(teacher);
  const primary=teacherMode?rgb(.41,.31,.105):GREEN;
  const accent=teacherMode?rgb(.72,.54,.17):GREEN2;
  const gold=GOLD;
  const soft=teacherMode?rgb(.985,.964,.907):rgb(.942,.961,.967);
  const white=rgb(1,1,1);
  const ink=INK;
  const muted=rgb(.38,.43,.48);
  const logo=logoBytes?await pdf.embedPng(logoBytes):null;
  const groupName=student?.grupos?.clave||groupInfo?.clave||'—';
  const docType=teacherMode?'DOCENTE':student?'ALUMNO':'GRUPO';
  const heading=teacherMode?'HORARIO DEL DOCENTE':student?'HORARIO DEL ALUMNO':'HORARIO DEL GRUPO';
  const year=String(cycle||'—');
  const qr=verification?.qrBytes?await pdf.embedPng(verification.qrBytes):null;
  const signBox=(page,options)=>drawSignatureBox(page,pdf,admin,{...options,fontRegular:book,fontBold:heavy,accentColor:primary});
  const normColor=(hex)=>/^#[0-9a-f]{6}$/i.test(String(hex||''))?hexToRgb(hex,accent):accent;
  const tint=(col,blend=.86)=>rgb(col.red*(1-blend)+blend,col.green*(1-blend)+blend,col.blue*(1-blend)+blend);
  const pdfSafe=s=>String(s??'—').replace(/[\r\n\t]+/g,' ').trim()||'—';
  function fit(font,raw,maxW,base=8,min=5){
    let t=pdfSafe(raw),size=base;
    while(size>min&&font.widthOfTextAtSize(t,size)>maxW)size-=.2;
    if(font.widthOfTextAtSize(t,size)>maxW){
      while(t.length>1&&font.widthOfTextAtSize(t+'…',size)>maxW)t=t.slice(0,-1);
      t=t+'…';
    }
    return {t,size};
  }
  function txt(page,raw,{x,y,width=240,font=book,size=8,min=5,color=ink,align='left'}={}){
    const a=fit(font,raw,width,size,min);
    let xx=x;
    if(align==='center')xx=x+(width-font.widthOfTextAtSize(a.t,a.size))/2;
    if(align==='right')xx=x+width-font.widthOfTextAtSize(a.t,a.size);
    page.drawText(a.t,{x:xx,y,size:a.size,font,color});
  }
  function basePage(kicker,title,sub=''){
    const page=pdf.addPage([W,H]);
    page.drawRectangle({x:0,y:0,width:W,height:H,color:white});
    page.drawRectangle({x:0,y:H-9,width:W,height:9,color:primary});
    page.drawRectangle({x:0,y:H-12,width:W,height:3,color:gold});
    page.drawRectangle({x:0,y:0,width:W,height:19,color:primary});
    page.drawRectangle({x:0,y:19,width:W,height:2,color:gold});
    if(logo)page.drawImage(logo,{x:32,y:H-84,width:65,height:67});
    page.drawLine({start:{x:110,y:H-85},end:{x:110,y:H-24},thickness:.7,color:gold});
    txt(page,institution.nombre_institucion||'INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO',{x:124,y:H-41,width:525,font:serif,size:15,min:10,color:primary});
    txt(page,institution.lema||institution.eslogan||institution.slogan||'Scientia, Humanitas et Progressum',{x:124,y:H-55,width:510,font:italic,size:9,min:7,color:GOLD_DARK});
    txt(page,`CCT ${institution.cct||'—'}  ·  ${institution.clave_rvoe||'—'}  ·  ${institution.entidad||'Estado de México'}`,{x:124,y:H-69,width:565,font:book,size:6.9,color:muted});
    txt(page,`CICLO ESCOLAR  ${year}`,{x:673,y:H-38,width:137,font:heavy,size:8,min:7,color:primary,align:'right'});
    txt(page,docType==='DOCENTE'?'FORMATO DOCENTE':'FORMATO ACADÉMICO',{x:673,y:H-55,width:137,font:book,size:7,color:muted,align:'right'});
    page.drawLine({start:{x:M,y:H-93},end:{x:right,y:H-93},color:LINE,thickness:.7});
    txt(page,kicker,{x:M,y:H-108,width:590,font:heavy,size:7.4,color:GOLD_DARK});
    txt(page,title,{x:M,y:H-136,width:690,font:serif,size:23,min:17,color:primary});
    if(sub)txt(page,sub,{x:M,y:H-150,width:755,font:book,size:7.7,color:muted});
    return page;
  }
  function strip(page,label,y,{color=primary}={}){
    page.drawRectangle({x:M,y,width:right-M,height:19,color});
    txt(page,label,{x:M+10,y:y+6,width:700,font:heavy,size:8.0,color:white});
  }
  function frame(page,x,y,w,h,{fill=white,border=LINE,bw=.65}={}){
    page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:border,borderWidth:bw});
  }
  function footer(page,index,total){
    txt(page,`${institution.siglas||'ITHLA'} · PLATAFORMA JAGUAR · HORARIOS ACADÉMICOS`,{x:M,y:6.5,width:370,font:book,size:6.0,color:white});
    txt(page,`FOLIO: ${verification?.row?.folio||'CONSULTA'}`,{x:405,y:6.5,width:290,font:book,size:5.7,min:4.4,color:white,align:'right'});
    txt(page,`${index} / ${total}`,{x:755,y:6.5,width:57,font:heavy,size:6.1,color:white,align:'right'});
  }
  function summary(page){
    let info;
    if(teacherMode)info=[
      ['DOCENTE',teacher.nombre_completo||'—',2.1],['NÚM. EMPLEADO',teacher.numero_empleado||'—',1],['ESPECIALIDAD',teacher.especialidad||'—',1.5],['CICLO',year,.9]
    ];
    else if(student)info=[
      ['ALUMNO',student.nombre_completo||'—',2.05],['MATRÍCULA',student.matricula||'—',1.2],['GRUPO',groupName,1],['TURNO',student.grupos?.turno||'—',1.1]
    ];
    else info=[
      ['GRUPO',groupName,1.3],['GRADO',groupInfo?.grado?`${groupInfo.grado}°`:'—',1],['TURNO',groupInfo?.turno||'—',1.3],['CICLO',year,1.3]
    ];
    const gap=7,y=398,h=37,totalW=right-M-gap*(info.length-1),sum=info.reduce((n,x)=>n+x[2],0);
    let x=M;
    for(const [label,value,weight] of info){
      const w=totalW*weight/sum;
      frame(page,x,y,w,h,{fill:soft,border:rgb(.83,.85,.86)});
      page.drawRectangle({x,y:y+h-3,width:w,height:3,color:gold});
      txt(page,label,{x:x+8,y:y+23,width:w-16,font:heavy,size:6.3,color:muted});
      txt(page,value,{x:x+8,y:y+8,width:w-16,font:heavy,size:9,min:6.7,color:ink});
      x+=w+gap;
    }
  }
  function groupedLesson(r){return r?.grupo_materias?.materias?.nombre||'Asignatura';}
  function dayLesson(r){return teacherMode?(r?.grupo_materias?.grupos?.clave||'Sin grupo'):(r?.docente?.nombre_completo||'Sin docente');}
  const subjectList=teacherMode?[]:uniqueSubjects(rows,false);
  const colorsBySubject=new Map();
  for(const item of rows||[]){
    const color=item.subject_color;
    if(/^#[0-9a-fA-F]{6}$/.test(String(color||'')))colorsBySubject.set(normalizeSubjectName(item.grupo_materias?.materias?.nombre),hexToRgb(color,accent));
  }
  const main=basePage('PLATAFORMA JAGUAR  /  ORGANIZACIÓN ACADÉMICA',heading,'Documento de consulta y validación institucional.');
  summary(main);
  const daysPdf=['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES'];
  const allSlots=getSlots(rows,student?.grupos?.turno||groupInfo?.turno||null);
  const slots=allSlots.length?allSlots:[];
  // 14 materias se muestran en la primera página; las demás continúan en anexos
  // antes de la página de firmas para evitar que desaparezcan silenciosamente.
  const chunkSize=13;
  const mainSubjects=subjectList.slice(0,chunkSize);
  let weekSectionY;
  if(!teacherMode){
    strip(main,'01  ·  ASIGNATURAS Y DOCENTES',368);
    const top=368,rowH=10.7,headH=16;
    const x0=M,x1=M+34,x2=M+448,x3=right;
    frame(main,x0,top-headH,x3-x0,headH,{fill:soft});
    txt(main,'N.º',{x:x0+6,y:top-11,width:20,font:heavy,size:6.6,color:primary});
    txt(main,'ASIGNATURA',{x:x1+8,y:top-11,width:x2-x1-15,font:heavy,size:6.7,color:primary});
    txt(main,'DOCENTE RESPONSABLE',{x:x2+8,y:top-11,width:x3-x2-15,font:heavy,size:6.7,color:primary});
    for(let i=0;i<mainSubjects.length;i++){
      const subj=mainSubjects[i],y=top-headH-(i+1)*rowH;
      frame(main,x0,y,x3-x0,rowH,{fill:i%2?white:rgb(.986,.989,.992),border:LINE,bw:.38});
      const c=colorsBySubject.get(normalizeSubjectName(subj.materia))||accent;
      main.drawRectangle({x:x0,y,width:3,height:rowH,color:c});
      txt(main,String(i+1).padStart(2,'0'),{x:x0+7,y:y+2.7,width:23,font:book,size:6.4,color:muted});
      txt(main,subj.materia,{x:x1+7,y:y+2.6,width:x2-x1-15,font:heavy,size:7.3,min:6,color:ink});
      txt(main,subj.docente,{x:x2+8,y:y+2.7,width:x3-x2-16,font:book,size:7.0,min:5.6,color:muted});
    }
    weekSectionY=top-headH-mainSubjects.length*rowH-25;
  }else{
    strip(main,'01  ·  HORARIO SEMANAL Y GRUPOS ASIGNADOS',366,{color:primary});
    weekSectionY=366;
  }

  // Cada materia se identifica por el color registrado en Jaguar. No se usan
  // colores de profesor en el horario docente: únicamente dorado institucional.
  function weeklyTable(page,list,barY,{compact=false}={}){
    strip(page,teacherMode?'HORARIO SEMANAL  ·  DOCENTE':'02  ·  DISTRIBUCIÓN SEMANAL',barY,{color:primary});
    const top=barY,hHead=22,tableBottom=53,available=top-hHead-tableBottom;
    const hRow=list.length?Math.min(teacherMode?45:31,available/list.length):33;
    const x0=M,tW=77,dW=(right-M-tW)/5;
    frame(page,x0,top-hHead,right-M,hHead,{fill:soft});
    txt(page,'HORA',{x:x0+8,y:top-14,width:tW-14,font:heavy,size:7.5,color:primary});
    daysPdf.forEach((d,idx)=>txt(page,d,{x:x0+tW+idx*dW,y:top-14,width:dW,font:heavy,size:7.4,color:primary,align:'center'}));
    if(!list.length){txt(page,'Sin clases asignadas para este ciclo escolar.',{x:M+12,y:top-48,width:500,font:book,size:10,color:muted});return;}
    list.forEach((slot,ri)=>{
      const [start,end]=slot.split('|');const y=top-hHead-(ri+1)*hRow;
      frame(page,x0,y,tW,hRow,{fill:soft,border:LINE,bw:.55});
      txt(page,`${start}–${end}`,{x:x0+4,y:y+hRow/2-2.5,width:tW-8,font:heavy,size:7.2,min:6.1,color:primary,align:'center'});
      for(let di=0;di<5;di++){
        const x=x0+tW+di*dW;
        const found=(rows||[]).filter(r=>Number(r.dia_semana)===di+1 && String(r.hora_inicio||'').slice(0,5)===start && String(r.hora_fin||'').slice(0,5)===end);
        const rec=found[0];
        if(!rec){frame(page,x,y,dW,hRow,{fill:white,border:LINE,bw:.55});continue;}
        const stripe=teacherMode?gold:normColor(rec.subject_color);
        const fill=teacherMode?rgb(.993,.981,.939):tint(stripe,.88);
        frame(page,x,y,dW,hRow,{fill,border:LINE,bw:.55});
        page.drawRectangle({x:x+.3,y:y+.4,width:3.5,height:hRow-.8,color:stripe});
        const label=groupedLesson(rec);
        txt(page,label,{x:x+8,y:y+hRow*.59,width:dW-13,font:heavy,size:hRow<25?7.0:8.3,min:6.3,color:ink,align:'center'});
        const note=teacherMode?`${dayLesson(rec)}${rec.aula?' · '+rec.aula:''}`:`${dayLesson(rec)}${rec.aula?' · '+rec.aula:''}`;
        txt(page,note,{x:x+7,y:y+hRow*.24,width:dW-11,font:book,size:hRow<25?5.8:6.4,min:5.2,color:muted,align:'center'});
        // Si existen sesiones simultáneas, evitar ocultarlas: señalar la cantidad.
        if(found.length>1)txt(page,`+${found.length-1} simultánea(s)`,{x:x+7,y:y+2.5,width:dW-12,font:book,size:5.3,min:5,color:GOLD_DARK,align:'right'});
      }
    });
  }
  // Usar las coordenadas según la cantidad real de materias y intervalos.
  // Para jornadas extraordinarias o una materia extensa se genera un anexo.
  const minWeeklyH=slots.length*20+22+53;
  const mainFits=weekSectionY>=minWeeklyH;
  if(mainFits)weeklyTable(main,slots,weekSectionY);
  else{
    strip(main,'02  ·  RESUMEN DE HORARIOS',weekSectionY);
    txt(main,'La tabla semanal completa continúa en la página siguiente para mantener legibles todas las clases.',{x:M+10,y:weekSectionY-30,width:740,font:book,size:9,color:muted});
  }
  const extraPages=[];
  // Continuación de asignaturas (si hay más de 13), sin omitir materias.
  if(subjectList.length>chunkSize){
    for(let offset=chunkSize;offset<subjectList.length;offset+=30){
      const extra=basePage('ANEXO ACADÉMICO  /  RELACIÓN COMPLETA','MATERIAS Y DOCENTES · CONTINUACIÓN',`Grupo ${groupName} · Ciclo ${year}`);
      const chunk=subjectList.slice(offset,offset+30);
      strip(extra,'ASIGNATURAS REGISTRADAS',432);
      const rowH=11.7;
      for(let i=0;i<chunk.length;i++){
        const sub=chunk[i],y=412-(i+1)*rowH;
        frame(extra,M,y,right-M,rowH,{fill:i%2?white:soft,border:LINE,bw:.4});
        const c=colorsBySubject.get(normalizeSubjectName(sub.materia))||accent;
        extra.drawRectangle({x:M,y,width:3,height:rowH,color:c});
        txt(extra,String(offset+i+1).padStart(2,'0'),{x:M+8,y:y+3,width:27,font:book,size:6.6});
        txt(extra,sub.materia,{x:M+50,y:y+3,width:360,font:heavy,size:7,min:5.9});
        txt(extra,sub.docente,{x:M+426,y:y+3,width:326,font:book,size:7,min:5.5,color:muted});
      }
      extraPages.push(extra);
    }
  }
  // La tabla completa tiene prioridad y se paginará si no cabe en la portada.
  if(!mainFits){
    const perPage=11;
    for(let offset=0;offset<slots.length;offset+=perPage){
      const ext=basePage('ANEXO ACADÉMICO  /  JORNADA COMPLETA','HORARIO SEMANAL · CONTINUACIÓN',`Ciclo ${year} · ${docType} ${teacherMode?teacher.nombre_completo:groupName}`);
      weeklyTable(ext,slots.slice(offset,offset+perPage),423);
      extraPages.push(ext);
    }
  }
  // No perder sesiones simultáneas: la retícula indica +N y el anexo
  // detalla cada materia, grupo, docente y aula involucrados en el conflicto.
  const slotGroups=new Map();
  for(const r of rows||[]){
    const key=`${r.dia_semana}|${String(r.hora_inicio||'').slice(0,5)}|${String(r.hora_fin||'').slice(0,5)}`;
    if(!slotGroups.has(key))slotGroups.set(key,[]);
    slotGroups.get(key).push(r);
  }
  const simultaneous=[...slotGroups.entries()].filter(([key,arr])=>arr.length>1).flatMap(([key,arr])=>arr.map(r=>({key,row:r})));
  for(let offset=0;offset<simultaneous.length;offset+=25){
    const ext=basePage('REVISIÓN ACADÉMICA  /  SESIONES SIMULTÁNEAS','DETALLE DE HORARIOS COINCIDENTES','El documento muestra todos los registros de clase, incluidos los superpuestos.');
    strip(ext,'SESIONES REGISTRADAS EN EL MISMO HORARIO',429);
    const part=simultaneous.slice(offset,offset+25);
    for(let i=0;i<part.length;i++){
      const r=part[i].row,dy=410-i*13.5;
      frame(ext,M,dy-10,right-M,13.5,{fill:i%2?white:soft,border:LINE,bw:.4});
      txt(ext,`${days[(Number(r.dia_semana)||1)-1]||'Día'} · ${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)}`,{x:M+9,y:dy-6,width:165,font:heavy,size:7.1,color:primary});
      txt(ext,groupedLesson(r),{x:M+180,y:dy-6,width:260,font:heavy,size:7.0});
      txt(ext,`${dayLesson(r)}${r.aula?' · '+r.aula:''}`,{x:M+450,y:dy-6,width:320,font:book,size:6.7,color:muted});
    }
    extraPages.push(ext);
  }
  // Página de validación: todas las firmas reales + QR, con el mismo lenguaje visual.
  const signPage=basePage('VALIDACIÓN INSTITUCIONAL  /  CONTROL DE FIRMAS','FIRMAS Y AUTORIZACIONES',`Ciclo ${year} · ${teacherMode?'Aceptación del horario docente':`Horario del ${student?'alumno':'grupo'} ${groupName}`}`);
  strip(signPage,'01  ·  AUTORIDADES RESPONSABLES',420);
  const authorities=teacherMode
    ? [['Servicios Docentes','servicios_docentes'],['Coordinación Académica','coordinacion_academica'],['Dirección Escolar','direccion_escolar']]
    : [['Servicios Estudiantiles','servicios_estudiantiles'],['Coordinación Académica','coordinacion_academica'],['Control Escolar','control_escolar'],['Dirección Escolar','direccion_escolar']];
  const ap=await Promise.all(authorities.map(async([label,role])=>[label,await profileSignatureByRole(admin,role)]));
  const aw=(right-M-7*(ap.length-1))/ap.length;
  for(const [i,[label,profile]] of ap.entries()){
    await signBox(signPage,{x:M+i*(aw+7),y:307,w:aw,h:97,label,profile});
  }
  const continuation=[];
  if(teacherMode){
    strip(signPage,'02  ·  ACEPTACIÓN DEL DOCENTE',280);
    const acceptance=await admin.from('aceptaciones_horario_docente').select('*').eq('docente_id',teacher.id).eq('ciclo_escolar',cycle).maybeSingle();
    let profile=null;
    if(acceptance?.data?.estado==='aceptado'&&acceptance.data?.firma_path){
      profile={id:teacher.auth_user_id||null,nombre_completo:teacher.nombre_completo,rol:'docente',firma_path:acceptance.data.firma_path,firma_sha256:acceptance.data.firma_sha256||null};
    }
    await signBox(signPage,{x:M,y:138,w:320,h:122,label:acceptance?.data?.estado==='aceptado'?'Horario aceptado':'Firma del docente',profile,showName:true,missingText:'PENDIENTE DE ACEPTACIÓN'});
    txt(signPage,acceptance?.data?.estado==='aceptado'?`Aceptado: ${acceptance.data.aceptado_at?new Date(acceptance.data.aceptado_at).toLocaleString('es-MX'):'Registro confirmado'}`:'El docente todavía no ha aceptado su horario.',{x:375,y:206,width:400,font:heavy,size:10,color:primary});
    txt(signPage,'La firma institucional se consulta desde el repositorio privado y respalda la aceptación del horario.',{x:375,y:185,width:400,font:book,size:8,color:muted});
  }else{
    strip(signPage,'02  ·  DOCENTES ASIGNADOS AL GRUPO',280);
    const teacherProfiles=[],seen=new Set();
    for(const r of rows||[]){
      const t=r.docente;if(!t)continue;
      const id=t.id||t.nombre_completo;
      if(seen.has(id))continue;seen.add(id);
      let profile=await profileSignatureByAuth(admin,t.auth_user_id,t.nombre_completo,'docente',t.correo);
      if(!profile?.firma_path){
        const acc=await admin.from('aceptaciones_horario_docente').select('firma_path,firma_sha256').eq('docente_id',t.id).eq('ciclo_escolar',cycle).eq('estado','aceptado').maybeSingle();
        if(acc.data?.firma_path)profile={id:t.auth_user_id||null,nombre_completo:t.nombre_completo,firma_path:acc.data.firma_path,firma_sha256:acc.data.firma_sha256||null};
      }
      teacherProfiles.push({name:t.nombre_completo,profile});
    }
    const perPage=11;
    for(const [i,t] of teacherProfiles.slice(0,perPage).entries()){
      const col=i%4,row=Math.floor(i/4),w=(right-M-18)/4;
      await signBox(signPage,{x:M+col*(w+6),y:206-row*75,w,h:67,label:t.name,profile:t.profile,showName:false});
    }
    for(let offset=perPage;offset<teacherProfiles.length;offset+=20){
      const ext=basePage('VALIDACIÓN INSTITUCIONAL  /  CONTINUACIÓN','FIRMAS DOCENTES · CONTINUACIÓN',`Horario del grupo ${groupName} · Ciclo ${year}`);
      strip(ext,'DOCENTES RESPONSABLES',433);
      const part=teacherProfiles.slice(offset,offset+20),w=(right-M-18)/4;
      for(let i=0;i<part.length;i++){
        const col=i%4,row=Math.floor(i/4),t=part[i];
        await signBox(ext,{x:M+col*(w+6),y:348-row*66,w,h:59,label:t.name,profile:t.profile,showName:false});
      }
      continuation.push(ext);
    }
  }
  if(qr){
    const x=right-96,y=43;
    frame(signPage,x-5,y-5,88,88,{fill:white,border:LINE,bw:.7});
    signPage.drawImage(qr,{x,y,width:78,height:78});
    txt(signPage,'VERIFICA TU DOCUMENTO',{x:right-245,y:59,width:135,font:heavy,size:7.0,color:primary,align:'right'});
    txt(signPage,'Escanea el código QR',{x:right-245,y:46,width:135,font:book,size:7,color:muted,align:'right'});
  }
  txt(signPage,'La verificación del documento se realiza mediante el folio y código QR. Las firmas digitales disponibles se incorporan desde Jaguar.',{x:M,y:55,width:540,font:book,size:7.3,min:6.3,color:muted});
  const count=pdf.getPageCount();
  pdf.getPages().forEach((page,index)=>footer(page,index+1,count));
  return {pdf_base64:Buffer.from(await pdf.save()).toString('base64')};
}

async function studentSchedulePdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const {data:s}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(!s)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const {data:rows,error}=await admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materia_id,grupo_materias!inner(id,grupo_id,materia_id,materias(nombre),grupos!inner(id,clave,turno)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',s.grupo_id).eq('ciclo_escolar',cycle).order('hora_inicio').order('dia_semana');
  if(error)throw error;
  const gmIds=[...new Set((rows||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){ const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,docentes(id,nombre_completo,auth_user_id)').in('grupo_materia_id',gmIds).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae; const amap=new Map((as||[]).map(a=>[String(a.grupo_materia_id),a.docentes])); for(const r of rows||[]){ if(amap.has(String(r.grupo_materia_id)))r.docente=amap.get(String(r.grupo_materia_id)); }}
  const teacherIds=[...new Set((rows||[]).map(r=>r.docente?.id).filter(Boolean))];
  let colorMap=new Map();
  if(teacherIds.length){const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('docente_id,materia_id,color_hex').in('docente_id',teacherIds);if(ce)throw ce;colorMap=new Map((colors||[]).map(c=>[`${c.docente_id}|${c.materia_id}`,c.color_hex]));}
  for(const r of rows||[]){const mid=r.grupo_materias?.materia_id;const tid=r.docente?.id;r.subject_color=colorMap.get(`${tid}|${mid}`)||'#D8B45A';}
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
  // Los horarios de docentes se presentan sólo en dorado institucional;
  // el color individual de cada asignatura no altera este PDF.
  const folio=`HDT-${cycle.replace(/[^0-9]/g,'')}-${String(t.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const institution=await institutionForPdf(admin);
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'horario_docente',titulo:'HORARIO DEL DOCENTE',created_by:null,req,payload:{alumno:{},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Docente',value:t.nombre_completo},{label:'No. empleado',value:t.numero_empleado||'—'},{label:'Ciclo escolar',value:cycle},...(rows||[]).slice(0,40).map(r=>({label:`${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)} · ${days[(Number(r.dia_semana)||1)-1]||''}`,value:`${r.grupo_materias?.materias?.nombre||'Materia'} · ${r.grupo_materias?.grupos?.clave||'—'}${r.aula?' · '+r.aula:''}`}))]}});
  try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const pdf=await drawSchedulePdf({admin,teacher:t,rows:rows||[],cycle,req,verification});return {...pdf,folio,filename:`ITHLA-Horario-Docente-${safe(t.numero_empleado||t.nombre_completo)}.pdf`};}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}

async function groupSchedulePdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const {data:g}=await admin.from('grupos').select('id,clave,grado,letra,turno').eq('id',id).maybeSingle();
  if(!g)throw Object.assign(new Error('Grupo no encontrado.'),{status:404});
  const {data:rows,error}=await admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materia_id,grupo_materias!inner(id,grupo_id,materia_id,materias(nombre),grupos!inner(id,clave,turno)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',id).eq('ciclo_escolar',cycle).order('hora_inicio').order('dia_semana');
  if(error)throw error;
  const gmIds=[...new Set((rows||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){ const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,docentes(id,nombre_completo,auth_user_id)').in('grupo_materia_id',gmIds).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae; const amap=new Map((as||[]).map(a=>[String(a.grupo_materia_id),a.docentes])); for(const r of rows||[]){ if(amap.has(String(r.grupo_materia_id)))r.docente=amap.get(String(r.grupo_materia_id)); }}
  const teacherIds=[...new Set((rows||[]).map(r=>r.docente?.id).filter(Boolean))];
  let colorMap=new Map();
  if(teacherIds.length){const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('docente_id,materia_id,color_hex').in('docente_id',teacherIds);if(ce)throw ce;colorMap=new Map((colors||[]).map(c=>[`${c.docente_id}|${c.materia_id}`,c.color_hex]));}
  for(const r of rows||[]){const mid=r.grupo_materias?.materia_id;const tid=r.docente?.id;r.subject_color=colorMap.get(`${tid}|${mid}`)||'#D8B45A';}
  const folio=`HGR-${cycle.replace(/[^0-9]/g,'')}-${String(g.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const institution=await institutionForPdf(admin);
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'horario_grupo',titulo:`HORARIO DEL GRUPO ${g.clave||''}`,created_by:null,req,payload:{institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Grupo',value:g.clave||'—'},{label:'Grado',value:g.grado?`${g.grado}°`:'—'},{label:'Turno',value:g.turno||'—'},{label:'Ciclo escolar',value:cycle},...(rows||[]).slice(0,40).map(r=>({label:`${String(r.hora_inicio||'').slice(0,5)}–${String(r.hora_fin||'').slice(0,5)} · ${days[(Number(r.dia_semana)||1)-1]||''}`,value:`${r.grupo_materias?.materias?.nombre||'Materia'} · ${r.docente?.nombre_completo||'Sin docente'}${r.aula?' · '+r.aula:''}`}))]}});
  try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const pdf=await drawSchedulePdf({admin,group:g,groupInfo:g,rows:rows||[],cycle,req,verification});return {...pdf,folio,filename:`ITHLA-Horario-Grupo-${safe(g.clave||id)}.pdf`};}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}


async function credentialPdf(admin,id,req=null){
  const institution=await institutionForPdf(admin);
  const {data:s,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,turno,grado_ingreso,activo,grupos(id,clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(error)throw error;
  if(!s||s.activo===false)throw Object.assign(new Error('Alumno no encontrado o inactivo.'),{status:404});
  const cycle=await activeCycle(admin);
  const paymentFolio=String(req?.body?.payment_folio||'').trim();
  if(!paymentFolio)throw Object.assign(new Error('Para generar la credencial ingresa el folio del ticket de pago.'),{status:400});
  const {data:payment,error:paymentError}=await admin.from('recursos_pagos').select('id,folio,importe,estado,alumno_id,cargo_id,ciclo_escolar,recursos_conceptos(codigo,nombre)').eq('folio',paymentFolio).eq('alumno_id',s.id).eq('estado','registrado').maybeSingle();
  if(paymentError)throw paymentError;
  if(!payment||payment.recursos_conceptos?.codigo!=='CREDENCIAL')throw Object.assign(new Error('El folio no corresponde a un pago registrado de CREDENCIAL para este alumno.'),{status:409});
  if(Number(payment.importe)<=0)throw Object.assign(new Error('El pago de credencial debe tener un importe válido.'),{status:409});
  if(payment.ciclo_escolar&&payment.ciclo_escolar!==cycle)throw Object.assign(new Error('El pago corresponde a un ciclo escolar distinto. Verifica con Recursos Monetarios.'),{status:409});
  if(payment.cargo_id){
    const {data:charge,error:ce}=await admin.from('recursos_cargos').select('id,importe,alumno_id').eq('id',payment.cargo_id).maybeSingle();
    if(ce)throw ce;
    if(!charge||Number(charge.alumno_id)!==Number(s.id))throw Object.assign(new Error('El cargo no pertenece a este alumno.'),{status:409});
    const {data:posted,error:pe}=await admin.from('recursos_pagos').select('importe').eq('cargo_id',charge.id).eq('estado','registrado');
    if(pe)throw pe;
    const sum=(posted||[]).reduce((acc,p)=>acc+Number(p.importe||0),0);
    if(sum+0.005<Number(charge.importe))throw Object.assign(new Error('El pago de credencial aún está incompleto.'),{status:409});
  }
  // No se permite usar un mismo comprobante dos veces para emitir una credencial.
  // Se conserva el folio de pago como clave consultable en datos_publicos.
  const {data:already,error:alreadyError}=await admin.from('documentos_verificables').select('id,folio').eq('tipo','credencial').eq('alumno_id',s.id).eq('estado','valido').contains('datos_publicos',{pago_folio:paymentFolio}).limit(1);
  if(alreadyError)throw alreadyError;
  const archivePath=`credenciales/${cycle.replace(/[^0-9]/g,'')}/${s.id}/${payment.id}.pdf`;
  if((already||[]).length){
    const {data:savedPdf,error:savedError}=await admin.storage.from('archivo-escolar').download(archivePath);
    if(savedError||!savedPdf)throw Object.assign(new Error('La credencial ya fue emitida, pero no se encontró el PDF de reimpresión. Solicita revisión en Control Escolar.'),{status:409});
    return {folio:already[0].folio,verification_url:null,pdf_base64:Buffer.from(await savedPdf.arrayBuffer()).toString('base64'),filename:`${institution.siglas||'ITHLA'}-Credencial-${safe(s.matricula)}.pdf`,reimpresion:true};
  }
  const photo=await readCredentialPhoto(admin,s.id,{required:true});
  const group=s.grupos?.clave||[s.grupos?.grado,s.grupos?.letra].filter(Boolean).join(' ')||'—';
  const grade=s.grupos?.grado||s.grado_ingreso||'—';
  const turn=s.grupos?.turno||s.turno||'—';
  const folio=`CRD-${cycle.replace(/[^0-9]/g,'')}-${String(s.id).padStart(6,'0')}-${Date.now().toString().slice(-5)}`;
  const payload={pago_folio:paymentFolio,alumno:{nombre:s.nombre_completo,matricula:s.matricula,grupo:group,grado:`${grade}°`,ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Turno',value:turn},{label:'Tipo',value:'Credencial escolar'}]};
  const verification=await registerVerifiableDocument(admin,{folio,tipo:'credencial',titulo:'CREDENCIAL ESCOLAR',alumno_id:s.id,req,payload});
  try{
    const qrBytes=await qrPng(verification.verificationUrl,{size:200});
    const pdf=await buildStudentCredentialPDF({institution,cycle,folio,photoBytes:photo,logoBytes:await loadLogo(),qrBytes,student:{name:s.nombre_completo,matricula:s.matricula,grade:`${grade}°`,group,turn}});
    const {error:storeError}=await admin.storage.from('archivo-escolar').upload(archivePath,pdf,{contentType:'application/pdf',cacheControl:'0',upsert:false});
    if(storeError)throw storeError;
    return {folio,verification_url:verification.verificationUrl,pdf_base64:pdf.toString('base64'),filename:`${institution.siglas||'ITHLA'}-Credencial-${safe(s.matricula||s.nombre_completo)}.pdf`};
  }catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
}

async function boletaPdf(admin,id,req=null){
  const cycle=await activeCycle(admin);
  const institution=await institutionForPdf(admin);
  const {data:s,error:se}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,turno,grupos(clave,grado,letra,turno)').eq('id',id).maybeSingle();
  if(se) throw se;
  if(!s) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});

  const [gradesQ,periodsQ,attendanceQ,incidentsQ,scheduleTeachersQ,groupSubjectsQ]=await Promise.all([
    admin.from('calificaciones').select('id,calificacion,periodo_id,docente_id,observaciones,periodos_escolares(id,nombre,ciclo_escolar),grupo_materias(id,materia_id,materias(id,nombre),grupos(id,clave,grado,letra,turno))').eq('alumno_id',id).order('grupo_materia_id').order('periodo_id'),
    admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,numero_periodo,es_periodo_actual').eq('ciclo_escolar',cycle).order('numero_periodo',{ascending:true}).order('id',{ascending:true}),
    admin.from('asistencias').select('id,fecha,estado,observaciones,grupo_materia_id').eq('alumno_id',id).order('fecha',{ascending:true}).limit(5000),
    admin.from('incidencias_prefectura').select('id,tipo,titulo,descripcion,fecha,estado,observaciones').eq('alumno_id',id).order('fecha',{ascending:false}).limit(500),
    admin.from('horarios').select('grupo_materias!inner(id,grupo_id,materia_id,materias(id,nombre)),docente:docentes(id,nombre_completo,correo,auth_user_id)').eq('grupo_materias.grupo_id',s.grupo_id).eq('ciclo_escolar',cycle),
    admin.from('grupo_materias').select('id,grupo_id,materia_id,materias(id,nombre)').eq('grupo_id',s.grupo_id)
  ]);
  for(const q of [gradesQ,periodsQ,attendanceQ,incidentsQ,scheduleTeachersQ,groupSubjectsQ]) if(q.error) throw q.error;

  let workshopName='Sin taller asignado';
  try{const {data:ws}=await admin.from('inscripciones_talleres').select('talleres(nombre),estado,ciclo_escolar').eq('alumno_id',id).eq('estado','inscrito').order('id',{ascending:false}).limit(1).maybeSingle();if(ws?.talleres?.nombre)workshopName=ws.talleres.nombre;}catch{}
  let departmentSigners=[];
  try{
    const {data:deps,error:de}=await admin.from('departamentos').select('id,clave,nombre,activo').eq('activo',true).order('nombre',{ascending:true});
    if(!de) for(const dep of deps||[]){
      let responsible=[];try{responsible=await listResponsibleUsers(admin,dep.clave);}catch{}
      const r=responsible[0]||null;
      departmentSigners.push({name:dep.nombre||dep.clave||'Departamento',profile:r?.perfil||r||null,department:dep});
    }
  }catch{}
  // Sin departamentos configurados no se imprimen firmas departamentales ficticias.
  let periods=(periodsQ.data||[]).filter(p=>p.ciclo_escolar===cycle);
  if(!periods.length){
    const seen=new Map();
    for(const g of gradesQ.data||[]){if(g.periodos_escolares?.ciclo_escolar!==cycle)continue;const p=g.periodos_escolares;if(!seen.has(p.id))seen.set(p.id,p);}
    periods=[...seen.values()].sort((a,b)=>Number(a.id)-Number(b.id));
  }
  periods=periods.sort((a,b)=>Number(a.numero_periodo||0)-Number(b.numero_periodo||0)||Number(a.id)-Number(b.id));
  const periodLabels=periods.map((p,i)=>({id:p.id,label:`P${Number(p.numero_periodo||i+1)}`,fullLabel:((p.nombre||'').trim()||['1.er periodo','2.º periodo','3.er periodo'][i]||`Periodo ${i+1}`)}));
  const periodIndex=new Map(periodLabels.filter(p=>p.id!=null).map((p,i)=>[String(p.id),i]));

  const subjectMap=new Map();
  // Registrar todas las materias oficiales del grupo, incluso sin nota.
  // La versión anterior omitía Artes explícitamente y además ocultaba materias
  // que aún no tenían una fila en calificaciones.
  for(const gm of groupSubjectsQ.data||[]){
    const name=String(gm.materias?.nombre||'Materia');
    if(/lengua\s+ind[ií]gena/i.test(name))continue; // Exclusión histórica aprobada para el formato.
    if(!subjectMap.has(String(gm.materia_id)))subjectMap.set(String(gm.materia_id),{
      materia_id:gm.materia_id,name,grades:{},teachers:new Set(),gradeTeachersFromGroup:new Set(),observations:[]
    });
  }
  for(const g of gradesQ.data||[]){
    if(g.periodos_escolares?.ciclo_escolar!==cycle) continue;
    const sid=g.grupo_materias?.materia_id||g.grupo_materia_id;
    const name=g.grupo_materias?.materias?.nombre||'Materia';
    // Reglas del formato aprobado: estas áreas no se imprimen en la boleta oficial.
    if(/lengua\s+ind[ií]gena/i.test(String(name))) continue;
    if(!subjectMap.has(String(sid))) subjectMap.set(String(sid),{materia_id:sid,name,grades:{},teachers:new Set(),gradeTeachersFromGroup:new Set(),observations:[]});
    const x=subjectMap.get(String(sid));
    const pi=periodIndex.get(String(g.periodo_id));
    if(pi!==undefined) x.grades[pi]=(g.calificacion!==null&&g.calificacion!==''&&Number.isFinite(Number(g.calificacion)))?Number(g.calificacion):null;
    // Una nota de recursamiento puede haberla capturado otro docente: no lo hace titular del grupo.
    if(g.docente_id&&String(g.grupo_materias?.grupos?.id)===String(s.grupo_id)) x.gradeTeachersFromGroup.add(String(g.docente_id));
    if(g.observaciones) x.observations.push(String(g.observaciones));
  }
  // Los docentes oficiales proceden del horario del grupo y las materias de esta boleta.
  // Un docente que sólo participó en una recuperación no debe aparecer por esa calificación.
  const assignedTeachersBySubject=new Map();
  for(const row of scheduleTeachersQ.data||[]){
    const gm=row.grupo_materias;
    const mid=gm?.materia_id;
    const tid=row.docente?.id;
    if(!mid||!tid||String(gm.grupo_id)!==String(s.grupo_id)||!subjectMap.has(String(mid)))continue;
    if(!assignedTeachersBySubject.has(String(mid)))assignedTeachersBySubject.set(String(mid),new Set());
    assignedTeachersBySubject.get(String(mid)).add(String(tid));
  }
  for(const x of subjectMap.values()){
    // Sólo si no hay horario para esta materia se usa la evidencia del propio grupo.
    x.teachers=assignedTeachersBySubject.get(String(x.materia_id))||x.gradeTeachersFromGroup;
  }
  const teacherIds=[...new Set([...subjectMap.values()].flatMap(x=>[...x.teachers]))];
  let teacherNames=new Map();
  if(teacherIds.length){
    const {data:ts,error:te}=await admin.from('docentes').select('id,nombre_completo,correo,auth_user_id').in('id',teacherIds);
    if(te)throw te; teacherNames=new Map((ts||[]).map(t=>[String(t.id),t.nombre_completo]));
  }
  const subjects=[...subjectMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));
  if(subjects.length>10)throw Object.assign(new Error('El grupo tiene más de 10 materias oficiales; revisa las asignaciones antes de emitir una boleta incompleta.'),{status:409});
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

  const verification=await registerVerifiableDocument(admin,{folio,tipo:'boleta',titulo:'BOLETA DE CALIFICACIONES',alumno_id:s.id,req,payload:{alumno:{nombre:s.nombre_completo,matricula:s.matricula,grupo:s.grupos?.clave,grado:s.grupos?.grado?`${s.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion,lema:institution.lema||institution.lema_traduccion||''},taller:workshopName,detalle:subjects.slice(0,40).map(x=>({label:x.name,value:`${periodLabels.map((_,i)=>x.grades[i]==null?'—':Number(x.grades[i]).toFixed(1)).join(' · ')} · Promedio ${x.avg==null?'—':x.avg.toFixed(2)}`}))}});
  let verificationQr=null;
  try{verificationQr=await qrPng(verification.verificationUrl,{size:180});}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}

  // La estética es ahora el HTML exacto convertido una sola vez en fondo PDF.
  // Datos, QR y firmas se colocan sobre posiciones calculadas desde ese HTML.
  const teacherData=new Map();
  if(teacherIds.length){
    const {data:rows,error}=await admin.from('docentes').select('id,nombre_completo,correo,auth_user_id').in('id',teacherIds);
    if(error)throw error;
    for(const row of rows||[])teacherData.set(String(row.id),row);
  }
  const teacherProfiles=[];
  for(const tid of teacherIds){
    const t=teacherData.get(String(tid));
    let prof=await profileSignatureByAuth(admin,t?.auth_user_id,t?.nombre_completo||teacherNames.get(String(tid)),'docente',t?.correo);
    if(!prof?.firma_path){
      const acc=await admin.from('aceptaciones_horario_docente').select('firma_path,firma_sha256,aceptado_at').eq('docente_id',tid).eq('estado','aceptado').order('aceptado_at',{ascending:false}).limit(1).maybeSingle();
      if(acc.data?.firma_path)prof={id:t?.auth_user_id||null,nombre_completo:t?.nombre_completo||teacherNames.get(String(tid))||'Docente',rol:'docente',firma_path:acc.data.firma_path,firma_sha256:acc.data.firma_sha256||null};
    }
    const related=subjects.filter(x=>x.teachers.has(String(tid))).map(x=>x.name);
    if(!related.length)continue; // Nunca imprimir 'Asignatura asignada' ni perfiles ajenos al grupo.
    teacherProfiles.push({name:t?.nombre_completo||teacherNames.get(String(tid))||'Docente',profile:prof,subject:related.join(', ')});
  }
  let bytes;
  try{bytes=await renderBoletaVisual15({
    institution,cycle,student:{...s,workshop:workshopName},subjects,periodLabels,
    teachers:teacherProfiles,departments:departmentSigners,folio,qrBytes:verificationQr,
    attendanceFaltas:attCounts.falta,overall,failed,observations,
    loadSignature:(pdf,path)=>loadSignatureImage(pdf,admin,path)
  });}catch(e){await deleteVerifiableDocument(admin,verification.id);throw e;}
  return {pdf_base64:Buffer.from(bytes).toString('base64'),filename:`${institution.siglas||'ITHLA'}-Boleta-${safe(s.matricula||s.nombre_completo)}.pdf`};
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
  const {data:inst}=await admin.from('institucion_config').select('*').limit(1).maybeSingle();
  const bytes=await buildDailyGradebookPdf({
    institution:inst||{},snapshot:snap,group:g,subject:m,teacher:snap.docentes||{},students:sortInstitutionalPeople(students||[]),state
  });
  return {pdf_base64:Buffer.from(bytes).toString('base64'),filename:`JAGUAR-Bitacora-${safe(g.clave||'grupo')}-${safe(m.nombre||'materia')}-${snap.fecha_clase}-v${snap.version}.pdf`};
}

export default async function handler(req,res){try{if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});const {user,profile,adminClient}=await requireRoles(req,['direccion_escolar','control_escolar','control','servicios_docentes','servicios_estudiantiles','coordinacion_academica','docente','alumno']);const b=req.body||{};
  if(b.action==='grade_batch_office_pdf'){
    const revisionId=Number(b.revision_id||0);
    if(!Number.isSafeInteger(revisionId)||revisionId<1)return res.status(400).json({ok:false,error:'Selecciona un oficio válido.'});
    const {data:rev,error:re}=await adminClient.from('jaguar_cargas_materias')
      .select('id,carga_id,grupo_materia_id,docente_id,estado,notas_originales,notas_finales,firma_docente_path')
      .eq('id',revisionId).maybeSingle();
    if(re)throw re;if(!rev)return res.status(404).json({ok:false,error:'Oficio no encontrado.'});
    if(profile.rol==='docente'){
      const {data:t,error:te}=await adminClient.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle();
      if(te)throw te;
      if(Number(t?.id)!==Number(rev.docente_id))return res.status(403).json({ok:false,error:'Este oficio no corresponde a tu materia.'});
    }else if(!allowGradeExplorer(profile.rol))return res.status(403).json({ok:false,error:'No autorizado para ver este oficio.'});
    const [bq,gmq,tq]=await Promise.all([
      adminClient.from('jaguar_cargas_grupo').select('id,grupo_id,periodo_id,actor_nombre,actor_rol,firma_departamento_path,creado_at').eq('id',rev.carga_id).maybeSingle(),
      adminClient.from('grupo_materias').select('id,grupo_id,materias(nombre),grupos(clave)').eq('id',rev.grupo_materia_id).maybeSingle(),
      adminClient.from('docentes').select('id,nombre_completo').eq('id',rev.docente_id).maybeSingle()
    ]);
    for(const q of [bq,gmq,tq])if(q.error)throw q.error;
    const [studentsQ,periodQ]=await Promise.all([
      adminClient.from('alumnos').select('id,matricula,nombre_completo').eq('grupo_id',bq.data.grupo_id).limit(500),
      adminClient.from('periodos_escolares').select('id,nombre').eq('id',bq.data.periodo_id).maybeSingle()
    ]);
    if(studentsQ.error)throw studentsQ.error;if(periodQ.error)throw periodQ.error;
    const bytes=await buildGradeBatchOfficePdf({revision:rev,batch:{...bq.data,periodo:periodQ.data?.nombre},
      subject:{nombre:gmq.data?.materias?.nombre,grupo:gmq.data?.grupos?.clave},teacher:tq.data,students:studentsQ.data,
      logoBytes:await loadLogo(),loadSignature:(pdf,path)=>loadSignatureImage(pdf,adminClient,path)});
    return res.status(200).json({ok:true,pdf_base64:Buffer.from(bytes).toString('base64'),filename:`ITHLA-Oficio-Revision-${revisionId}.pdf`});
  }
  if(b.action==='academic_grades_pdf'){
    if(!allowGradeExplorer(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});
    const details=await academicGradeDetail(adminClient,profile.rol,b);
    // La firma del docente corresponde al responsable de la materia, no al usuario que descargó.
    const {data:assigned,error:asErr}=await adminClient.from('asignaciones_docentes')
      .select('docente_id,docentes(id,nombre_completo,correo,auth_user_id)')
      .eq('grupo_materia_id',Number(b.grupo_materia_id)).eq('ciclo_escolar',details.periodo.ciclo_escolar)
      .eq('activo',true).order('id',{ascending:false}).limit(1);
    if(asErr)throw asErr;
    const teacher=assigned?.[0]?.docentes||null;
    const teacherProfile=teacher?await profileSignatureByAuth(adminClient,teacher.auth_user_id,teacher.nombre_completo,'docente',teacher.correo):null;
    let deptSigner=null, approvedSigner=null;
    // Sólo un oficio institucional realmente aceptado sirve como prueba de autoría.
    try{
      const {data:accepted,error:qe}=await adminClient.from('jaguar_cargas_materias')
        .select('id,firma_docente_path,firmado_at,jaguar_cargas_grupo!inner(actor_nombre,actor_rol,firma_departamento_path,grupo_id,periodo_id)')
        .eq('grupo_materia_id',Number(b.grupo_materia_id)).eq('estado','aceptada')
        .eq('jaguar_cargas_grupo.grupo_id',Number(b.grupo_id))
        .eq('jaguar_cargas_grupo.periodo_id',Number(b.periodo_id))
        .order('id',{ascending:false}).limit(1);
      if(!qe&&accepted?.length){
        const approved=accepted[0],issuer=approved.jaguar_cargas_grupo;
        deptSigner={name:issuer.actor_nombre,status:`Carga institucional · ${String(issuer.actor_rol).replaceAll('_',' ')}`,path:issuer.firma_departamento_path};
        approvedSigner=approved.firma_docente_path||null;
      }
    }catch{/* Una base sin la nueva migración aún debe poder emitir reportes tradicionales. */}
    const signers={
      department:deptSigner,
      teacher:{name:teacher?.nombre_completo||'Docente pendiente de asignar',
        status:approvedSigner?'Evaluación aceptada y firmada':deptSigner?'Pendiente de firma':'Espacio para firma docente',
        path:approvedSigner||(!deptSigner?teacherProfile?.firma_path:null)}
    };
    const logoBytes=await loadLogo();
    const bytes=await buildAcademicGradesPdf(details,{signatures:signers,logoBytes,
      loadSignature:(pdf,path)=>loadSignatureImage(pdf,adminClient,path)});
    const safeFile=(s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,65);
    return res.status(200).json({ok:true,pdf_base64:Buffer.from(bytes).toString('base64'),filename:`ITHLA-Calificaciones-${safeFile(details.grupo?.clave)}-${safeFile(details.periodo?.nombre)}-${safeFile(details.materia?.nombre)}.pdf`});
  }
  if(b.action==='daily_gradebook_pdf'){if(!['servicios_docentes','control_escolar','control','direccion_escolar','coordinacion_academica'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});return res.status(200).json({ok:true,...await dailyGradebookPdf(adminClient,Number(b.snapshot_id||0),req)});}if(b.action==='signature_diagnostics'){if(!['direccion_escolar','control_escolar','control','servicios_docentes','coordinacion_academica'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});return res.status(200).json({ok:true,data:await signatureDiagnostics(adminClient,b)});}if(b.action==='group_schedule'){if(!['direccion_escolar','control_escolar','control','coordinacion_academica','servicios_estudiantiles'].includes(profile.rol))return res.status(403).json({ok:false,error:'Este perfil no puede generar el horario de un grupo.'});const gid=Number(b.grupo_id||0);if(!gid)return res.status(400).json({ok:false,error:'Grupo no válido.'});return res.status(200).json({ok:true,...await groupSchedulePdf(adminClient,gid,req)});}if(b.action==='teacher_schedule'){if(profile.rol!=='docente')return res.status(403).json({ok:false,error:'Solo el docente puede descargar su horario.'});const {data:t}=await adminClient.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle();if(!t)return res.status(404).json({ok:false,error:'Docente no vinculado.'});return res.status(200).json({ok:true,...await teacherSchedulePdf(adminClient,t.id,req)});}if(b.action==='student_schedule'){if(profile.rol!=='alumno')return res.status(403).json({ok:false,error:'Solo el alumno puede descargar su horario.'});const {data:s}=await adminClient.from('alumnos').select('id').eq('auth_user_id',user.id).maybeSingle();if(!s)return res.status(404).json({ok:false,error:'Alumno no vinculado.'});return res.status(200).json({ok:true,...await studentSchedulePdf(adminClient,s.id,req)});}if(b.action==='student_boleta'){if(profile.rol!=='alumno')return res.status(403).json({ok:false,error:'Solo el alumno puede descargar su boleta.'});const {data:s}=await adminClient.from('alumnos').select('id').eq('auth_user_id',user.id).maybeSingle();if(!s)return res.status(404).json({ok:false,error:'Alumno no vinculado.'});return res.status(200).json({ok:true,...await boletaPdf(adminClient,s.id,req)});}if(b.action==='student_credential_photo_status'||b.action==='student_credential_photo_upload'){
  if(profile.rol!=='servicios_estudiantiles')return res.status(403).json({ok:false,error:'Solo Servicios Estudiantiles puede gestionar fotografías de credenciales.'});
  const alumnoId=Number(b.alumno_id||0);
  if(!Number.isSafeInteger(alumnoId)||alumnoId<=0)return res.status(400).json({ok:false,error:'Alumno no válido.'});
  const {data:student,error:se}=await adminClient.from('alumnos').select('id,activo').eq('id',alumnoId).maybeSingle();
  if(se)throw se;
  if(!student||student.activo===false)return res.status(404).json({ok:false,error:'Alumno no encontrado o inactivo.'});
  if(b.action==='student_credential_photo_upload'){
    const uploaded=await saveCredentialPhoto(adminClient,alumnoId,b.photo_base64);
    return res.status(200).json({ok:true,data:{registered:true,bytes:uploaded.bytes}});
  }
  const photo=await readCredentialPhoto(adminClient,alumnoId);
  return res.status(200).json({ok:true,data:{registered:!!photo,photo_base64:photo?photo.toString('base64'):null}});
}if(b.action==='student_credential'){if(profile.rol!=='servicios_estudiantiles')return res.status(403).json({ok:false,error:'Solo Servicios Estudiantiles puede tramitar y generar credenciales.'});const alumnoId=Number(b.alumno_id||0);if(!alumnoId)return res.status(400).json({ok:false,error:'Alumno no válido.'});return res.status(200).json({ok:true,...await credentialPdf(adminClient,alumnoId,req)});}if(b.action==='student_boleta_admin'){if(!['control_escolar','control','direccion_escolar'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Control Escolar o Dirección puede generar la boleta de otro alumno.'});const alumnoId=Number(b.alumno_id||0);if(!alumnoId)return res.status(400).json({ok:false,error:'Alumno no válido.'});return res.status(200).json({ok:true,...await boletaPdf(adminClient,alumnoId,req)});}return res.status(400).json({ok:false,error:'Acción de PDF no reconocida.'});}catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'Error generando PDF.'});}}
