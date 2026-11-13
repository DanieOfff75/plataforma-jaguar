/** Política académica del ciclo: calificación final, sin modificar la evidencia. */
export const DEFAULT_ALLOW_DECIMALS=false;
export const DECIMAL_PLACES_WHEN_ENABLED=1;
export function finalizeGrade(value,{permite_decimales=false}={}){
  if(value===null||value===undefined||value==='') return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>10+1e-8) throw Error('La calificación debe estar entre 0 y 10.');
  const digits=permite_decimales?DECIMAL_PLACES_WHEN_ENABLED:0;
  // Redondeo decimal half-up para notas no negativas, coherente con REDONDEAR de Excel.
  // EPSILON adaptativa evita 9.499999999999998 producidos por sumas flotantes.
  const scale=10**digits;
  return Math.min(10,Math.floor((n+1e-10)*scale+0.5)/scale);
}
export function displayFinalGrade(value,policy={}){
  const v=finalizeGrade(value,policy);
  return v===null?'—':policy.permite_decimales?v.toFixed(1):String(v);
}
export function gradePolicyFromRow(row){
  return {permite_decimales:row?.permite_decimales===true,version:Number(row?.version||0),ciclo_escolar:row?.ciclo_escolar||null};
}
