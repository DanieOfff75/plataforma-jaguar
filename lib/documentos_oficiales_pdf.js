import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';

const NAVY=rgb(27/255,54/255,93/255);
const TEAL=rgb(0,128/255,128/255);
const GOLD=rgb(212/255,175/255,55/255);
const INK=rgb(44/255,62/255,80/255);
const GRAY=rgb(.40,.45,.48);
const PAPER=rgb(1,1,1);
const SOFT=rgb(.955,.974,.974);
const GOLD_DARK=rgb(.69,.54,.196);

const fontsCache=new WeakMap();
async function documentFonts(pdf){
  if(fontsCache.has(pdf))return fontsCache.get(pdf);
  pdf.registerFontkit(fontkit);
  const [book,heavy]=await Promise.all([
    readFile(new URL('../assets/fonts/Garet-Book.ttf',import.meta.url)),
    readFile(new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url))
  ]);
  const fonts={regular:await pdf.embedFont(book,{subset:true}),bold:await pdf.embedFont(heavy,{subset:true}),serif:await pdf.embedFont(StandardFonts.TimesRomanBold)};
  fontsCache.set(pdf,fonts);return fonts;
}
function drawRightFit(page,text,{font,right,y,maxWidth,size=8,minSize=4.6,color=INK}){
  const t=clean(text);let sz=size;
  while(sz>minSize&&font.widthOfTextAtSize(t,sz)>maxWidth)sz-=.2;
  const w=font.widthOfTextAtSize(t,sz);
  page.drawText(t,{x:Math.max(right-maxWidth,right-w),y,size:sz,font,color});
}

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
  page.drawRectangle({x:0,y:H-11,width:W,height:11,color:NAVY});
  page.drawRectangle({x:0,y:H-15,width:W,height:4,color:GOLD});
  page.drawRectangle({x:38,y:38,width:3,height:30,color:GOLD_DARK});
  page.drawLine({start:{x:43,y:50},end:{x:W-43,y:50},color:rgb(.85,.87,.86),thickness:.7});
}

async function addHeader(page,pdf,institution,{title,folio,date}){
  const W=612,H=792;
  const {regular,bold,serif}=await documentFonts(pdf);
  const logo=await loadLogo(pdf);
  drawFrame(page,W,H);
  if(logo)page.drawImage(logo,{x:45,y:H-102,width:53,height:55});
  page.drawText(institution?.siglas||'ITHLA',{x:109,y:H-53,size:16,font:serif,color:NAVY});
  const school=fit(institution?.nombre_institucion||'Instituto Tecnológico e Histórico Latinoamericano',52);
  page.drawText(school,{x:109,y:H-70,size:7.4,font:bold,color:INK});
  page.drawText(`CCT ${institution?.cct||'—'} · Zona ${institution?.zona_escolar||'—'} · Sector ${institution?.sector||'—'}`,{x:109,y:H-82,size:6.0,font:regular,color:GRAY});
  page.drawText(fit(institution?.direccion||'—',70),{x:109,y:H-93,size:5.8,font:regular,color:GRAY});
  page.drawText('PLATAFORMA JAGUAR  /  GESTIÓN DOCUMENTAL',{x:109,y:H-105,size:6,font:bold,color:TEAL});
  page.drawLine({start:{x:43,y:H-121},end:{x:W-43,y:H-121},color:GOLD_DARK,thickness:1});
  // The title sits in its own band so long school names never collide with it.
  const titleText=clean(title||'DOCUMENTO OFICIAL');
  drawRightFit(page,titleText,{font:serif,right:W-45,y:H-145,maxWidth:W-90,size:13.3,minSize:9,color:NAVY});
  const fol=`FOLIO ${folio||'—'}`;
  drawRightFit(page,fol,{font:bold,right:W-45,y:H-158,maxWidth:W-90,size:7.4,minSize:5.2,color:TEAL});
  const d=fmtDate(date);
  page.drawText(d,{x:50,y:H-158,size:7.4,font:regular,color:GRAY});
  return {W,H,bold,regular,logo};
}

function drawTextBlock(page,text,{x,y,size=9.6,maxChars=92,lineGap=14,font,color=INK}){
  let yy=y;
  for(const line of wrap(text,maxChars)){page.drawText(line,{x,y:yy,size,font,color});yy-=lineGap;}
  return yy;
}

async function addSignature(page,pdf,admin,signer,{x,y,w=200,role='Responsable institucional'}){
  const {regular,bold}=await documentFonts(pdf);
  const sig=await loadSignatureImage(pdf,admin,signer?.perfil?.firma_path||signer?.firma_path);
  if(sig){const scale=Math.min((w-60)/sig.width,35/sig.height);const iw=sig.width*scale,ih=sig.height*scale;page.drawImage(sig,{x:x+(w-iw)/2,y:y+23,width:iw,height:ih,opacity:.94});}
  page.drawLine({start:{x,y:y+16},end:{x:x+w,y:y+16},color:GRAY,thickness:.75});
  page.drawText(fit(signer?.nombre_responsable||signer?.perfil?.nombre_completo||'FIRMA NO REGISTRADA',32),{x:x+4,y:y+3,size:7.3,font:bold,color:INK});
  page.drawText(fit(role||signer?.cargo||'Responsable institucional',34),{x:x+4,y:y-8,size:6.3,font:regular,color:GRAY});
}

async function addQr(page,pdf,qrBytes){
  if(!qrBytes)return;
  try{
    const img=await pdf.embedPng(qrBytes);
    page.drawRectangle({x:470,y:28,width:88,height:88,color:rgb(1,1,1),borderColor:rgb(.82,.86,.87),borderWidth:.7});
    page.drawImage(img,{x:478,y:36,width:72,height:72});
    page.drawText('VERIFICACIÓN', {x:483,y:30,size:5.3,font:await pdf.embedFont(StandardFonts.HelveticaBold),color:TEAL});
  }catch{}
}

