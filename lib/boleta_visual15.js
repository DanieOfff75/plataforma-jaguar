/**
 * Plantilla oficial Jaguar (Propuesta 13/15).
 * El fondo PDF se imprimió desde el HTML aprobado, no se redibuja ni se modifica
 * al descargar. Solo se superponen datos, firmas y QR. Compatible con Vercel
 * gratuito: pdf-lib y Node, sin Chromium/Puppeteer en producción.
 */
import {readFile} from 'node:fs/promises';
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';

const TEMPLATE_PDF=new URL('../assets/boleta-visual15-base.pdf',import.meta.url);
const TEMPLATE_FIELDS=new URL('../assets/boleta-visual15-campos.json',import.meta.url);
const DIRECTION_SEAL_PNG=new URL('../assets/sello-setecfi-ithla-transparente.png',import.meta.url);
const SCALE=.75, HEIGHT=792;
const fallback=(value,empty='—')=>String(value??'').trim()||empty;
const norm=(s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const safeFontString=(s)=>String(s).replace(/[\u0000-\u001f]/g,' ').replace(/[\u200b-\u200f]/g,'').replace(/[\u2028-\u202f]/g,' ').replace(/[^\u0020-\u00ff\u0152\u0153\u0160\u0161\u0178\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u2022\u2026\u20ac]/g,'?');
const HEX=/rgba?\((\d+),\s*(\d+),\s*(\d+)/;
const parseColor=(s)=>{const match=HEX.exec(s||'');return match?rgb(+match[1]/255,+match[2]/255,+match[3]/255):rgb(.16,.16,.13);};

export async function renderBoletaVisual15({institution={},cycle,student,subjects=[],periodLabels=[],teachers=[],departments=[],folio,qrBytes,attendanceFaltas=0,overall=null,failed=0,observations=[],loadSignature}){
  if(subjects.length>10)throw new Error('La boleta admite hasta 10 materias; no se permite ocultar asignaturas.');
  if(periodLabels.length>3)throw new Error('La plantilla aprobada admite hasta 3 períodos. No se generó un PDF parcial con calificaciones omitidas.');
  const [baseBytes,fieldsBytes]=await Promise.all([readFile(TEMPLATE_PDF),readFile(TEMPLATE_FIELDS)]);
  const base=await PDFDocument.load(baseBytes);
  const templates=JSON.parse(fieldsBytes.toString('utf8'));
  if(base.getPageCount()!==27)throw new Error('Las plantillas dinámicas de boleta están incompletas (27 variantes esperadas).');
  let fields={};
  const out=await PDFDocument.create();
  const fonts={
    regular:await out.embedFont(StandardFonts.Helvetica),
    bold:await out.embedFont(StandardFonts.HelveticaBold),
    italic:await out.embedFont(StandardFonts.HelveticaOblique),
    serif:await out.embedFont(StandardFonts.TimesRoman),
    serifBold:await out.embedFont(StandardFonts.TimesRomanBold),
    serifItalic:await out.embedFont(StandardFonts.TimesRomanItalic)
  };
  const teacherPages=Math.ceil(teachers.length/10);
  const departmentPages=Math.ceil(departments.length/6);
  const total=1+teacherPages+departmentPages;
  const pages=[];
  const fieldSets=[];
  async function addVariant(kind,count){
    const key=`${kind}:${count}`;
    const index=templates.pages[key];
    if(!Number.isInteger(index)||!templates.variants[key])throw new Error(`No existe la plantilla de boleta ${key}`);
    const [template]=await out.copyPages(base,[index]);
    out.addPage(template);pages.push(template);fieldSets.push(templates.variants[key]);
  }
  await addVariant('main',subjects.length);
  for(let j=0;j<teacherPages;j++)await addVariant('teacher',Math.min(10,teachers.length-j*10));
  for(let j=0;j<departmentPages;j++)await addVariant('department',Math.min(6,departments.length-j*6));
  const fmtNum=(value)=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toFixed(1);
  function draw(page,key,raw,{size,align,bold=false,color,maxLines=1,pad=0,fit=false}={}){
    const b=fields[key];if(!b||raw==null||String(raw).trim()==='')return;
    let value=safeFontString(raw);
    if(b.transform==='uppercase')value=value.toUpperCase();
    const f=fonts[b.family?.match(/georgia|times/i)?(b.italic?'serifItalic':(bold||Number(b.weight)>=600?'serifBold':'serif')):(b.italic?'italic':(bold||Number(b.weight)>=600?'bold':'regular'))];
    let sz=(size??b.font)*SCALE;
    const left=b.x*SCALE+pad,right=(b.x+b.w)*SCALE-pad;
    const width=Math.max(10,right-left);
    if(fit){while(sz>4.3&&f.widthOfTextAtSize(value,sz)>width)sz-=.15;}
    const chunks=[];
    let line='';
    for(const word of value.split(/\s+/)){
      const candidate=line?`${line} ${word}`:word;
      if(line&&f.widthOfTextAtSize(candidate,sz)>width){chunks.push(line);line=word;}else line=candidate;
    }
    if(line)chunks.push(line);
    const lines=chunks.slice(0,Math.max(1,maxLines));
    if(chunks.length>maxLines){lines[lines.length-1]=chunks.slice(maxLines-1).join(' ');}
    for(let i=0;i<lines.length;i++){
      let t=lines[i];
      while(t.length>1&&f.widthOfTextAtSize(t,sz)>width)t=t.slice(0,-2)+'…';
      const w=f.widthOfTextAtSize(t,sz);
      const how=align||b.align;
      const x=how==='right'?right-w:how==='center'?left+(width-w)/2:left;
      // Keep the text vertically centred in precisely the original reference box.
      const lineStep=sz*1.19;
      const baseY=HEIGHT-(b.top+b.h/2)*SCALE-sz*.34 + (lines.length-1)*lineStep/2;
      const y=baseY-i*lineStep;
      page.drawText(t,{x:Math.max(left,x),y,size:sz,font:f,color:color||parseColor(b.color)});
    }
  }
  async function sign(page,boxKey,profile,{maxHeight=35}={}){
    if(!profile?.firma_path||typeof loadSignature!=='function')return;
    const b=fields[boxKey];if(!b)return;
    try{
      const result=await loadSignature(out,profile.firma_path);
      const img=result?.image||result;
      if(!img?.width||!img?.height)return;
      const isAuthority=/^(1|2)\.signbox\./.test(boxKey);
      const isDepartment=/^3\.signbox\./.test(boxKey);
      const maxW=b.w*SCALE*.76, maxH=Math.min(maxHeight,b.h*SCALE*(isAuthority?.34:isDepartment?.26:.74));
      const ratio=Math.min(maxW/img.width,maxH/img.height);
      const w=img.width*ratio,h=img.height*ratio;
      const x=b.x*SCALE+(b.w*SCALE-w)/2;
      const centerAt=isAuthority?.28:isDepartment?.53:.50;
      const y=HEIGHT-(b.top+b.h*centerAt)*SCALE-h/2;
      page.drawImage(img,{x,y,width:w,height:h});
    }catch{/* Firma inválida/no disponible: se conserva espacio para firma autógrafa. */}
  }
  const institutionName=fallback(institution.nombre_institucion,'INSTITUTO EDUCATIVO');
  const motto=fallback(institution.lema||institution.eslogan||institution.slogan||institution.lema_traduccion,'');
  const academicCycle=fallback(cycle);
  async function common(page,templateNo,actualPage,label){
    const pre=String(templateNo);
    draw(page,`${pre}.institution`,institutionName,{size:16,maxLines:1});
    draw(page,`${pre}.motto`,motto,{size:11,maxLines:1});
    draw(page,`${pre}.cycle`,academicCycle,{size:9,align:'right'});
    draw(page,`${pre}.folio`,folio,{size:9,align:'right',fit:true});
    draw(page,`${pre}.footer`,`${fallback(institution.siglas,'JAGUAR')} · ${institutionName}`,{size:7});
    draw(page,`${pre}.page`,`${actualPage} / ${total}`,{size:7,align:'right'});
  }
  const main=pages[0];
  fields=fieldSets[0];
  await common(main,1,1,'Boleta');
  draw(main,'1.subtitle','Registro de evaluación académica');
  const gp=student?.grupos||{};
  const values=[student?.nombre_completo,student?.matricula,gp.grado?`${gp.grado}°`:'—',gp.letra||gp.clave,gp.nivel||student?.nivel||'Mixto',gp.turno||student?.turno,academicCycle,student?.workshop||'Sin taller asignado','Formativo · sin calificación numérica',institutionName];
  values.forEach((v,i)=>draw(main,`1.student.${i}`,fallback(v),{size:i===0?10:9.5}));
  for(let col=0;col<3;col++){
    const p=periodLabels[col];
    draw(main,`1.period.${col}`,p?.fullLabel||(['1.ER PERIODO','2.º PERIODO','3.ER PERIODO'][col]),{size:8,align:'center'});
  }
  for(let row=0;row<subjects.length;row++){
    const sub=subjects[row];
    draw(main,`1.grade.${row}.0`,sub.name,{size:8,pad:4});
    for(let col=0;col<3;col++)draw(main,`1.grade.${row}.${col+1}`,col<periodLabels.length?fmtNum(sub.grades[col]):'—',{size:8,align:'center'});
    draw(main,`1.grade.${row}.4`,fmtNum(sub.avg),{size:8,align:'center'});
  }
  draw(main,'1.summary.0',overall==null?'—':Number(overall).toFixed(1),{size:18,pad:8});
  draw(main,'1.summary.1',subjects.every(x=>x.avg==null)?'Sin evaluar':failed?'En revisión':'Acreditado',{size:11,pad:8});
  draw(main,'1.summary.2',`${attendanceFaltas} día(s)`,{size:11,pad:8});
  const observationText=observations.length?observations.join(' · '):'Sin observaciones registradas.';
  draw(main,'1.notes',`Observaciones: ${observationText}`,{size:9,maxLines:2,pad:8});
  draw(main,'1.signlabel.0','Nombre y firma');
  // Página 1: sello institucional transparente colocado en el MISMO bloque de
  // Dirección; no se modifica el flujo del documento, las tablas ni las firmas
  // de las hojas complementarias. La firma de Dirección sigue en página 2.
  const sealBox=fields['1.signbox.1'];
  if(sealBox){
    const seal=await out.embedPng(await readFile(DIRECTION_SEAL_PNG));
    const stampH=Math.min(110,sealBox.h+38)*SCALE;
    const stampW=stampH*seal.width/seal.height;
    const midX=(sealBox.x+sealBox.w/2)*SCALE;
    const bottomY=HEIGHT-(sealBox.top+sealBox.h+3)*SCALE;
    main.drawImage(seal,{x:midX-stampW/2,y:bottomY,width:stampW,height:stampH});
  }
  if(qrBytes){
    const q=fields['1.qr'];
    const qr=await out.embedPng(qrBytes);
    const side=(Math.min(q.w,q.h)-8)*SCALE;
    const x=(q.x+q.w/2)*SCALE-side/2;
    const y=HEIGHT-(q.top+q.h/2)*SCALE-side/2;
    main.drawImage(qr,{x,y,width:side,height:side});
  }

  for(let j=0;j<teacherPages;j++){
    const page=pages[1+j];
    fields=fieldSets[1+j];
    await common(page,2,2+j,'Firmas docentes');
    const chunk=teachers.slice(j*10,j*10+10);
    for(let i=0;i<chunk.length;i++){
      const t=chunk[i];
      draw(page,`2.teacher.${i}.0`,String(j*10+i+1).padStart(2,'0'),{size:8,align:'center'});
      draw(page,`2.teacher.${i}.1`,fallback(t.subject),{size:8,pad:3,maxLines:2});
      draw(page,`2.teacher.${i}.2`,fallback(t.name),{size:8,pad:3,maxLines:2});
      await sign(page,`2.signature.${i}`,t.profile,{maxHeight:24});
    }
    const roles=['coordinacion academica','control escolar','direccion'];
    for(let i=0;i<3;i++){
      const dep=departments.find(d=>norm(d.name).includes(roles[i]));
      draw(page,`2.signlabel.${i}`,dep?.profile?.nombre_completo||'Nombre y firma');
      await sign(page,`2.signbox.${i}`,dep?.profile,{maxHeight:23});
    }
  }
  for(let j=0;j<departmentPages;j++){
    const page=pages[1+teacherPages+j];
    fields=fieldSets[1+teacherPages+j];
    await common(page,3,2+teacherPages+j,'Departamentos');
    for(const [i,dep] of departments.slice(j*6,j*6+6).entries()){
      draw(page,`3.department.${i}.name`,fallback(dep.name,'Departamento'),{size:10,maxLines:2});
      draw(page,`3.department.${i}.description`,dep.department?.descripcion||dep.department?.descripcion_corta||'Seguimiento y validación institucional',{size:8,maxLines:2});
      draw(page,`3.department.${i}.sign`,dep.profile?.nombre_completo||'Nombre y firma del responsable',{size:8});
      draw(page,`3.department.${i}.role`,dep.profile?.cargo||'Cargo del responsable',{size:7});
      await sign(page,`3.signbox.${i}`,dep.profile,{maxHeight:24});
    }
  }
  return await out.save();
}
