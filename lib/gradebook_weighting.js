/**
 * Jaguar · Cálculo de bitácora histórica (nunca modifica el snapshot).
 * La rúbrica oficial y el motor de cierre trabajan con notas brutas 0–10.
 * La bitácora puede conservar *aportes ya ponderados* (peso 70% → máx. 7).
 */
export function gradebookUnit(state={},components=[]){
  const declared=state?.meta?.unidad_ponderaciones;
  if(declared==='puntos_ponderados'||declared==='escala_0_10')return declared;
  // Compatibilidad: archivos antiguos no contienen la unidad. Se infiere UNA
  // sola vez para toda la hoja, no para cada alumno.
  for(const [key,value] of Object.entries(state?.weightedValues||{})){
    if(value==null||value==='')continue;
    const comp=components.find(c=>String(c.id)===String(key).split('|')[1]);
    if(comp&&Number(value)>Number(comp.ponderacion)/10+.001)return 'escala_0_10';
  }
  return 'puntos_ponderados';
}
/** Devuelve calificación 0–10 o null si faltan aspectos; cero es una nota válida. */
export function gradebookTotal(state={},components=[],studentId){
  if(!components.length)return null;
  const unit=gradebookUnit(state,components);
  let total=0;
  for(const c of components){
    const v=state.weightedValues?.[`${studentId}|${c.id}`];
    if(v==null||v==='')return null;
    const n=Number(v),weight=Number(c.ponderacion);
    if(!Number.isFinite(n)||!Number.isFinite(weight)||weight<0||weight>100||n<0||n>10)return null;
    if(unit==='puntos_ponderados'){
      if(n>weight/10+.001)return null;
      total+=n;
    }else total+=n*weight/100;
  }
  return Math.round((total+Number.EPSILON)*1000000)/1000000;
}
export function gradebookToRubricNote(value,component,unit){
  if(value==null||value==='')return null;
  const n=Number(value),weight=Number(component?.ponderacion);
  if(!Number.isFinite(n)||n<0||n>10||!Number.isFinite(weight)||weight<=0)
    throw Error('Nota o porcentaje de rúbrica inválido.');
  if(unit==='puntos_ponderados'){
    if(n>weight/10+.001)throw Error(`El aporte de ${component?.nombre||'rúbrica'} supera ${weight/10} puntos.`);
    return Math.round((n*100/weight)*100000)/100000;
  }
  return n;
}
