import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { requireControl } from '../lib/_admin.js';
import { validateResponsible, listResponsibleUsers } from './responsables.js';
import { getInstitution } from './institution.js';
import { registerVerifiableDocument, qrPng, deleteVerifiableDocument } from './documentos.js';
import { audit } from '../lib/audit.js';

function safe(v){ return String(v ?? '').replace(/\s+/g,' ').trim(); }
function fmtDate(v){
  if(!v) return new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  const d=new Date(v+'T00:00:00');
  return d.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
}
function wrap(text,max=88){
  const words=safe(text).split(' '); const lines=[]; let line='';
  for(const w of words){
    if((line+' '+w).trim().length>max){ if(line) lines.push(line); line=w; }
    else line=(line+' '+w).trim();
  }
  if(line) lines.push(line);
  return lines.length?lines:[''];
}
function fit(text,max){
  const v=safe(text); return v.length<=max?v:`${v.slice(0,Math.max(1,max-1))}…`;
}
function short(text,max=88){
  const v=safe(text); return v.length<=max?v:`${v.slice(0,Math.max(1,max-1))}…`;
}
const GREEN=rgb(27/255,54/255,93/255);
const GREEN2=rgb(0,128/255,128/255);
const RED=rgb(.62,.035,.16);
const GOLD=rgb(212/255,175/255,55/255);
const GOLD_SOFT=rgb(248/255,244/255,228/255);
const INK=rgb(44/255,62/255,80/255);
const GRAY=rgb(.38,.43,.42);
const PAPER=rgb(.995,.993,.97);

async function loadLogo(pdf){
  try{
    const bytes=await readFile(new URL('../assets/ithla-logo.png',import.meta.url));
    return await pdf.embedPng(bytes);
  }catch{return null;}
}

async function loadSignatureImage(pdf,admin,path){
  if(!path||typeof path!=='string'||!path.trim()) return null;
  const clean=path.trim().replace(/^\/+/, '');
  const candidates=[clean,clean.replace(/^firmas-institucionales\//,'')];
  for(const candidate of [...new Set(candidates)]){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const storage=admin.storage.from('firmas-institucionales');
        let {data,error}=await storage.download(candidate);
        if(error||!data){
          const signed=await storage.createSignedUrl(candidate,300);
          if(!signed?.error&&signed?.data?.signedUrl){
            const response=await fetch(signed.data.signedUrl);
            if(response.ok){
              const bytes=Buffer.from(await response.arrayBuffer());
              try{return await pdf.embedPng(bytes);}catch{return await pdf.embedJpg(bytes);}
            }
          }
          continue;
        }
        const bytes=Buffer.from(await data.arrayBuffer());
        try{return await pdf.embedPng(bytes);}catch{return await pdf.embedJpg(bytes);}
      }catch{}
    }
  }
  return null;
}

async function issuerProfile(admin,user){
  if(!user?.id) return null;
  const {data}=await admin.from('perfiles').select('id,nombre_completo,rol,firma_path,firma_sha256,correo_auth').eq('id',user.id).maybeSingle();
  return data||null;
}

function header(page,{title,folio,date}){
  const W=612,H=792;
  page.drawRectangle({x:0,y:0,width:W,height:H,color:PAPER});
  page.drawRectangle({x:0,y:H-16,width:W,height:16,color:GREEN});
  page.drawRectangle({x:0,y:H-21,width:W,height:5,color:GOLD});
  page.drawRectangle({x:22,y:22,width:W-44,height:H-44,borderColor:GOLD,borderWidth:1.15});
  page.drawRectangle({x:28,y:28,width:W-56,height:H-56,borderColor:rgb(.87,.88,.84),borderWidth:.45});
  return {W,H};
}

function drawWatermark(page,logo,W,H){
  if(!logo)return;
  const size=235;
  page.drawImage(logo,{x:(W-size)/2,y:(H-size)/2+5,width:size,height:size,opacity:.075});
}

