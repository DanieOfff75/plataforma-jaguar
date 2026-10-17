/** Vista pública de validación.
 * Nunca imprime campos de archivo privados. Si recibe el PDF original, éste
 * debió superar la política de publicación en el controlador (no aquí).
 */
import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib';

const NAVY=rgb(.106,.212,.365), GOLD=rgb(.831,.686,.216);
const GRAY=rgb(.39,.44,.50), INK=rgb(.15,.20,.27);
const STATUSES={
  valido:{label:'DOCUMENTO VÁLIDO',color:rgb(.03,.54,.28)},
  cancelado:{label:'DOCUMENTO CANCELADO',color:rgb(.72,.10,.18)},
  expirado:{label:'DOCUMENTO EXPIRADO',color:rgb(.71,.40,.07)},
  no_valido:{label:'DOCUMENTO NO VÁLIDO',color:rgb(.40,.45,.51)}
};
const printable=(v)=>String(v??'').normalize('NFKC').replace(/[\u0000-\u001f]/g,' ').replace(/[\u200b-\u200f]/g,'').replace(/[\u2028-\u202f]/g,' ').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\u0020-\u00ff]/g,'?');
const trimmed=(v,max=160)=>printable(v).trim().slice(0,max);
const dateText=(s)=>{
  if(!s)return 'No establecida';
  const d=new Date(s);return Number.isNaN(d.getTime())?'No establecida':d.toLocaleDateString('es-MX',{timeZone:'UTC',day:'2-digit',month:'long',year:'numeric'});
};
function fit(font,text,sz,maxW){let size=sz;while(size>6&&font.widthOfTextAtSize(text,size)>maxW)size-=.3;return size;}
function watermark(page,font,status,folio){
  const {width:w,height:h}=page.getSize();
  const cfg=STATUSES[status]||STATUSES.no_valido;
  const text=printable(cfg.label);
  const angle=Math.atan2(h,w)*180/Math.PI;
  const limit=Math.hypot(w,h)*.83;
  const size=Math.min(68,limit/font.widthOfTextAtSize(text,1));
  const length=font.widthOfTextAtSize(text,size);
  const radians=angle*Math.PI/180;
  const x=w/2-length*Math.cos(radians)/2;
  const y=h/2-length*Math.sin(radians)/2;
  page.drawText(text,{x,y,size,font,color:cfg.color,rotate:degrees(angle),opacity:.17});
  // Franja de auditoría pequeña, no tapa el contenido del original.
  const auditText=trimmed(`JAGUAR | ${cfg.label} | Folio ${folio}`,140);
  page.drawRectangle({x:0,y:0,width:w,height:19,color:NAVY,opacity:.92});
  page.drawText(auditText,{x:20,y:6,size:7,font,color:rgb(1,1,1),maxWidth:w-40});
}
function putLine(page,font,text,x,y,maxW,{size=10,color=INK}={}){
  const value=trimmed(text,190);
  page.drawText(value,{x,y,size:fit(font,value,size,maxW),font,color});
}
export async function makeVerificationPdf({record,status,originalBytes=null}){
  const doc=originalBytes?await PDFDocument.load(originalBytes):await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const serif=await doc.embedFont(StandardFonts.TimesRomanBold);
  const state=STATUSES[status]||STATUSES.no_valido;
  if(!originalBytes){
    let page=doc.addPage([595.28,841.89]);
    const {width:w,height:h}=page.getSize(), margin=48;
    page.drawRectangle({x:0,y:h-116,width:w,height:116,color:NAVY});
    page.drawRectangle({x:0,y:h-120,width:w,height:4,color:GOLD});
    putLine(page,bold,'ITHLA | PLATAFORMA JAGUAR',margin,h-47,w-2*margin,{size:13,color:rgb(1,1,1)});
    putLine(page,regular,'Sistema institucional de verificación documental',margin,h-70,w-2*margin,{size:9,color:rgb(.86,.91,.98)});
    let y=h-166;
    putLine(page,serif,record.titulo||'Documento escolar',margin,y,w-2*margin,{size:21});
    y-=34;
    putLine(page,bold,state.label,margin,y,w-2*margin,{size:12,color:state.color});
    y-=42;
    const payload=record.datos_publicos||{};
    const student=payload.alumno||{};
    const institution=payload.institucion||{};
    const items=[
      ['Folio institucional',record.folio],
      ['Tipo de documento',record.tipo],
      ['Fecha de emisión',dateText(record.fecha_emision)],
      ['Vigencia',dateText(record.fecha_expiracion)],
      ['Institución',institution.nombre_institucion||institution.nombre||'Institución educativa'],
      ['Nombre',student.nombre],
      ['Matrícula',student.matricula],
      ['Grupo',student.grupo],
      ['Grado',student.grado],
      ['Ciclo escolar',student.ciclo]
    ].filter(([,v])=>v!=null&&String(v).trim());
    const details=Array.isArray(payload.detalle)?payload.detalle.slice(0,40).map(item=>[item?.label,item?.value]).filter(([k,v])=>k&&v!=null&&typeof v!=='object'):[];
    for(const [label,value] of [...items,...details]){
      if(y<158){
        page=doc.addPage([w,h]);
        page.drawRectangle({x:0,y:h-82,width:w,height:82,color:NAVY});
        page.drawRectangle({x:0,y:h-86,width:w,height:4,color:GOLD});
        putLine(page,bold,'ITHLA | CONTINUACIÓN DE DATOS VERIFICADOS',margin,h-49,w-2*margin,{size:11,color:rgb(1,1,1)});
        y=h-120;
      }
      page.drawLine({start:{x:margin,y:y-12},end:{x:w-margin,y:y-12},thickness:.45,color:rgb(.85,.88,.91)});
      putLine(page,bold,label,margin,y,w*.32,{size:8,color:GRAY});
      putLine(page,regular,value,margin+177,y,w-margin*2-177,{size:9});
      y-=39;
    }
    page.drawRectangle({x:margin,y:58,width:w-2*margin,height:68,color:rgb(.95,.97,.98)});
    putLine(page,bold,'VISTA PÚBLICA DE VERIFICACIÓN',margin+14,103,w-2*margin-28,{size:9,color:NAVY});
    putLine(page,regular,'Esta representación muestra sólo los datos autorizados para consulta pública.',margin+14,84,w-2*margin-28,{size:7.5,color:GRAY});
    putLine(page,regular,'No sustituye al PDF original conservado en el expediente institucional.',margin+14,70,w-2*margin-28,{size:7.5,color:GRAY});
  }
  for(const page of doc.getPages())watermark(page,bold,status,record.folio);
  return Buffer.from(await doc.save());
}
