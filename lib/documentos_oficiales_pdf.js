import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const NAVY=rgb(27/255,54/255,93/255);
const TEAL=rgb(0,128/255,128/255);
const GOLD=rgb(212/255,175/255,55/255);
const INK=rgb(44/255,62/255,80/255);
const GRAY=rgb(.40,.45,.48);
const PAPER=rgb(.995,.993,.97);

function clean(v){return String(v??'').replace(/\s+/g,' ').trim();}
function wrap(text,max=92){
  const words=clean(text).split(' '); const out=[]; let line='';
  for(const word of words){
    if(!word)continue;
    const next=(line+' '+word).trim();
    if(next.length>max){if(line)out.push(line);line=word;}else line=next;
  }
  if(line)out.push(line);
  return out.length?out:[''];
}
function fit(text,max=42){const v=clean(text);return v.length<=max?v:`${v.slice(0,Math.max(1,max-1))}…`;}
function fmtDate(value){
  const d=value?new Date(`${String(value).slice(0,10)}T00:00:00`):new Date();
  return d.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
}

async function loadLogo(pdf){
  try{
    const bytes=await readFile(new URL('../assets/ithla-logo.png',import.meta.url));
    return await pdf.embedPng(bytes);
  }catch{return null;}
}

async function loadSignatureImage(pdf,admin,path){
  if(!path)return null;
  try{
    const storage=admin.storage.from('firmas-institucionales');
    const cleanPath=String(path).replace(/^\/+/, '');
    let {data,error}=await storage.download(cleanPath);
    if(error||!data){
      const signed=await storage.createSignedUrl(cleanPath,300);
      if(signed?.data?.signedUrl){
        const r=await fetch(signed.data.signedUrl);
        if(r.ok){data=new Blob([Buffer.from(await r.arrayBuffer())]);}
      }
    }
    if(!data)return null;
    const bytes=Buffer.from(await data.arrayBuffer());
    try{return await pdf.embedPng(bytes);}catch{return await pdf.embedJpg(bytes);}
  }catch{return null;}
}

function drawFrame(page,W,H){
  page.drawRectangle({x:0,y:0,width:W,height:H,color:PAPER});
  page.drawRectangle({x:0,y:H-15,width:W,height:15,color:NAVY});
  page.drawRectangle({x:0,y:H-20,width:W,height:5,color:GOLD});
  page.drawRectangle({x:24,y:24,width:W-48,height:H-48,borderColor:GOLD,borderWidth:1});
  page.drawRectangle({x:30,y:30,width:W-60,height:H-60,borderColor:rgb(.88,.89,.87),borderWidth:.45});
}

