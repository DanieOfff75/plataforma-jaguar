/** Word institucional editable. No usa imágenes remotas ni fuentes privadas. */
import {Document,Packer,Paragraph,TextRun,Table,TableCell,TableRow,WidthType,AlignmentType,BorderStyle,ShadingType,HeadingLevel,PageBreak} from 'docx';
import {safeText} from './didactic_rules.js';
const NAVY='1B365D',GOLD='D4AF37',PALE='EEF3F5',MUTED='526477';
const txt=(v,bold=false,color=NAVY,size=20)=>new TextRun({text:safeText(v,3600)||'—',bold,color,size,font:'Aptos'});
const para=(v,opts={})=>new Paragraph({children:[txt(v,opts.bold||false,opts.color||NAVY,opts.size||20)],spacing:{before:opts.before||0,after:opts.after||110},...opts});
function cell(label,content,options={}){
 return new TableCell({width:{size:options.width||50,type:WidthType.PERCENTAGE},shading:{fill:options.fill||'FFFFFF',type:ShadingType.CLEAR},margins:{top:115,bottom:100,left:125,right:125},children:[para(label,{bold:true,size:17,color:NAVY,after:50}),para(content||'Espacio para completar',{size:19,color:options.empty?'8896A2':'273D51',after:0})]});
}
function pair(a,b){return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{top:{style:BorderStyle.SINGLE,color:'CED7DE',size:6},bottom:{style:BorderStyle.SINGLE,color:'CED7DE',size:6},left:{style:BorderStyle.SINGLE,color:'CED7DE',size:6},right:{style:BorderStyle.SINGLE,color:'CED7DE',size:6},insideVertical:{style:BorderStyle.SINGLE,color:'CED7DE',size:6}},rows:[new TableRow({children:[cell(a[0],a[1]),cell(b[0],b[1])]})]});}
function section(name,content){return [new Paragraph({children:[txt(name,true,NAVY,22)],shading:{fill:PALE},border:{bottom:{style:BorderStyle.SINGLE,color:GOLD,size:12}},spacing:{before:260,after:145}}),para(content||'Escriba aquí…',{size:20,color:content?'263A4C':'8793A3',after:140})];}
export async function buildDidacticDocx({propuesta:p,docente='',grupo='',materia='',fecha='',modelo=''}){
 const properties={creator:'Instituto Tecnológico e Histórico Latinoamericano',title:'Planeación didáctica · ITHLA'};
 const content=[
 new Paragraph({children:[txt('INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO',true,NAVY,22)],alignment:AlignmentType.CENTER,spacing:{after:80}}),
 new Paragraph({children:[txt('PLANEACIÓN DIDÁCTICA INSTITUCIONAL',true,NAVY,29)],alignment:AlignmentType.CENTER,spacing:{after:70}}),
 new Paragraph({children:[txt('Scientia, Humanitas et Progressum  ·  CCT 15USU0128X',false,MUTED,16)],alignment:AlignmentType.CENTER,spacing:{after:260}}),
 pair(['DOCENTE',docente],['ASIGNATURA',materia]),
 pair(['GRADO Y GRUPO',grupo],['FECHA / SESIÓN',fecha]),
 pair(['TÍTULO DE LA PLANEACIÓN',p.titulo],['ENFOQUE DIDÁCTICO',p.enfoque]),
 ...section('01 · PROPÓSITO Y APRENDIZAJE',`${p.proposito}\n\nAprendizaje esperado / PDA: ${p.aprendizaje}`),
 ...section('02 · INICIO',p.inicio),
 ...section('03 · DESARROLLO',p.desarrollo),
 ...section('04 · CIERRE',p.cierre),
 ...section('05 · EVALUACIÓN Y EVIDENCIAS',p.evaluacion),
 ...section('06 · ADECUACIONES E INCLUSIÓN',p.adecuaciones),
 ...section('07 · RECURSOS DIDÁCTICOS',p.recursos),
 ...(Array.isArray(p.recursos_enlaces)&&p.recursos_enlaces.length?section('RECURSOS / ENLACES PROPORCIONADOS POR EL DOCENTE',p.recursos_enlaces.join('\n')):[]),
 ...section('08 · OBSERVACIONES DEL DOCENTE',''),
 new Paragraph({children:[txt('DOCUMENTO DE TRABAJO · Elaborada con apoyo de NEXO IA.',true,MUTED,16)],spacing:{before:200,after:75}}),
 new Paragraph({children:[txt('La persona docente selecciona, revisa y asume la responsabilidad académica del contenido. No equivale a aprobación institucional. '+(modelo?`Modelo: ${modelo}`:''),false,MUTED,15)],spacing:{after:250}}),
 pair(['ELABORÓ / DOCENTE','________________________________'],['REVISIÓN INSTITUCIONAL','Pendiente de dictámenes y firmas oficiales'])
 ];
 const doc=new Document({...properties,styles:{default:{document:{run:{font:'Aptos',size:20,color:NAVY}}}},sections:[{properties:{page:{margin:{top:850,bottom:820,left:870,right:870}}},footer:{default:{children:[new Paragraph({children:[txt('ITHLA · PLATAFORMA JAGUAR  |  Formato institucional editable',false,MUTED,14)],alignment:AlignmentType.CENTER})]}},children:content}]});
 return Buffer.from(await Packer.toBuffer(doc));
}
