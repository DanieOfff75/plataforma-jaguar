/** Salidas académicas creadas desde la instantánea de preguntas del examen. */
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {Document,Packer,Paragraph,TextRun,HeadingLevel,AlignmentType} from 'docx';
import {readFile} from 'node:fs/promises';
const logo=new URL('../assets/ithla-logo.png',import.meta.url);
const bookFont=new URL('../assets/fonts/Garet-Book.ttf',import.meta.url);
const heavyFont=new URL('../assets/fonts/Garet-Heavy.ttf',import.meta.url);
function items(exam){return Array.isArray(exam.preguntas)?exam.preguntas:[];}
function answerOptions(q){return q.tipo==='opcion_multiple'?(q.opciones||[]).map((v,i)=>`${String.fromCharCode(65+i)}) ${v}`):q.tipo==='verdadero_falso'?['A) Verdadero','B) Falso']:[];}
function wrap(pdfFont,text,size,maxWidth){const result=[];for(const paragraph of String(text||'').split('\n')){let line='';for(const w of paragraph.split(/\s+/)){const next=line?line+' '+w:w;if(line&&pdfFont.widthOfTextAtSize(next,size)>maxWidth){result.push(line);line=w;}else line=next;}result.push(line);}return result;}
export async function examToPdf(exam,groupLabel,subjectLabel){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const body=await pdf.embedFont(await readFile(bookFont),{subset:true}),bold=await pdf.embedFont(await readFile(heavyFont),{subset:true}),serif=await pdf.embedFont(StandardFonts.TimesRomanBold);
 let page,y,index=0;
 const ink=rgb(.11,.21,.36),gold=rgb(.69,.54,.20);
 function newPage(){page=pdf.addPage([612,792]);index++;y=735;page.drawRectangle({x:0,y:782,width:612,height:10,color:gold});page.drawLine({start:{x:42,y:54},end:{x:570,y:54},thickness:1,color:gold});page.drawText('ITHLA · Plataforma Jaguar · Evaluación académica',{x:42,y:39,size:8,font:body,color:ink});page.drawText('Página '+index,{x:526,y:39,size:8,font:body,color:ink});}
 function addLine(text,{size=10,f=body,indent=0,leading=15,space=0}={}){for(const line of wrap(f,text,size,525-indent)){if(y<85)newPage();page.drawText(line,{x:43+indent,y,size,font:f,color:ink});y-=leading;}y-=space;}
 newPage();
 let insignia=null;try{insignia=await pdf.embedPng(await readFile(logo));}catch{}
 if(insignia){page.drawImage(insignia,{x:43,y:693,width:49,height:48});}
 page.drawText('INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO',{x:100,y:719,size:10,font:serif,color:ink});
 page.drawText('PLATAFORMA JAGUAR · EXAMEN ACADÉMICO',{x:100,y:701,size:9,font:bold,color:gold});
 y=674;addLine(exam.titulo,{size:17,f:serif,leading:23,space:8});
 addLine(`Materia: ${subjectLabel}       Grupo: ${groupLabel}`,{size:10,f:bold,space:8});
 addLine('Nombre: __________________________________________________    Fecha: ______________',{size:9,space:10});
 if(exam.instrucciones)addLine(`Indicaciones: ${exam.instrucciones}`,{size:9,space:10});
 for(const [i,q] of items(exam).entries()){
   if(y<155)newPage();addLine(`${i+1}. ${q.enunciado}   (${q.puntos} punto${Number(q.puntos)===1?'':'s'})`,{size:10,f:bold,space:5});
   const opts=answerOptions(q);if(opts.length)opts.forEach(s=>addLine(s,{indent:17,size:9,leading:14}));
   else {addLine('____________________________________________________________________________',{size:8,leading:23});addLine('____________________________________________________________________________',{size:8,leading:23});}
   y-=14;
 }
 pdf.setTitle('Examen · '+exam.titulo);return Buffer.from(await pdf.save());
}
export async function examToDocx(exam,groupLabel,subjectLabel){
 const paras=[
  new Paragraph({text:'INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO',heading:HeadingLevel.HEADING_2,alignment:AlignmentType.CENTER}),
  new Paragraph({text:'PLATAFORMA JAGUAR · EVALUACIÓN ACADÉMICA',alignment:AlignmentType.CENTER}),
  new Paragraph({text:exam.titulo,heading:HeadingLevel.HEADING_1}),
  new Paragraph({text:`Materia: ${subjectLabel}     Grupo: ${groupLabel}`}),
  new Paragraph({text:'Nombre: _________________________________________     Fecha: ___________'}),
  new Paragraph({text:'Indicaciones: '+(exam.instrucciones||'Responde con claridad.'),spacing:{after:300}})
 ];
 items(exam).forEach((q,i)=>{
  paras.push(new Paragraph({children:[new TextRun({text:`${i+1}. ${q.enunciado}`,bold:true}),new TextRun({text:` (${q.puntos} puntos)`})],spacing:{before:240,after:100}}));
  const opts=answerOptions(q);
  opts.forEach(line=>paras.push(new Paragraph({text:line,indent:{left:440}})));
  if(!opts.length)for(let k=0;k<3;k++)paras.push(new Paragraph({text:'________________________________________________________________________________',spacing:{after:80}}));
 });
 const doc=new Document({sections:[{properties:{},children:paras}]});return Buffer.from(await Packer.toBuffer(doc));
}
export function examToGoogleAppsScript(exam){
 const questions=JSON.stringify(items(exam).map(q=>({tipo:q.tipo,enunciado:q.enunciado,opciones:q.opciones||[],respuesta:q.respuesta,puntos:q.puntos}))).replace(/</g,'\\u003c');
 const title=JSON.stringify(exam.titulo),instructions=JSON.stringify(exam.instrucciones||'');
 return `/** Jaguar ITHLA · Importa este archivo en script.google.com y ejecuta crearExamenJaguar.\n * Google solicitará permiso a la cuenta que deba ser propietaria del formulario.\n * No comparte respuestas ni credenciales con Jaguar. */\nfunction crearExamenJaguar(){\n  const form=FormApp.create(${title});\n  form.setDescription(${instructions});\n  form.setIsQuiz(true);\n  const preguntas=${questions};\n  preguntas.forEach((q)=>{\n    if(q.tipo==='opcion_multiple'){\n      const item=form.addMultipleChoiceItem();\n      item.setTitle(q.enunciado).setRequired(true);\n      item.setChoices(q.opciones.map((s,i)=>item.createChoice(s,i===q.respuesta)));\n      item.setPoints(Math.max(1,Math.round(q.puntos)));\n    }else if(q.tipo==='verdadero_falso'){\n      const item=form.addMultipleChoiceItem();\n      item.setTitle(q.enunciado).setRequired(true);\n      item.setChoices([item.createChoice('Verdadero',q.respuesta===true),item.createChoice('Falso',q.respuesta===false)]);\n      item.setPoints(Math.max(1,Math.round(q.puntos)));\n    }else{\n      const item=form.addParagraphTextItem();\n      item.setTitle(q.enunciado).setRequired(true);\n      item.setHelpText('Respuesta abierta: calificación manual del docente.');\n    }\n  });\n  Logger.log('Formulario listo: '+form.getEditUrl());\n  Logger.log('Para alumnos: '+form.getPublishedUrl());\n}\n`;
}