async function addHeader(page,pdf,institution,{title,folio,date}){
  const W=612,H=792;
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const logo=await loadLogo(pdf);
  drawFrame(page,W,H);
  if(logo)page.drawImage(logo,{x:44,y:H-100,width:48,height:52,opacity:.96});
  page.drawText(institution?.siglas||'ITHLA',{x:105,y:H-54,size:16,font:bold,color:NAVY});
  page.drawText(fit(institution?.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',68),{x:105,y:H-69,size:7.5,font:bold,color:INK});
  page.drawText(`CCT ${institution?.cct||'—'}  ·  Zona ${institution?.zona_escolar||'—'}  ·  Sector ${institution?.sector||'—'}`,{x:105,y:H-81,size:5.5,font:regular,color:GRAY});
  page.drawText(fit(institution?.direccion||'—',82),{x:105,y:H-92,size:5.3,font:regular,color:GRAY});
  page.drawText('DOCUMENTO OFICIAL · ARCHIVO ESCOLAR',{x:105,y:H-104,size:6,font:bold,color:TEAL});
  const t=clean(title||'DOCUMENTO OFICIAL');
  const right=562;
  page.drawText(t,{x:Math.max(335,right-bold.widthOfTextAtSize(t,8)),y:H-55,size:8,font:bold,color:NAVY});
  const fol=`FOLIO  ${folio||'—'}`; page.drawText(fol,{x:Math.max(375,right-regular.widthOfTextAtSize(fol,7.2)),y:H-70,size:7.2,font:regular,color:GRAY});
  const d=fmtDate(date); page.drawText(d,{x:Math.max(380,right-regular.widthOfTextAtSize(d,7.2)),y:H-84,size:7.2,font:regular,color:GRAY});
  page.drawLine({start:{x:44,y:H-120},end:{x:W-44,y:H-120},color:GOLD,thickness:1});
  return {W,H,bold,regular,logo};
}

function drawTextBlock(page,text,{x,y,size=9.6,maxChars=92,lineGap=14,font,color=INK}){
  let yy=y;
  for(const line of wrap(text,maxChars)){page.drawText(line,{x,y:yy,size,font,color});yy-=lineGap;}
  return yy;
}

async function addSignature(page,pdf,admin,signer,{x,y,w=200,role='Responsable institucional'}){
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const sig=await loadSignatureImage(pdf,admin,signer?.perfil?.firma_path||signer?.firma_path);
  if(sig)page.drawImage(sig,{x:x+28,y:y+22,width:w-56,height:38,opacity:.94});
  page.drawLine({start:{x,y:y+16},end:{x:x+w,y:y+16},color:GRAY,thickness:.75});
  page.drawText(fit(signer?.nombre_responsable||signer?.perfil?.nombre_completo||'FIRMA NO REGISTRADA',32),{x:x+4,y:y+3,size:7.3,font:bold,color:INK});
  page.drawText(fit(role||signer?.cargo||'Responsable institucional',34),{x:x+4,y:y-8,size:6.3,font:regular,color:GRAY});
}

async function addQr(page,pdf,qrBytes){
  if(!qrBytes)return;
  try{
    const img=await pdf.embedPng(qrBytes);
    page.drawRectangle({x:470,y:28,width:88,height:88,color:rgb(1,1,1),borderColor:GOLD,borderWidth:.7});
    page.drawImage(img,{x:478,y:36,width:72,height:72});
    page.drawText('VERIFICACIÓN', {x:483,y:30,size:5.3,font:await pdf.embedFont(StandardFonts.HelveticaBold),color:TEAL});
  }catch{}
}

export async function buildOfficialPdf({admin,institution,type,folio,date,student,teacher,destinatario,asunto,cuerpo,signer,secondarySigner,additionalSigners=[],qrBytes}){
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  const titleMap={
    'CON-INS':'CONSTANCIA DE INSCRIPCIÓN',
    'CON-REG':'CONSTANCIA DE ALUMNO REGULAR',
    'CON-EST':'CONSTANCIA DE ESTUDIOS',
    'CON-MAT':'CONSTANCIA DE MATRÍCULA',
    'CON-GRU':'CONSTANCIA DE GRUPO Y TURNO',
    'CON-EGR':'CONSTANCIA DE EGRESO',
    'CON-BAJ':'CONSTANCIA DE BAJA',
    'CON-TRS':'CONSTANCIA DE TRASLADO',
    'CON-TAL':'CONSTANCIA DE PARTICIPACIÓN EN TALLER',
    'CON-DOC':'CONSTANCIA DOCENTE',
    'CON-PAG':'CONSTANCIA DE PAGO',
    'CON-ING':'COMPROBANTE DE INGRESO INSTITUCIONAL',
    'OFI-GEN':'OFICIO INSTITUCIONAL',
    'OFI-ADM':'OFICIO ADMINISTRATIVO',
    'AVI-OFI':'AVISO OFICIAL',
    'AVI-CIR':'CIRCULAR / AVISO GENERAL',
    'CIT-OFI':'CITATORIO OFICIAL',
    'CER-ARC':'CERTIFICACIÓN DE ARCHIVO',
    'CER-COP':'CERTIFICACIÓN DE COPIA O DOCUMENTO',
    'OFI-CAR':'CARTA / OFICIO PERSONALIZADO'
  };
  const {W,H,bold,regular}=await addHeader(page,pdf,institution,{title:titleMap[type]||'DOCUMENTO OFICIAL',folio,date});
  let y=H-152;

  if(destinatario){page.drawText('DESTINATARIO',{x:52,y,size:6.5,font:bold,color:GRAY});y-=13;y=drawTextBlock(page,destinatario,{x:52,y,size:9.5,maxChars:88,lineGap:13,font:bold});y-=10;}
  if(asunto){page.drawText('ASUNTO',{x:52,y,size:6.5,font:bold,color:GRAY});y-=13;y=drawTextBlock(page,asunto,{x:52,y,size:9.2,maxChars:88,lineGap:13,font:bold,color:NAVY});y-=16;}

  if(student && ['CON-INS','CON-REG','CON-EST','CON-MAT','CON-GRU','CON-EGR','CON-BAJ','CON-TRS','CON-TAL','CON-PAG','CIT-OFI'].includes(type)){
    const group=student.grupos?.clave||'—';
    const grade=student.grupos?.grado?`${student.grupos.grado}°`:'—';
    const rows=[
      ['ESTUDIANTE',student.nombre_completo||'—'],
      ['MATRÍCULA',student.matricula||'—'],
      ['CURP',student.curp||'—'],
      ['GRADO / GRUPO',`${grade} · ${group}`],
      ['TURNO',student.grupos?.turno||student.turno||'—']
    ];
    page.drawRectangle({x:50,y:y-104,width:W-100,height:104,color:rgb(.98,.96,.90),borderColor:GOLD,borderWidth:.8});
    let fy=y-18;
    for(const [label,value] of rows){
      page.drawText(label,{x:64,y:fy,size:6.2,font:bold,color:GRAY});
      page.drawText(fit(value,48),{x:170,y:fy,size:8.5,font:regular,color:INK});
      fy-=17;
    }
    y-=124;
  }

  if(teacher && type==='CON-DOC'){
    page.drawRectangle({x:50,y:y-76,width:W-100,height:76,color:rgb(.98,.96,.90),borderColor:GOLD,borderWidth:.8});
    page.drawText('DOCENTE',{x:64,y:y-18,size:6.2,font:bold,color:GRAY});
    page.drawText(fit(teacher.nombre_completo||'—',55),{x:150,y:y-18,size:9,font:regular,color:INK});
    page.drawText('NÚMERO DE EMPLEADO',{x:64,y:y-37,size:6.2,font:bold,color:GRAY});
    page.drawText(fit(teacher.numero_empleado||'—',30),{x:190,y:y-37,size:8.5,font:regular,color:INK});
    page.drawText('ESTATUS',{x:64,y:y-56,size:6.2,font:bold,color:GRAY});
    page.drawText(fit(teacher.estado_profesional||'activo',30),{x:150,y:y-56,size:8.5,font:regular,color:INK});
    y-=96;
  }

  let body=cuerpo;
  if(!body && type==='CON-EST')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} cuenta con registros de estudios en esta institución, de acuerdo con la información disponible a la fecha de emisión.`;
  if(!body && type==='CON-MAT')body=`Por medio de la presente se hace constar que la matrícula ${student?.matricula||'—'} corresponde a ${student?.nombre_completo||'la persona registrada'} en los controles institucionales.`;
  if(!body && type==='CON-GRU')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} se encuentra registrado(a) en el grupo ${student?.grupos?.clave||'—'} y turno ${student?.grupos?.turno||student?.turno||'—'}.`;
  if(!body && type==='CON-EGR')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} tiene registrado estatus de egresado en los controles escolares de esta institución.`;
  if(!body && type==='CON-BAJ')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} tiene registrado estatus de baja escolar en los controles institucionales.`;
  if(!body && type==='CON-TRS')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} tiene registrado estatus de traslado en los controles institucionales.`;
  if(!body && type==='CON-INS')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} se encuentra inscrito(a) en esta institución durante el ciclo escolar correspondiente y cuenta con los registros escolares que sustentan la información indicada en el presente documento.`;
  if(!body && type==='CON-REG')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} se encuentra inscrito(a) y con estatus escolar regular en esta institución, de acuerdo con los registros administrativos y académicos disponibles al momento de emisión.`;
  if(!body && type==='CON-TAL')body=`Por medio de la presente se hace constar que ${student?.nombre_completo||'el(la) estudiante'} cuenta con una inscripción registrada en el taller extracurricular indicado en los controles institucionales. Esta constancia se emite para los fines que correspondan.`;
  if(!body && type==='CON-PAG')body=`Se hace constar que se recibió un pago por ${String(cuerpo||'').replace(/^Se hace constar: /,'')}.`;
  if(!body && type==='CON-ING')body=`Se hace constar que la institución registró el ingreso indicado en el presente comprobante. ${String(cuerpo||'').trim()}`;
  if(!body && type==='CON-DOC')body=`Por medio de la presente se hace constar que ${teacher?.nombre_completo||'el(la) docente'} mantiene registro profesional en esta institución, de acuerdo con la información administrativa disponible a la fecha de emisión.`;
  if(!body && type==='CIT-OFI')body=`Por medio del presente se cita formalmente a ${student?.nombre_completo||'la persona interesada'} para atender el asunto señalado, en la fecha, hora y lugar comunicados por el área responsable. El presente documento forma parte del expediente institucional correspondiente.`;
  if(!body && (type==='OFI-ADM'||type==='AVI-CIR'||type==='CER-COP'))body=cuerpo||'Se emite el presente documento institucional para los fines que correspondan, con base en los registros y autorizaciones disponibles.';
  if(!body && type==='CER-ARC')body=`Se certifica que el documento o registro identificado en el expediente institucional fue emitido, integrado o resguardado por Archivo Escolar y que su folio de emisión permite verificar su autenticidad mediante el mecanismo institucional de validación.`;
  if(body){
    page.drawText(type.startsWith('CON-')||type==='CER-ARC'?'H A C E N  C O N S T A R':'P R E S E N T E',{x:W/2-50,y,size:9,font:bold,color:NAVY});
    y-=25;
    y=drawTextBlock(page,body,{x:52,y,size:9.5,maxChars:90,lineGap:14,font:regular});
  }

  const footer=`Se expide el presente documento para los fines que correspondan, con la información disponible en los registros institucionales a la fecha de emisión.`;
  y=Math.max(y-8,220);
  y=drawTextBlock(page,footer,{x:52,y,size:8.5,maxChars:90,lineGap:12,font:regular,color:GRAY});
  const dateLine=`Emitido el ${fmtDate(date)}.`;
  y-=5; y=drawTextBlock(page,dateLine,{x:52,y,size:8.5,maxChars:90,lineGap:12,font:regular,color:GRAY});

  const signatures=[signer,...(secondarySigner?[secondarySigner]:[]),...(additionalSigners||[])].filter(Boolean).slice(0,3);
  const sigY=122;
  const positions=signatures.length===1?[196]:signatures.length===2?[55,330]:[20,214,408];
  const widths=signatures.length===3?[175,175,175]:[220,220,220];
  for(let i=0;i<signatures.length;i++) await addSignature(page,pdf,admin,signatures[i],{x:positions[i],y:sigY,w:widths[i],role:signatures[i]?.cargo||`Responsable ${i+1}`});
  await addQr(page,pdf,qrBytes);
  page.drawText(`Documento generado por PLATAFORMA JAGUAR · Folio ${folio}`,{x:48,y:35,size:6.3,font:regular,color:GRAY});
  page.drawText(`CCT ${institution?.cct||'—'} · ${institution?.dominio_institucional||'ithla.edu.mx'}`,{x:48,y:25,size:5.8,font:regular,color:GRAY});
  return await pdf.save();
}

