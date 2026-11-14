/** Mixed official presentation; source scores are never overwritten here. */
const fail=m=>{throw Object.assign(Error(m),{status:409});};
export function gradeText(value){
 if(value===null||value===undefined||value==='')return '—';
 if(value==='AP'||value==='RP')return value;
 if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)))fail('Calificación incompatible con la boleta.');
 const n=Number(value);const [whole,fraction='']=String(value).split('.');if(!Number.isFinite(n)||n<0||n>10||(typeof value==='string'&&BigInt(whole)===10n&&/[1-9]/.test(fraction)))fail('Calificación fuera de rango.');
 // Keep the lexical decimal rather than rounding or converting to a binary float.
 return typeof value==='string'?value.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):String(n);
}
export function gradeNumber(v){const t=gradeText(v);return t==='—'||t==='AP'||t==='RP'?null:Number(t);}
export function subjectGradeSummary(subject,periodCount,minimum=6){
 const values=Array.from({length:periodCount},(_,i)=>gradeText(subject.grades[i]));
 const qualitative=subject.mode==='cualitativa'||values.some(v=>v==='AP'||v==='RP');
 const marked=values.filter(v=>v!=='—');
 if(qualitative&&marked.some(v=>v!=='AP'&&v!=='RP'))fail('Evaluaciones numéricas y cualitativas sin conciliación en una misma materia.');
 if(subject.mode==='numerica'&&qualitative)fail('Resultado cualitativo en una materia numérica.');
 if(qualitative){
  // V38 institutional default: all periods AP. Pending stays pending.
  const avg=marked.length!==periodCount?null:marked.every(v=>v==='AP')?'AP':'RP';
  return {mode:'cualitativa',avg,registered:marked.length,pending:periodCount-marked.length,failed:avg==='RP',numeric:[]};
 }
 const numeric=marked.map(Number),avg=numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:null;
 return {mode:'numerica',avg,registered:marked.length,pending:periodCount-marked.length,failed:avg!==null&&avg<minimum,numeric};
}
export function mixedGradeSummary(subjects,periodCount,minimum=6){
 if(!Number.isInteger(periodCount)||periodCount<1||periodCount>6||!Number.isInteger(minimum)||minimum<1||minimum>10)fail('Periodos o mínima inválidos.');
 const summaries=subjects.map(s=>subjectGradeSummary(s,periodCount,minimum));
 const numeric=summaries.flatMap(s=>s.numeric),registered=summaries.reduce((n,s)=>n+s.registered,0),pending=summaries.reduce((n,s)=>n+s.pending,0),failed=summaries.filter(s=>s.failed).length;
 return {summaries,overall:numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:null,failed,status:!registered?'Sin evaluar':pending?'En curso':failed?'En revisión':'Evaluado'};
}
export function averageText(value,digits=1,minimum=6){
 if(value==null)return '—';
 if(value==='AP'||value==='RP')return value;
 // The average is a derived display value, not the stored grade of a period.
 const n=gradeNumber(value);if(n==null)return '—';let rounded=n.toFixed(digits);if(n<minimum&&Number(rounded)>=minimum){for(let d=digits+1;d<=15;d++){rounded=n.toFixed(d);if(Number(rounded)<minimum)return rounded;}return String(n);}return rounded;
}
export async function projectedMarks(admin,rows){
 if(!rows.length)return rows;
 const result=[];
 for(let i=0;i<rows.length;i+=200){
  const slice=rows.slice(i,i+200),ids=slice.map(r=>String(r.id));
  if(ids.some(id=>!/^\d+$/.test(id)))fail('Identificador de calificación inválido.');
  const {data,error}=await admin.rpc('jaguar360_presentacion_notas',{p_ids:ids});
  if(error||!Array.isArray(data)||data.length!==slice.length)throw Object.assign(Error('No se pudo consultar el modo de evaluación de las notas.'),{status:503});
  const byId=new Map(data.map(r=>[r.id,r]));
  for(const row of slice){const p=byId.get(String(row.id));if(!p)fail('Calificación modificada durante la consulta.');
   const valor=p.valor===null?null:gradeText(p.valor);result.push({...row,calificacion:valor==='AP'||valor==='RP'?valor:valor==null?null:Number(valor),calificacion_visible:valor,modo_evaluacion:p.modo});}
 }
 return result;
}
