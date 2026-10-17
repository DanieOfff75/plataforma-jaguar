/** Credencial escolar horizontal ITHLA, concepto Minimalista Escolar.
 * Medidas reales: 85.6 x 54 mm. No modifica boletas ni documentos adicionales.
 * Los campos se adaptan sin cortar tablas ni desplazar las cajas de la tarjeta.
 */
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';

const W=242.65,H=153.07;
const NAVY=rgb(.075,.169,.271),GOLD=rgb(.80,.63,.30),PALE=rgb(.96,.974,.989);
const INK=rgb(.105,.173,.271),MUTED=rgb(.42,.49,.56),WHITE=rgb(1,1,1);
const safe=(v)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').replace(/[^\u0020-\u00ff]/g,'-').trim();
const sizeFit=(font,str,maxW,desired=7.5,min=4)=>{
  let n=desired;
  while(n>min&&font.widthOfTextAtSize(str,n)>maxW)n-=.2;
  return n;
};
function wordsLines(font,text,maxWidth,size,maxLines=3){
  const tokens=safe(text).split(/\s+/).filter(Boolean);
  const lines=[];let current='';
  for(const token of tokens){
    const candidate=current?current+' '+token:token;
    if(current&&font.widthOfTextAtSize(candidate,size)>maxWidth){lines.push(current);current=token;}else current=candidate;
  }
  if(current)lines.push(current);
  if(lines.length>maxLines)return null;
  return lines;
}
function multiFit(font,text,maxWidth,preferred,maxLines=3){
  for(let s=preferred;s>=4.1;s-=.2){const lines=wordsLines(font,text,maxWidth,s,maxLines);if(lines&&lines.every(t=>font.widthOfTextAtSize(t,s)<=maxWidth))return {lines,size:s};}
  const txt=safe(text);const n=sizeFit(font,txt,maxWidth,4.3,3.5);
  return {lines:[txt],size:n};
}
function centered(page,font,value,cx,y,width,size,color){
  const str=safe(value),s=sizeFit(font,str,width,size,4);
  page.drawText(str,{x:cx-font.widthOfTextAtSize(str,s)/2,y,size:s,font,color});
}
function tiny(page,font,label,x,y,w=100){
  const t=safe(label).toUpperCase();const sz=sizeFit(font,t,w,4.9,4);
  page.drawText(t,{x,y,size:sz,font,color:MUTED});
}
function rule(page,x,y,w,color=rgb(.81,.84,.87)){
  page.drawLine({start:{x,y},end:{x:x+w,y},thickness:.5,color});
}
function header(page){
  page.drawRectangle({x:0,y:0,width:W,height:H,color:WHITE});
  page.drawRectangle({x:0,y:H-3,width:W,height:3,color:GOLD});
}
export async function buildStudentCredentialPDF({institution={},student={},cycle='',folio='',photoBytes,logoBytes,qrBytes}){
  if(!photoBytes)throw new Error('No se puede emitir una credencial sin fotografía.');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [garetBook,garetHeavy]=await Promise.all([
    readFile(new URL('../assets/fonts/Garet-Book.ttf',import.meta.url)),
    readFile(new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url))
  ]);
  const regular=await pdf.embedFont(garetBook,{subset:true});
  const bold=await pdf.embedFont(garetHeavy,{subset:true});
  const serif=await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo=logoBytes?await pdf.embedPng(logoBytes):null;
  const photo=await pdf.embedJpg(photoBytes);
  const qr=qrBytes?await pdf.embedPng(qrBytes):null;
  const siglas=safe(institution.siglas||'ITHLA').toUpperCase();
  const validYear=safe(cycle||'—');
  const group=safe(student.group||'—');
  const grade=safe(student.grade||'—');
  const name=safe(student.name||'Alumno');
  const matricula=safe(student.matricula||'—');
  // FRENTE: franja vertical oscura, campo fotográfico real, datos limpios.
  {
    const page=pdf.addPage([W,H]);header(page);
    page.drawRectangle({x:0,y:0,width:62,height:H-3,color:NAVY});
    page.drawRectangle({x:62,y:H-3,width:W-62,height:3,color:GOLD});
    if(logo){
      const ratio=Math.min(43/logo.width,48/logo.height);
      page.drawImage(logo,{x:31-logo.width*ratio/2,y:72,width:logo.width*ratio,height:logo.height*ratio});
    }
    centered(page,serif,siglas,31,49,55,12.3,WHITE);
    centered(page,regular,'ESTUDIANTES',31,37,55,5.6,WHITE);
    // Dos bordes muy sutiles, sin adornos que oculten la información.
    page.drawRectangle({x:71,y:28,width:61,height:76,color:WHITE,borderColor:rgb(.83,.87,.9),borderWidth:.8});
    const tx=73,ty=30,tw=57,th=72;
    const scale=Math.max(tw/photo.width,th/photo.height);
    const dw=photo.width*scale,dh=photo.height*scale;
    // El navegador ya recorta la foto a 4:5. Aquí se inserta sin deformarla.
    const contain=Math.min(tw/photo.width,th/photo.height);
    const aw=photo.width*contain,ah=photo.height*contain;
    page.drawRectangle({x:tx,y:ty,width:tw,height:th,color:PALE});
    page.drawImage(photo,{x:tx+(tw-aw)/2,y:ty+(th-ah)/2,width:aw,height:ah});
    const x=139,contentW=96;
    tiny(page,bold,'CREDENCIAL ESCOLAR',x,128,contentW);
    rule(page,x,123,contentW,GOLD);
    tiny(page,bold,'Nombre del alumno',x,113,contentW);
    const nameLines=multiFit(bold,name,contentW,7.3,3);
    nameLines.lines.forEach((ln,i)=>page.drawText(ln,{x,y:103-i*(nameLines.size+1.8),font:bold,size:nameLines.size,color:INK}));
    const infoTop=72;
    tiny(page,bold,'Grado y grupo',x,infoTop,contentW);
    page.drawText(`${grade}  ·  ${group}`,{x,y:infoTop-10,font:regular,size:7,color:INK});
    tiny(page,bold,'Matrícula',x,infoTop-24,contentW);
    const mSize=sizeFit(bold,matricula,contentW,7.2,4.6);
    page.drawText(matricula,{x,y:infoTop-34,font:bold,size:mSize,color:INK});
    tiny(page,bold,'Ciclo escolar',x,infoTop-45,contentW);
    page.drawText(validYear,{x,y:infoTop-54,font:regular,size:6.7,color:INK});
    rule(page,71,19,W-80);
    page.drawText('IDENTIFICACIÓN ESCOLAR', {x:71,y:9,font:regular,size:5.0,color:NAVY});
  }
  // REVERSO: misma identidad; datos verificables y contacto real de la escuela.
  {
    const page=pdf.addPage([W,H]);header(page);
    page.drawRectangle({x:0,y:H-31,width:W,height:28,color:NAVY});
    page.drawText('DATOS DE REFERENCIA',{x:12,y:H-21,font:serif,size:10.1,color:WHITE});
    tiny(page,bold,'Vigencia / ciclo escolar',12,106,145);
    page.drawText(validYear,{x:12,y:94,font:bold,size:8.5,color:INK});
    tiny(page,bold,'Contacto institucional',12,79,145);
    const phone=safe(institution.telefono||'Sin teléfono registrado');
    const phoneSize=sizeFit(regular,phone,148,7.3,4.5);
    page.drawText(phone,{x:12,y:66,font:regular,size:phoneSize,color:INK});
    tiny(page,bold,'Servicios Estudiantiles',12,52,145);
    const location=safe(institution.entidad||'Institución educativa');
    page.drawText(location,{x:12,y:41,font:regular,size:sizeFit(regular,location,140,6.8,4.4),color:INK});
    if(qr){
      page.drawRectangle({x:183,y:49,width:50,height:50,color:WHITE,borderColor:rgb(.87,.9,.93),borderWidth:.65});
      page.drawImage(qr,{x:186,y:52,width:44,height:44});
      centered(page,regular,'VERIFICACIÓN',208,40,57,4.7,MUTED);
    }
    rule(page,12,32,W-24);
    const folioTxt=safe(folio);
    const fsz=sizeFit(bold,folioTxt,W-24,5.8,3.6);
    page.drawText(folioTxt,{x:12,y:22,font:bold,size:fsz,color:NAVY});
    page.drawText('Documento individual · Vigencia sujeta a validación digital',{x:12,y:10,font:regular,size:4.6,color:MUTED});
  }
  return Buffer.from(await pdf.save());
}
