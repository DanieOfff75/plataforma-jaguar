import {PDFDocument} from 'pdf-lib';
import {C,prepareInstitutionalPdf,chroma,textFit,centered,footer,signature} from './institutional_pdf_theme.js';
const W=612,H=792;
function wrap(font,s,width,size){
  const lines=[];let current='';
  for(const word of String(s||'').trim().split(/\s+/)){
    if(!word)continue;
    const next=current?`${current} ${word}`:word;
    if(current&&font.widthOfTextAtSize(next,size)>width){lines.push(current);current=word;}
    else current=next;
  }
  if(current)lines.push(current);
  return lines;
}
function paragraphs(page,font,value,y,{size=10,width=500,lineHeight=18}={}){
  for(const line of String(value).split('\n')){
    if(!line.trim()){y-=10;continue;}
    for(const row of wrap(font,line,width,size)){
      textFit(page,font,row,54,y,width,{size,min:8,color:C.INK});y-=lineHeight;
    }
  }
  return y;
}
export async function buildGradePrecisionOfficePdf({record,logoBytes=null,loadSignature=null,signaturePath=null}={}){
  if(!record?.id||!record?.motivo)throw Error('Oficio de política incompleto.');
  const pdf=await PDFDocument.create();const theme=await prepareInstitutionalPdf(pdf,{logoBytes});
  let signatureImage=null;
  if(signaturePath&&typeof loadSignature==='function'){try{signatureImage=(await loadSignature(pdf,signaturePath))?.image||null;}catch{}}
  const page=pdf.addPage([W,H]);
  chroma(page,theme,{kind:'AUTORIDAD ACADÉMICA  /  CORRESPONDENCIA INSTITUCIONAL'});
  centered(page,theme.title,'OFICIO CIRCULAR DE CRITERIO DE CALIFICACIONES',H-125,{size:14.1,color:C.NAVY});
  centered(page,theme.regular,`OFICIO NÚM. ITHLA-PC-${record.id}`,H-147,{size:8.5,color:C.TEAL});
  const date=new Date(record.creado_at);
  const dateText=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Mexico_City'}).format(date):'fecha no disponible';
  textFit(page,theme.regular,`Estado de México, ${dateText}`,50,H-186,510,{size:8.8,color:C.MUTED});
  page.drawLine({start:{x:45,y:H-200},end:{x:567,y:H-200},color:C.LINE,thickness:.7});
  const meta=[['ASUNTO','Cambio de criterio de calificaciones'],['CICLO ESCOLAR',record.ciclo_escolar],['CRITERIO ANTERIOR',record.antes_permite_decimales?'CON UN DECIMAL':'SIN DECIMALES'],['CRITERIO VIGENTE',record.ahora_permite_decimales?'CON UN DECIMAL':'SIN DECIMALES'],['MÍNIMA APROBATORIA',`${record.antes_minima_aprobatoria??6} → ${record.ahora_minima_aprobatoria??6}`],['NOTAS REPROBATORIAS',`${record.antes_permitir_reprobatorias_inferiores===false?'PISO':'PERMITIDAS'} → ${record.ahora_permitir_reprobatorias_inferiores===false?'PISO':'PERMITIDAS'}`]];
  for(const [i,[label,value]] of meta.entries()){
    textFit(page,theme.bold,label,51,H-229-i*19,131,{size:8.2,color:C.NAVY});
    textFit(page,theme.regular,value,185,H-229-i*19,374,{size:8.5,color:C.INK});
  }
  textFit(page,theme.bold,'A TODO EL PERSONAL DEL INSTITUTO',53,H-356,500,{size:10.5,color:C.NAVY});
  textFit(page,theme.bold,'P R E S E N T E',53,H-378,500,{size:8.7,color:C.NAVY});
  let y=H-390;
  y=paragraphs(page,theme.regular,
    `Se comunica que, para el ciclo ${record.ciclo_escolar}, quedan establecidos los criterios de calificación oficial indicados en el encabezado. La mínima aprobatoria será ${record.ahora_minima_aprobatoria??6} y el redondeo no podrá convertir una reprobación en aprobación. El acuerdo rige sólo para nuevas evaluaciones.`,y,{size:9.0,lineHeight:13.5});
  y-=10;
  textFit(page,theme.bold,'MOTIVO DEL CAMBIO',54,y,500,{size:9.1,color:C.NAVY});y-=16;
  y=paragraphs(page,theme.regular,record.motivo,y,{size:9.0,lineHeight:12.5});
  y-=8;
  y=paragraphs(page,theme.regular,
    'La condición de aprobación se determina ANTES de redondear: una nota reprobatoria nunca se convierte en aprobatoria. Cuando se activa el piso reprobatorio, las notas inferiores se elevan al entero anterior a la mínima aprobatoria. Excel, bitácora y periodos cerrados conservan sus valores originales.',y,{size:8.8,lineHeight:12.4});
  y-=8;
  y=paragraphs(page,theme.regular,
    'Se solicita a todo el personal tomar conocimiento de este criterio. El oficio no sustituye las boletas ni autoriza cambios retroactivos.',y,{size:8.8,lineHeight:12.4});
  if(y<162)throw Error('El contenido del oficio excede la página. Resume el motivo a menos de 300 caracteres.');
  centered(page,theme.bold,'A T E N T A M E N T E',143,{size:8.9,color:C.NAVY});
  signature(page,theme,{name:record.actor_nombre||'CONTROL ESCOLAR',image:signatureImage},{x:151,y:76,width:310,role:'AUTORIDAD ACADÉMICA EMISORA'});
  footer(page,theme,1,1,`Oficio ITHLA-PC-${record.id} · Circular interna de política de calificaciones`);
  pdf.setTitle(`ITHLA · Oficio circular de calificaciones · ITHLA-PC-${record.id}`);
  return new Uint8Array(await pdf.save());
}