function drawField(page,{x,y,label,value,width=160,bold,regular}){
  page.drawText(String(label||'').toUpperCase(),{x,y,size:6.2,font:bold,color:GRAY});
  page.drawText(fit(value||'—',Math.max(12,Math.floor(width/6))),{x,y:y-13,size:9,font:bold,color:INK});
}

async function drawInstitutionHeader(page,pdf,{title,folio,date,institution}){
  const {W,H}=header(page,{title,folio,date});
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const logo=await loadLogo(pdf);
  drawWatermark(page,logo,W,H);

  if(logo) page.drawImage(logo,{x:45,y:H-103,width:50,height:53});
  page.drawText(institution?.siglas||'ITHLA',{x:108,y:H-55,size:16,font:bold,color:GREEN});
  page.drawText(institution?.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',{x:108,y:H-70,size:7.7,font:bold,color:INK});
  page.drawText(`CCT ${institution?.cct||'—'}  ·  Zona ${institution?.zona_escolar||'—'}  ·  Sector ${institution?.sector||'—'}`,{x:108,y:H-82,size:5.7,font:regular,color:GRAY});
  page.drawText(short(institution?.direccion||'—',78),{x:108,y:H-93,size:5.4,font:regular,color:GRAY});
  page.drawText('DOCUMENTO OFICIAL · CONTROL ESCOLAR',{x:108,y:H-104,size:6.1,font:bold,color:RED});

  const right=565;
  const titleText=String(title||'');
  const folioText=`FOLIO  ${folio||'—'}`;
  const dateText=String(date||'');
  page.drawText(titleText,{x:right-bold.widthOfTextAtSize(titleText,8),y:H-57,size:8,font:bold,color:RED});
  page.drawText(folioText,{x:right-regular.widthOfTextAtSize(folioText,7.5),y:H-72,size:7.5,font:regular,color:GRAY});
  page.drawText(dateText,{x:right-regular.widthOfTextAtSize(dateText,7.5),y:H-86,size:7.5,font:regular,color:GRAY});
  page.drawLine({start:{x:45,y:H-121},end:{x:W-45,y:H-121},color:GOLD,thickness:1.1});
  return {W,H,bold,regular,logo};
}

async function drawSignature(page,pdf,admin,profile,{x,y,w=190,role='Responsable institucional'}){
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const sig=await loadSignatureImage(pdf,admin,profile?.firma_path);
  if(sig) page.drawImage(sig,{x:x+25,y:y+25,width:w-50,height:42,opacity:.94});
  page.drawLine({start:{x,y:y+18},end:{x:x+w,y:y+18},color:GRAY,thickness:.75});
  const name=profile?.nombre_completo||profile?.nombre_responsable||'FIRMA NO REGISTRADA';
  page.drawText(fit(name,28),{x:x+4,y:y+5,size:7.2,font:bold,color:INK});
  page.drawText(fit(role||profile?.cargo||'Responsable institucional',30),{x:x+4,y:y-7,size:6.2,font:regular,color:GRAY});
}

async function addQrToPage(page,pdf,qrBytes,{x=470,y=28,size=72}={}){
  try{const image=await pdf.embedPng(qrBytes);page.drawRectangle({x:x-4,y:y-4,width:size+8,height:size+8,color:rgb(1,1,1),borderColor:GOLD,borderWidth:.6});page.drawImage(image,{x,y,width:size,height:size});return true;}catch{return false;}
}

async function departmentResponsible(admin,key){
  try{ const rows=await listResponsibleUsers(admin,key); return rows?.[0]||null; }
  catch{return null;}
}

async function currentSchoolCycle(admin,fallback='2026-2027'){
  try{
    const {data}=await admin.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle();
    return data?.ciclo_escolar||fallback;
  }catch{return fallback;}
}

async function makeTransferPdf({student,movement,admin,user,responsible,average=null,institution=null,verification=null}){
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  const docTitle=movement.tipo==='baja'?'COMPROBANTE DE BAJA':'CARTA DE TRASLADO';
  institution=institution||await getInstitution(admin);
  const cycle=await currentSchoolCycle(admin,student.ciclo_escolar||'2026-2027');
  const director=await departmentResponsible(admin,'DIR');
  const control=responsible||await departmentResponsible(admin,'CE');
  const {W,H,bold,regular}=await drawInstitutionHeader(page,pdf,{title:docTitle,folio:movement.folio,date:fmtDate(movement.fecha_movimiento),institution});

  let y=H-150;
  page.drawText('A QUIEN CORRESPONDA:',{x:50,y,size:10,font:bold,color:INK});
  y-=23; page.drawText('P R E S E N T E',{x:50,y,size:8.5,font:bold,color:GRAY}); y-=28;
  const intro=`Los que suscriben ${director?.nombre_responsable||director?.perfil?.nombre_completo||'la Dirección Escolar'}, Director(a) de ${institution.nombre_institucion||institution.siglas||'la institución'}, con C.C.T. ${institution.cct||'—'}, zona escolar ${institution.zona_escolar||'—'}, sector ${institution.sector||'—'}, ubicada en ${institution.direccion||'—'}, y ${control?.nombre_responsable||control?.perfil?.nombre_completo||'el responsable de Control Escolar'}, responsable del Departamento de Control Escolar de la misma,`;
  for(const line of wrap(intro,93)){page.drawText(line,{x:50,y,size:9.3,font:regular,color:INK});y-=14;}
  y-=13; page.drawText('H A C E N  C O N S T A R',{x:W/2-76,y,size:12,font:bold,color:RED}); y-=28;

  const group=student.grupos?.clave||'—';
  const grade=student.grupos?.grado?`${student.grupos.grado}°`:'—';
  const turn=student.grupos?.turno||student.turno||'—';
  const p1=`Que, de acuerdo con los registros escolares disponibles al momento de emisión de la presente, el(la) joven estudiante ${student.nombre_completo||'—'}, con CURP ${student.curp||'—'} y matrícula de control escolar ${student.matricula||'—'}, se encontró inscrito(a) en esta institución, siendo alumno(a) regular del ${grade} grupo “${group}”, turno ${turn}, durante el ciclo escolar ${cycle}.`;
  for(const line of wrap(p1,93)){page.drawText(line,{x:50,y,size:9.5,font:regular,color:INK});y-=14;}

  y-=10;
  const boxH=70;
  page.drawRectangle({x:50,y:y-boxH,width:W-100,height:boxH,color:GOLD_SOFT,borderColor:GOLD,borderWidth:.8});
  drawField(page,{x:64,y:y-17,label:'ESTUDIANTE',value:student.nombre_completo,width:230,bold,regular});
  drawField(page,{x:315,y:y-17,label:'CURP',value:student.curp,width:105,bold,regular});
  drawField(page,{x:430,y:y-17,label:'MATRÍCULA',value:student.matricula,width:105,bold,regular});
  drawField(page,{x:64,y:y-48,label:'GRADO / GRUPO',value:`${grade} · ${group}`,width:120,bold,regular});
  drawField(page,{x:205,y:y-48,label:'CICLO ESCOLAR',value:cycle,width:120,bold,regular});
  drawField(page,{x:345,y:y-48,label:'TURNO',value:turn,width:120,bold,regular});
  y-=boxH+20;

  const dateObj=new Date(movement.fecha_movimiento+'T00:00:00');
  const statement=movement.tipo==='baja'
    ? `CAUSANDO BAJA a partir del día ${dateObj.getDate()} del mes de ${dateObj.toLocaleDateString('es-MX',{month:'long'})} del año en curso.`
    : `A solicitud de la parte interesada, se expide la presente para hacer constar el traslado del(la) alumno(a), de acuerdo con los registros escolares de esta institución.`;
  for(const line of wrap(statement,93)){page.drawText(line,{x:50,y,size:9.5,font:regular,color:INK});y-=14;}

  if(movement.modalidad_documento==='promedio'){
    y-=6;
    const avgText=average==null?'Promedio general registrado: SIN CALIFICACIONES':`Promedio general registrado: ${Number(average).toFixed(2)} / 10`;
    page.drawRectangle({x:50,y:y-30,width:W-100,height:30,color:rgb(.96,.97,.98),borderColor:GOLD,borderWidth:.7});
    page.drawText(avgText,{x:62,y:y-20,size:9.2,font:bold,color:GREEN}); y-=43;
  }
  y=Math.max(y,225);
  const closing=`A petición de la parte interesada y para los fines escolares o administrativos que estime convenientes, se extiende la presente con fecha ${fmtDate(movement.fecha_movimiento)}.`;
  for(const line of wrap(closing,93)){page.drawText(line,{x:50,y,size:8.8,font:regular,color:GRAY});y-=13;}
  y=Math.max(y-22,112); page.drawText('A T E N T A M E N T E',{x:W/2-46,y,size:8.5,font:bold,color:INK});
  const sigY=y-75;
  await drawSignature(page,pdf,admin,director?.perfil||director,{x:62,y:sigY,w:215,role:'Dirección Escolar'});
  await drawSignature(page,pdf,admin,control?.perfil||control,{x:335,y:sigY,w:215,role:'Control Escolar'});
  if(verification?.qrBytes){await addQrToPage(page,pdf,verification.qrBytes,{x:W-125,y:28,size:72});page.drawText('ESCANEA PARA VALIDAR',{x:W-205,y:32,size:5.3,font:bold,color:GREEN});}
    page.drawText(`Documento oficial generado por ${institution.siglas||'la institución'} · Folio ${movement.folio||'—'}`,{x:50,y:34,size:6.5,font:regular,color:GRAY});
  return await pdf.save();
}

async function makeConductPdf({student,admin,user,observaciones='',responsible,average=null,modalidad='normal',institution=null,verification=null,folio=null}){
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  folio=folio||`CON-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
  const now=new Date();
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  institution=institution||await getInstitution(admin);
  const cycle=await currentSchoolCycle(admin,student.ciclo_escolar||'2026-2027');
  const director=await departmentResponsible(admin,'DIR');
  const control=responsible||await departmentResponsible(admin,'CE');
  const prefecture=await departmentResponsible(admin,'PRE');
  const {W,H,bold,regular}=await drawInstitutionHeader(page,pdf,{title:'CARTA DE CONDUCTA',folio,date:fmtDate(today),institution});

  let y=H-150;
  page.drawText('A QUIEN CORRESPONDA:',{x:50,y,size:10,font:bold,color:INK});
  y-=23; page.drawText('P R E S E N T E',{x:50,y,size:8.5,font:bold,color:GRAY}); y-=28;
  const intro=`Los que suscriben ${director?.nombre_responsable||director?.perfil?.nombre_completo||'la Dirección Escolar'}, Director(a) de ${institution.nombre_institucion||institution.siglas||'la institución'}, con C.C.T. ${institution.cct||'—'}, zona escolar ${institution.zona_escolar||'—'}, sector ${institution.sector||'—'}, ubicada en ${institution.direccion||'—'}, ${control?.nombre_responsable||control?.perfil?.nombre_completo||'el responsable de Control Escolar'} responsable del Departamento de Control Escolar y ${prefecture?.nombre_responsable||prefecture?.perfil?.nombre_completo||'el responsable de Prefectura'} responsable del Departamento de Prefectura de la misma,`;
  for(const line of wrap(intro,93)){page.drawText(line,{x:50,y,size:9.15,font:regular,color:INK});y-=14;}
  y-=13; page.drawText('H A C E N  C O N S T A R',{x:W/2-76,y,size:12,font:bold,color:RED}); y-=28;

  const group=student.grupos?.clave||'—';
  const grade=student.grupos?.grado?`${student.grupos.grado}°`:'—';
  const p1=`Que, el(la) joven estudiante ${student.nombre_completo||'—'}, con CURP ${student.curp||'—'} y matrícula de control escolar ${student.matricula||'—'}, cursó exitosamente el ${grade} grado, grupo “${group}”, durante el ciclo escolar ${cycle}, en esta institución, siendo alumno(a) regular y observando una:`;
  for(const line of wrap(p1,93)){page.drawText(line,{x:50,y,size:9.5,font:regular,color:INK});y-=14;}
  y-=8; page.drawRectangle({x:50,y:y-50,width:W-100,height:50,color:GOLD_SOFT,borderColor:GOLD,borderWidth:1});
  page.drawText('B U E N A  C O N D U C T A',{x:W/2-82,y:y-31,size:13,font:bold,color:GREEN}); y-=69;
  for(const line of wrap('acorde con las normas de convivencia escolar de la institución.',93)){page.drawText(line,{x:50,y,size:9.5,font:regular,color:INK});y-=14;}

  if(modalidad==='promedio'){
    y-=7;
    const avgText=average==null?'Promedio general registrado: SIN CALIFICACIONES':`Promedio general registrado: ${Number(average).toFixed(2)} / 10`;
    page.drawRectangle({x:50,y:y-30,width:W-100,height:30,color:rgb(.96,.97,.98),borderColor:GOLD,borderWidth:.7});
    page.drawText(avgText,{x:62,y:y-20,size:9.2,font:bold,color:GREEN}); y-=43;
  }
  if(observaciones){
    y-=3; page.drawText('OBSERVACIONES',{x:50,y,size:7,font:bold,color:GRAY}); y-=13;
    for(const line of wrap(observaciones,93)){page.drawText(line,{x:50,y,size:8.7,font:regular,color:INK});y-=13;}
  }
  y=Math.max(y,215);
  const d=new Date(today+'T00:00:00');
  const closing=`A petición de la parte interesada y para los fines escolares o administrativos que estime convenientes, se extiende la presente a los ${d.getDate()} días del mes de ${d.toLocaleDateString('es-MX',{month:'long'})} del año en curso.`;
  for(const line of wrap(closing,93)){page.drawText(line,{x:50,y,size:8.8,font:regular,color:GRAY});y-=13;}
  y=Math.max(y-18,112); page.drawText('A T E N T A M E N T E',{x:W/2-46,y,size:8.5,font:bold,color:INK});
  const sigY=y-76;
  await drawSignature(page,pdf,admin,director?.perfil||director,{x:42,y:sigY,w:165,role:'Dirección Escolar'});
  await drawSignature(page,pdf,admin,control?.perfil||control,{x:223,y:sigY,w:165,role:'Control Escolar'});
  await drawSignature(page,pdf,admin,prefecture?.perfil||prefecture,{x:404,y:sigY,w:165,role:'Prefectura'});
  if(verification?.qrBytes){await addQrToPage(page,pdf,verification.qrBytes,{x:W-125,y:28,size:72});page.drawText('ESCANEA PARA VALIDAR',{x:W-205,y:32,size:5.3,font:bold,color:GREEN});}
    page.drawText(`Folio de validación: ${folio} · Documento oficial generado desde el expediente escolar de ${institution.siglas||'la institución'}.`,{x:50,y:34,size:6.3,font:regular,color:GRAY});
  return {bytes:await pdf.save(),folio};
}

async function studentAverage(admin,alumnoId){
  const {data,error}=await admin.from('calificaciones').select('calificacion').eq('alumno_id',alumnoId);
  if(error)throw error;
  const values=(data||[]).map(x=>Number(x.calificacion)).filter(Number.isFinite);
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
}

async function makeStudiesPdf({student,admin,responsible,average=null,includeAverage=false,institution=null,verification=null,folio=null}){
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  folio=folio||`EST-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
  const now=new Date();
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  institution=institution||await getInstitution(admin);
  const cycle=await currentSchoolCycle(admin,student.ciclo_escolar||'2026-2027');
  const director=await departmentResponsible(admin,'DIR');
  const control=responsible||await departmentResponsible(admin,'CE');
  const {W,H,bold,regular}=await drawInstitutionHeader(page,pdf,{title:'CONSTANCIA DE ESTUDIOS',folio,date:fmtDate(today),institution});
  let y=H-150;
  page.drawText('A QUIEN CORRESPONDA:',{x:50,y,size:10,font:bold,color:INK});
  y-=23; page.drawText('P R E S E N T E',{x:50,y,size:8.5,font:bold,color:GRAY}); y-=28;
  const intro=`Los que suscriben ${director?.nombre_responsable||director?.perfil?.nombre_completo||'la Dirección Escolar'}, Director(a) de ${institution.nombre_institucion||institution.siglas||'la institución'}, con C.C.T. ${institution.cct||'—'}, zona escolar ${institution.zona_escolar||'—'}, sector ${institution.sector||'—'}, ubicada en ${institution.direccion||'—'}, y ${control?.nombre_responsable||control?.perfil?.nombre_completo||'el responsable de Control Escolar'}, responsable del Departamento de Control Escolar de la misma,`;
  for(const line of wrap(intro,93)){page.drawText(line,{x:50,y,size:9.15,font:regular,color:INK});y-=14;}
  y-=13; page.drawText('H A C E N  C O N S T A R',{x:W/2-76,y,size:12,font:bold,color:RED}); y-=28;
  const group=student.grupos?.clave||'—';
  const grade=student.grupos?.grado?`${student.grupos.grado}°`:'—';
  const p1=`Que, el(la) joven estudiante ${student.nombre_completo||'—'}, con CURP ${student.curp||'—'} y matrícula de control escolar ${student.matricula||'—'}, se encuentra cursando el ${grade} grado, grupo “${group}”, durante el ciclo escolar ${cycle}, en esta institución, siendo alumno(a) regular.`;
  for(const line of wrap(p1,93)){page.drawText(line,{x:50,y,size:9.5,font:regular,color:INK});y-=14;}
  if(includeAverage){
    y-=8;
    const avgText=average==null?'Promedio general registrado: SIN CALIFICACIONES':`P R O M E D I O  G E N E R A L: ${Number(average).toFixed(2)} / 10`;
    page.drawRectangle({x:50,y:y-42,width:W-100,height:42,color:GOLD_SOFT,borderColor:GOLD,borderWidth:1});
    page.drawText(avgText,{x:W/2-bold.widthOfTextAtSize(avgText,11)/2,y:y-27,size:11,font:bold,color:GREEN}); y-=60;
  }
  y=Math.max(y,215);
  const d=new Date(today+'T00:00:00');
  const closing=`A petición de la parte interesada y para los fines escolares o administrativos que estime convenientes, se extiende la presente a los ${d.getDate()} días del mes de ${d.toLocaleDateString('es-MX',{month:'long'})} del año en curso.`;
  for(const line of wrap(closing,93)){page.drawText(line,{x:50,y,size:8.8,font:regular,color:GRAY});y-=13;}
  y=Math.max(y-22,112); page.drawText('A T E N T A M E N T E',{x:W/2-46,y,size:8.5,font:bold,color:INK});
  const sigY=y-75;
  await drawSignature(page,pdf,admin,director?.perfil||director,{x:62,y:sigY,w:215,role:'Dirección Escolar'});
  await drawSignature(page,pdf,admin,control?.perfil||control,{x:335,y:sigY,w:215,role:'Control Escolar'});
  if(verification?.qrBytes){await addQrToPage(page,pdf,verification.qrBytes,{x:W-125,y:28,size:72});page.drawText('ESCANEA PARA VALIDAR',{x:W-205,y:32,size:5.3,font:bold,color:GREEN});}
    page.drawText(`Documento oficial generado por ${institution.siglas||'la institución'} · Folio ${folio}`,{x:50,y:34,size:6.5,font:regular,color:GRAY});
  return {bytes:await pdf.save(),folio};
}

async function ensureResponsibleSignature(admin,profile){
  if(!profile?.firma_path) throw Object.assign(new Error('El responsable seleccionado no tiene una firma institucional registrada. Registra su firma desde Perfil antes de emitir documentos oficiales.'),{status:409});
  const probe=await PDFDocument.create();
  const sig=await loadSignatureImage(probe,admin,profile.firma_path);
  if(!sig) throw Object.assign(new Error('La firma institucional del responsable está registrada pero el archivo no pudo leerse. Vuelve a registrar la firma desde Perfil.'),{status:409});
}

export default async function handler(req,res){
 try{
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido.'});
  const {user,profile,adminClient}=await requireControl(req);
  const b=req.body||{};
  const tipo=b.tipo==='traslado'?'traslado':b.tipo==='baja'?'baja':b.tipo==='conducta'?'conducta':b.tipo==='estudios'?'estudios':null;
  const modalidad=(b.tipo==='conducta'||b.tipo==='traslado'||b.tipo==='baja')?'normal':(b.modalidad==='promedio'?'promedio':'normal');
  const institution=await getInstitution(adminClient);
  const responsible=await validateResponsible(adminClient,b.responsable_id,profile.rol,'CE');
  await ensureResponsibleSignature(adminClient,responsible.perfil);
  const alumnoId=Number(b.alumno_id);
  if(!tipo||!alumnoId) return res.status(400).json({ok:false,error:'Tipo de documento y alumno son obligatorios.'});
  const {data:student,error:se}=await adminClient.from('alumnos').select('*,grupos(id,clave,grado,letra,turno)').eq('id',alumnoId).maybeSingle();
  if(se||!student) return res.status(404).json({ok:false,error:se?.message||'Alumno no encontrado.'});

  if(tipo==='conducta'){
    const {count,error:ie}=await adminClient.from('incidencias_prefectura').select('id',{count:'exact',head:true}).eq('alumno_id',alumnoId);
    if(ie) return res.status(500).json({ok:false,error:ie.message});
    if(Number(count||0)>0 && !b.confirmar){
      return res.status(409).json({ok:false,requires_confirmation:true,incidencias:Number(count||0),error:`El expediente tiene ${count} incidencia(s) registrada(s). Para emitir una constancia de BUENA CONDUCTA debes confirmar que deseas generarla.`});
    }
    const folio=`CON-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
    const cycle=await currentSchoolCycle(adminClient,student.ciclo_escolar||'2026-2027');
    const verification=await registerVerifiableDocument(adminClient,{folio,tipo:'conducta',titulo:'CARTA DE CONDUCTA',alumno_id:alumnoId,created_by:user.id,req,payload:{alumno:{nombre:student.nombre_completo,matricula:student.matricula,grupo:student.grupos?.clave,grado:student.grupos?.grado?`${student.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Tipo de documento',value:'Constancia de buena conducta'}]}});
    try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const {bytes}=await makeConductPdf({student,admin:adminClient,user,responsible,average:null,modalidad:'normal',observaciones:safe(b.observaciones),institution,verification,folio});return res.status(200).json({ok:true,folio,tipo,filename:`${institution.siglas||'ITHLA'}-${folio}.pdf`,pdf_base64:Buffer.from(bytes).toString('base64')});}catch(e){await deleteVerifiableDocument(adminClient,verification.id);throw e;}
  }

  if(tipo==='estudios'){
    const includeAverage=modalidad==='promedio';
    const average=includeAverage?await studentAverage(adminClient,alumnoId):null;
    const folio=`EST-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
    const cycle=await currentSchoolCycle(adminClient,student.ciclo_escolar||'2026-2027');
    const verification=await registerVerifiableDocument(adminClient,{folio,tipo:'estudios',titulo:`CONSTANCIA DE ESTUDIOS ${includeAverage?'CON PROMEDIO':'SIN PROMEDIO'}`,alumno_id:alumnoId,created_by:user.id,req,payload:{alumno:{nombre:student.nombre_completo,matricula:student.matricula,grupo:student.grupos?.clave,grado:student.grupos?.grado?`${student.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Modalidad',value:includeAverage?'Con promedio':'Sin promedio'},...(includeAverage?[{label:'Promedio general',value:average==null?'Sin calificaciones':Number(average).toFixed(2)+' / 10'}]:[])]}});
    try{verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});const {bytes}=await makeStudiesPdf({student,admin:adminClient,responsible,average,includeAverage,institution,verification,folio});return res.status(200).json({ok:true,folio,tipo,filename:`${institution.siglas||'ITHLA'}-${folio}.pdf`,pdf_base64:Buffer.from(bytes).toString('base64')});}catch(e){await deleteVerifiableDocument(adminClient,verification.id);throw e;}
  }

  const cycle=await currentSchoolCycle(adminClient,student.ciclo_escolar||'2026-2027');
  const fecha=safe(b.fecha)||new Date().toISOString().slice(0,10);
  const {data:seq,error:seqError}=await adminClient.from('movimientos_alumnos').insert({alumno_id:alumnoId,tipo,motivo:safe(b.motivo)||null,escuela_destino:null,fecha_movimiento:fecha,observaciones:safe(b.observaciones)||null,realizado_por:user.id,responsable_id:responsible.usuario_id,responsable_nombre:responsible.nombre_responsable||responsible.perfil?.nombre_completo||null,modalidad_documento:modalidad}).select('id,tipo,fecha_movimiento,motivo,escuela_destino,observaciones,modalidad_documento,responsable_id').single();
  if(seqError) return res.status(500).json({ok:false,error:seqError.message});
  const folio=`${tipo==='baja'?'BAJ':'TRA'}-${new Date(fecha+'T00:00:00').getFullYear()}-${String(seq.id).padStart(5,'0')}`;
  const {error:fe}=await adminClient.from('movimientos_alumnos').update({folio}).eq('id',seq.id);
  if(fe) return res.status(500).json({ok:false,error:fe.message});
  const movement={...seq,folio,modalidad_documento:modalidad};
  const average=(tipo==='traslado'||tipo==='baja'||tipo==='conducta')?null:(modalidad==='promedio'?await studentAverage(adminClient,alumnoId):null);
  const verification=await registerVerifiableDocument(adminClient,{folio,tipo,titulo:tipo==='baja'?'COMPROBANTE DE BAJA':'CARTA DE TRASLADO',alumno_id:alumnoId,created_by:user.id,req,payload:{alumno:{nombre:student.nombre_completo,matricula:student.matricula,grupo:student.grupos?.clave,grado:student.grupos?.grado?`${student.grupos.grado}°`:'—',ciclo:cycle},institucion:{siglas:institution.siglas,nombre_institucion:institution.nombre_institucion},detalle:[{label:'Tipo de documento',value:tipo==='baja'?'Comprobante de baja':'Carta de traslado'}]}});
  try{
    verification.qrBytes=await qrPng(verification.verificationUrl,{size:180});
    const bytes=await makeTransferPdf({student,movement,admin:adminClient,user,responsible,average,institution,verification});
    const {error:ae}=await adminClient.rpc('ithla_archivar_alumno',{p_alumno_id:alumnoId,p_tipo:tipo,p_motivo:b.motivo||b.observaciones||null,p_usuario:user.id,p_ciclo:cycle});
    if(ae){
      const {error:fallback}=await adminClient.from('alumnos').update({activo:false,grupo_id:null,estado_escolar:tipo==='baja'?'baja':'traslado',archivado_at:new Date().toISOString(),archivado_por:user.id,archivado_motivo:safe(b.motivo)||safe(b.observaciones)||null,archivado_tipo:tipo,ciclo_archivo:cycle}).eq('id',alumnoId);
      if(fallback) throw ae;
    }
    const nuevoEstado=tipo==='baja'?'baja':'traslado';
    if(student.matricula){const {error:me}=await adminClient.from('matricula_alumnos').update({estado:nuevoEstado}).eq('numero_matricula',student.matricula);if(me && !/does not exist|schema cache/i.test(me.message||''))throw me;}
    await audit(adminClient,{userId:user.id,role:profile.rol,action:tipo==='traslado'?'archivar_traslado':'archivar_baja',module:'movimientos',entity:'alumnos',entityId:alumnoId,description:`Alumno archivado por ${tipo}.`,after:{alumno_id:alumnoId,folio,tipo},req});
    return res.status(200).json({ok:true,folio,tipo,filename:`${institution.siglas||'ITHLA'}-${folio}.pdf`,pdf_base64:Buffer.from(bytes).toString('base64')});
  }catch(e){await deleteVerifiableDocument(adminClient,verification.id);try{await adminClient.from('movimientos_alumnos').delete().eq('id',seq.id);}catch{}throw e;}
 }catch(e){ return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'}); }
}
