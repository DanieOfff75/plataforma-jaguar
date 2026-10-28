/** Soporte documental PDF compartido. Recursos auto-contenidos en la función Vercel. */
import {StandardFonts,rgb} from 'pdf-lib';
export const C=Object.freeze({NAVY:rgb(.106,.212,.365),TEAL:rgb(0,.5,.5),GOLD:rgb(.831,.686,.216),WHITE:rgb(1,1,1),INK:rgb(.13,.18,.24),MUTED:rgb(.37,.43,.50),LINE:rgb(.80,.84,.87),PALE:rgb(.96,.97,.98)});
function cleanText(value){return String(value??'').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[^\u0020-\u00ff\u0152\u0153\u0160\u0161\u0178\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g,'?');}
function safeFit(font,text,max,size,min){let value=cleanText(text),sz=size;while(sz>min&&font.widthOfTextAtSize(value,sz)>max)sz-=.2;while(value.length>0&&font.widthOfTextAtSize(value,sz)>max)value=value.slice(0,-1);return {value,sz};}
export function textFit(page,font,text,x,y,width,{size=9,min=6,color=C.INK}={}){const {value,sz}=safeFit(font,text,width,size,min);page.drawText(value,{x,y,size:sz,font,color});return sz;}
export function centered(page,font,text,y,{size=10,color=C.INK}={}){const width=page.getWidth()-72,{value,sz}=safeFit(font,text,width,size,6);page.drawText(value,{x:(page.getWidth()-font.widthOfTextAtSize(value,sz))/2,y,size:sz,font,color});}
export async function prepareInstitutionalPdf(pdf,{logoBytes}={}){
  const [regular,bold,title]=await Promise.all([pdf.embedFont(StandardFonts.TimesRoman),pdf.embedFont(StandardFonts.TimesRomanBold),pdf.embedFont(StandardFonts.TimesRomanBold)]);
  let logo=null;
  if(logoBytes){try{logo=await pdf.embedPng(logoBytes);}catch{try{logo=await pdf.embedJpg(logoBytes);}catch{}}}
  return {regular,bold,title,logo};
}
export function chroma(page,theme,{kind='DOCUMENTO INSTITUCIONAL'}={}){
  const W=page.getWidth(),H=page.getHeight();
  page.drawRectangle({x:0,y:H-11,width:W,height:11,color:C.NAVY});
  page.drawRectangle({x:0,y:H-15,width:W,height:4,color:C.GOLD});
  page.drawRectangle({x:0,y:0,width:W,height:14,color:C.NAVY});
  if(theme.logo){const dims=theme.logo.scale(1),scale=Math.min(44/dims.width,49/dims.height);page.drawImage(theme.logo,{x:42,y:H-84,width:dims.width*scale,height:dims.height*scale});}
  centered(page,theme.title,'INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO',H-40,{size:10,color:C.NAVY});
  centered(page,theme.regular,kind,H-58,{size:7.7,color:C.TEAL});
  page.drawLine({start:{x:40,y:H-95},end:{x:W-40,y:H-95},color:C.GOLD,thickness:.9});
}
export function footer(page,theme,index,total,text){
 const y=29;page.drawLine({start:{x:39,y:y+14},end:{x:page.getWidth()-39,y:y+14},color:C.LINE,thickness:.65});
 textFit(page,theme.regular,text,43,y,470,{size:7,min:6,color:C.MUTED});
 textFit(page,theme.regular,`${index} / ${total}`,page.getWidth()-77,y,42,{size:7,color:C.MUTED});
}
export function signature(page,theme,signer,{x=150,y=94,width=312,role='FIRMA'}={}){
  const lineY=y+34;
  if(signer?.image){const img=signer.image,sc=Math.min(1,130/img.width,44/img.height);page.drawImage(img,{x:x+(width-img.width*sc)/2,y:lineY+5,width:img.width*sc,height:img.height*sc});}
  page.drawLine({start:{x,y:lineY},end:{x:x+width,y:lineY},thickness:.7,color:C.NAVY});
  const label=signer?.name||'FIRMA PENDIENTE';const sz=8.3;
  const {value,sz:fs}=safeFit(theme.bold,label,width-8,sz,6.5);
  page.drawText(value,{x:x+(width-theme.bold.widthOfTextAtSize(value,fs))/2,y:lineY-14,size:fs,font:theme.bold,color:C.INK});
  const sub=safeFit(theme.regular,role,width-8,7.2,6);page.drawText(sub.value,{x:x+(width-theme.regular.widthOfTextAtSize(sub.value,sub.sz))/2,y:lineY-27,size:sub.sz,font:theme.regular,color:C.MUTED});
}
