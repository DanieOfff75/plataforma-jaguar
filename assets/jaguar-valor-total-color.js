/* Jaguar · Reglas dinámicas en VALORES PONDERACION.
 * No altera el libro ni sus datos esenciales; añade tres reglas OOXML de formato condicional
 * exclusivamente a la columna VALOR TOTAL. JSZip 3.10.1 se distribuye localmente.
 */
(function(){
'use strict';
const palette=[
 {fill:'FFDFEFDF',min:9,max:10},
 {fill:'FFFFF0C2',min:6,max:8.999999},
 {fill:'FFF6DADA',min:0,max:5.999999}
];
const rootPrefix=(xml,tag)=>(xml.match(new RegExp('<([A-Za-z0-9_]+:)?'+tag+'\\b'))||[])[1]||'';
const elem=(p,t)=>p+t;
const fillXml=(hex,p)=>`<${elem(p,'dxf')}><${elem(p,'fill')}><${elem(p,'patternFill')} patternType="solid"><${elem(p,'fgColor')} rgb="${hex}"/><${elem(p,'bgColor')} indexed="64"/></${elem(p,'patternFill')}></${elem(p,'fill')}></${elem(p,'dxf')}>`;
function addDxfs(xml){
 const p=rootPrefix(xml,'styleSheet');
 const tag=elem(p,'dxfs');
 let first=0;
 const rx=new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>');
 const match=xml.match(rx);
 if(match){
  const count=Number((match[0].match(/\\bcount="(\\d+)"/)||[])[1]||0);
  first=count;
  xml=xml.replace(rx,(_,body)=>`<${tag} count="${count+3}">${body}${palette.map(x=>fillXml(x.fill,p)).join('')}</${tag}>`);
 }else{
  const empty=new RegExp('<'+tag+'\\b[^>]*/>');
  if(empty.test(xml))xml=xml.replace(empty,`<${tag} count="3">${palette.map(x=>fillXml(x.fill,p)).join('')}</${tag}>`);
  else{
   const section=`<${tag} count="3">${palette.map(x=>fillXml(x.fill,p)).join('')}</${tag}>`;
   const before=new RegExp('<'+p+'(?:tableStyles|colors|extLst)\\b');
   if(before.test(xml))xml=xml.replace(before,section+'$&');
   else xml=xml.replace(`</${elem(p,'styleSheet')}>`,section+`</${elem(p,'styleSheet')}>`);
  }
 }
 return {xml,first};
}
function addRules(xml,cellRange,first){
 const p=rootPrefix(xml,'worksheet');
 const firstCell=cellRange.split(':')[0];
 const condition=palette.map((rule,i)=>{
  const upper=i===0?`${firstCell}&lt;=10`:`${firstCell}&lt;${i===1?9:6}`;
  const formula=`AND(ISNUMBER(${firstCell}),${firstCell}&gt;=${rule.min},${upper})`;
  return `<${elem(p,'cfRule')} type="expression" dxfId="${first+i}" priority="${i+1}" stopIfTrue="1"><${elem(p,'formula')}>${formula}</${elem(p,'formula')}></${elem(p,'cfRule')}>`;
 }).join('');
 const section=`<${elem(p,'conditionalFormatting')} sqref="${cellRange}">${condition}</${elem(p,'conditionalFormatting')}>`;
 for(const name of ['mergeCells','autoFilter','sheetData']){
  const full=elem(p,name);
  const close=`</${full}>`;
  if(xml.includes(close))return xml.replace(close,close+section);
  const self=new RegExp('<'+full+'\\b[^>]*\\/>');
  if(self.test(xml))return xml.replace(self,m=>m+section);
 }
 throw Error('La hoja de Excel no tiene una estructura reconocida; no se generó el archivo.');
}
async function writeWithConditionalTotal(wb,filename,{startRow,lastRow,totalCol}={}){
 if(!window.XLSX||!window.JSZip)throw Error('No se cargaron las bibliotecas necesarias para generar el Excel con formato condicional.');
 if(!Number.isSafeInteger(startRow)||!Number.isSafeInteger(lastRow)||!Number.isSafeInteger(totalCol)||totalCol<4)throw Error('Rango de VALOR TOTAL inválido.');
 if(lastRow<startRow){window.XLSX.writeFile(wb,filename,{bookType:'xlsx',cellStyles:true});return;}
 const sheetIndex=wb.SheetNames.indexOf('VALORES PONDERACION');
 if(sheetIndex<0)throw Error('No existe VALORES PONDERACION en este libro.');
 const col=window.XLSX.utils.encode_col(totalCol-1);
 const sqref=`${col}${startRow}:${col}${lastRow}`;
 const bytes=window.XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
 const archive=await window.JSZip.loadAsync(bytes);
 const styleFile=archive.file('xl/styles.xml');
 const sheetFile=archive.file(`xl/worksheets/sheet${sheetIndex+1}.xml`);
 if(!styleFile||!sheetFile)throw Error('No se pudieron encontrar las partes internas del libro XLSX.');
 const style=addDxfs(await styleFile.async('string'));
 const sheet=addRules(await sheetFile.async('string'),sqref,style.first);
 archive.file('xl/styles.xml',style.xml);
 archive.file(`xl/worksheets/sheet${sheetIndex+1}.xml`,sheet);
 const blob=await archive.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
 const url=URL.createObjectURL(blob);
 try{const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();}
 finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
window.jaguarWriteValorTotalColors=writeWithConditionalTotal;
})();
