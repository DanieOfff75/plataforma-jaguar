import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const NAVY=rgb(.105,.212,.365),TEAL=rgb(0,.50,.50),GOLD=rgb(.831,.686,.247),INK=rgb(.14,.20,.28),MUTED=rgb(.41,.47,.53),PALE=rgb(.95,.96,.97),WHITE=rgb(1,1,1);
const safe=s=>String(s??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[\u2022]/g,'-').replace(/[\u0100-\uffff]/g,'?');
function cut(font,s,size,max){let t=safe(s);while(t.length>1&&font.widthOfTextAtSize(t,size)>max)t=t.slice(0,-2)+'...';return t;}
function txt(page,font,s,x,y,size,color=INK,width=Infinity){page.drawText(cut(font,s,size,width),{x,y,size,font,color});}
function grade(st){return st.calificacion==null?'PEND.':Number(st.calificacion).toFixed(2)}
function components(st){
  if(!st.componentes?.length)return ['Sin desglose de rubrica disponible'];
  const pieces=st.componentes.map(c=>{
    const v=c.valor==null?'--':Number(c.valor).toFixed(2);
    const max=c.unidad==='puntos_ponderados_excel'&&c.maximo!=null?`/${Number(c.maximo).toFixed(2)} pts`:c.unidad==='escala_10'?'/10':'';
    return `${c.nombre}: ${v}${max}`;
  });
  const lines=[];let cur='';
  for(const p of pieces){if(cur && (cur.length+p.length)>71){lines.push(cur);cur=p}else cur=cur?`${cur}  |  ${p}`:p;}
  if(cur)lines.push(cur);
  if(st.valor_total_excel!=null)lines.push(`VALOR TOTAL Excel: ${Number(st.valor_total_excel).toFixed(2)}`);
  if(st.ajuste?.motivo)lines.push(`Ajuste: ${String(st.ajuste.motivo).slice(0,95)}`);
  return lines;
}
export async function buildAcademicGradesPdf(report,{generatedAt=new Date()}={}){
  const doc=await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const records=report.students||[],perPage=11,totalPages=Math.max(1,Math.ceil(records.length/perPage));
  for(let pageNum=0;pageNum<totalPages;pageNum++){
    const page=doc.addPage([841.89,595.28]),W=page.getWidth(),H=page.getHeight(),left=34,right=34;
    page.drawRectangle({x:0,y:H-11,width:W,height:11,color:NAVY});
    page.drawRectangle({x:0,y:H-14,width:W,height:3,color:GOLD});
    txt(page,bold,'ITHLA  |  INSTITUTO TECNOLOGICO E HISTORICO LATINOAMERICANO',left,H-37,12,NAVY,W-70);
    txt(page,bold,'DESGLOSE DE CALIFICACIONES - CONSULTA INSTITUCIONAL',left,H-60,14,NAVY,W-70);
    txt(page,regular,`Grupo: ${report.grupo?.clave||'-'}   |   Periodo: ${report.periodo?.nombre||'-'}   |   Materia: ${report.materia?.nombre||'-'}`,left,H-80,9.4,INK,W-70);
    txt(page,regular,`Ciclo: ${report.periodo?.ciclo_escolar||'-'}   |   Alumnos: ${records.length}   |   Registradas: ${report.totals?.registered??0}`,left,H-94,8,MUTED,W-70);
    const yy=H-115;
    page.drawRectangle({x:left,y:yy-17,width:W-left-right,height:23,color:NAVY});
    txt(page,bold,'No.',left+7,yy-9,8,WHITE);txt(page,bold,'ALUMNO / MATRICULA',left+42,yy-9,8,WHITE);
    txt(page,bold,'ASPECTOS / VALORES DE RUBRICA',left+289,yy-9,8,WHITE);
    txt(page,bold,'TOTAL',W-right-60,yy-9,8,WHITE);
    const chunk=records.slice(pageNum*perPage,(pageNum+1)*perPage),rowH=38;
    for(let i=0;i<chunk.length;i++){
      const s=chunk[i],y=yy-17-(i+1)*rowH;
      if(i%2===0)page.drawRectangle({x:left,y,width:W-left-right,height:rowH,color:PALE});
      page.drawLine({start:{x:left,y},end:{x:W-right,y},color:rgb(.85,.88,.90),thickness:.5});
      txt(page,regular,s.numero,left+8,y+22,8,INK,29);
      txt(page,bold,s.nombre_completo,left+42,y+23,8.1,INK,237);
      txt(page,regular,s.matricula,left+42,y+10,7.3,MUTED,235);
      const lines=components(s);
      if(lines.length<=2){lines.forEach((line,j)=>txt(page,regular,line,left+289,y+23-j*12,7.3,INK,391));}
      else{lines.slice(0,3).forEach((line,j)=>txt(page,regular,line,left+289,y+28-j*10,6.9,INK,391));if(lines.length>3)txt(page,regular,`... +${lines.length-3} aspectos`,left+289,y+1,6.7,MUTED,389);}
      txt(page,bold,grade(s),W-right-62,y+19,10,s.calificacion==null?MUTED:TEAL,58);
    }
    page.drawLine({start:{x:left,y:38},end:{x:W-right,y:38},color:GOLD,thickness:1});
    txt(page,regular,'Reporte de consulta. No sustituye la boleta oficial ni autoriza cambios de calificacion.',left,24,7.7,MUTED,W-150);
    txt(page,regular,`${pageNum+1} / ${totalPages}`,W-right-34,24,8,MUTED,40);
  }
  return new Uint8Array(await doc.save());
}