export async function buildOfficialPdf({admin,institution,type,folio,date,student,teacher,destinatario,asunto,cuerpo,signer,secondarySigner,additionalSigners=[],qrBytes}){
  const pdf=await PDFDocument.create();
  let page=pdf.addPage([612,792]);
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
  // Oficios: comunicación seria y formal, separada del formato de constancias.
  const esOficio=type.startsWith('OFI-')||type==='AVI-OFI';
  if(esOficio){destinatario=clean(destinatario)||'A QUIEN CORRESPONDA';asunto=clean(asunto)||'Comunicación institucional';}
  let y=H-185;

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
    page.drawRectangle({x:50,y:y-104,width:W-100,height:104,color:SOFT,borderColor:rgb(.82,.88,.89),borderWidth:.8});
    let fy=y-18;
    for(const [label,value] of rows){
      page.drawText(label,{x:64,y:fy,size:6.2,font:bold,color:GRAY});
      page.drawText(fit(value,48),{x:170,y:fy,size:8.5,font:regular,color:INK});
      fy-=17;
    }
    y-=124;
  }

  if(teacher && type==='CON-DOC'){
    page.drawRectangle({x:50,y:y-76,width:W-100,height:76,color:SOFT,borderColor:rgb(.82,.88,.89),borderWidth:.8});
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
  if(!body && (esOficio||type==='AVI-CIR'||type==='CER-COP'))body='Por medio del presente se comunica el asunto señalado, para su conocimiento y atención conforme a los procedimientos y atribuciones institucionales aplicables.';
  if(!body && type==='CER-ARC')body=`Se certifica que el documento o registro identificado en el expediente institucional fue emitido, integrado o resguardado por Archivo Escolar y que su folio de emisión permite verificar su autenticidad mediante el mecanismo institucional de validación.`;
  if(body){
    page.drawText(type.startsWith('CON-')||type==='CER-ARC'?'H A C E N  C O N S T A R':esOficio?'P R E S E N T E':'P R E S E N T E',{x:esOficio?52:W/2-50,y,size:9,font:bold,color:NAVY});
    y-=25;
    // Texto multipágina: no recortar oficios o constancias extensos.
    for(const line of wrap(body,88)){
      if(y<240){
        page=pdf.addPage([W,H]);
        await addHeader(page,pdf,institution,{title:'CONTINUACIÓN · '+(titleMap[type]||'DOCUMENTO OFICIAL'),folio,date});
        y=H-186;
      }
      page.drawText(line,{x:52,y,size:9.5,font:regular,color:INK});
      y-=14;
    }
  }

  if(esOficio){
    if(y<300){
      page=pdf.addPage([W,H]);
      await addHeader(page,pdf,institution,{title:'CONTINUACIÓN · '+(titleMap[type]||'OFICIO'),folio,date});
      y=H-186;
    }
    y-=16;
    y=drawTextBlock(page,'Sin otro particular, reciba un cordial saludo.',{x:52,y,size:9.4,maxChars:88,lineGap:14,font:regular});
    y-=22;
    page.drawText('A T E N T A M E N T E',{x:205,y,size:8.5,font:bold,color:NAVY});
    y-=20;
  }
  const footer=esOficio
    ? 'Comunicación de carácter institucional. La autenticidad y procedencia deberán verificarse mediante su folio y los mecanismos oficiales de Jaguar.'
    : 'Se expide el presente documento para los fines que correspondan, con la información disponible en los registros institucionales a la fecha de emisión.';
  if(y<255){
    page=pdf.addPage([W,H]);
    await addHeader(page,pdf,institution,{title:'CONTINUACIÓN · '+(titleMap[type]||'DOCUMENTO OFICIAL'),folio,date});
    y=H-186;
  }else y-=12;
  y=drawTextBlock(page,footer,{x:52,y,size:8.5,maxChars:88,lineGap:12,font:regular,color:GRAY});
  const dateLine=`Emitido el ${fmtDate(date)}.`;
  y-=5; y=drawTextBlock(page,dateLine,{x:52,y,size:8.5,maxChars:90,lineGap:12,font:regular,color:GRAY});

  const signatures=[signer,...(secondarySigner?[secondarySigner]:[]),...(additionalSigners||[])].filter(Boolean).slice(0,3);
  const sigY=122;
  const positions=signatures.length===1?[196]:signatures.length===2?[55,330]:[20,214,408];
  const widths=signatures.length===3?[175,175,175]:[220,220,220];
  for(let i=0;i<signatures.length;i++) await addSignature(page,pdf,admin,signatures[i],{x:positions[i],y:sigY,w:widths[i],role:signatures[i]?.cargo||`Responsable ${i+1}`});
  await addQr(page,pdf,qrBytes);
  drawRightFit(page,`Documento generado por PLATAFORMA JAGUAR · Folio ${folio}`,{font:regular,right:452,y:35,maxWidth:399,size:6.3,minSize:4.5,color:GRAY});
  page.drawText(`CCT ${institution?.cct||'—'} · ${institution?.dominio_institucional||'ithla.edu.mx'}`,{x:48,y:25,size:5.8,font:regular,color:GRAY});
  const allPages=pdf.getPages();
  allPages.forEach((pg,i)=>pg.drawText(`ITHLA · ${i+1} / ${allPages.length}`,{x:48,y:58,size:6.5,font:regular,color:GRAY}));
  return await pdf.save();
}

