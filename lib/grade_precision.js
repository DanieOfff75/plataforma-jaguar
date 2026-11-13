/** Política institucional de calificaciones oficiales, sin mutar el valor fuente. */
export const DEFAULT_ALLOW_DECIMALS=false;
export const DECIMAL_PLACES_WHEN_ENABLED=1;
export const DEFAULT_MINIMA_APROBATORIA=6;
export const DEFAULT_PERMITIR_REPROBATORIAS_INFERIORES=true;

export function gradePolicyFromRow(row){
  const threshold=Number(row?.minima_aprobatoria??DEFAULT_MINIMA_APROBATORIA);
  return {
    permite_decimales:row?.permite_decimales===true,
    minima_aprobatoria:Number.isInteger(threshold)&&threshold>=1&&threshold<=10?threshold:DEFAULT_MINIMA_APROBATORIA,
    permitir_reprobatorias_inferiores:row?.permitir_reprobatorias_inferiores!==false,
    version:Number(row?.version||0),ciclo_escolar:row?.ciclo_escolar||null
  };
}

export function gradeStatus(raw,policy={}){
  if(raw===null||raw===undefined||raw==='')return null;
  const n=Number(raw);
  if(!Number.isFinite(n)||n<0||n>10+1e-8)throw Error('La calificación debe estar entre 0 y 10.');
  const minima=gradePolicyFromRow(policy).minima_aprobatoria;
  return n<minima?'Reprobado':'Aprobado';
}

export function finalizeGrade(value,policy={}){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>10+1e-8)throw Error('La calificación debe estar entre 0 y 10.');
  const p=gradePolicyFromRow(policy),digits=p.permite_decimales?DECIMAL_PLACES_WHEN_ENABLED:0,scale=10**digits;
  // La condición de aprobación se determina sobre la nota ORIGINAL.
  // Nunca permitir que el redondeo de 5.5/5.96 convierta una reprobación en 6.
  const passing=n>=p.minima_aprobatoria;
  let result=Math.min(10,Math.floor((n+1e-10)*scale+0.5)/scale);
  if(!passing){
    const maxFail=p.minima_aprobatoria-1/scale;
    result=Math.min(result,maxFail);
    if(!p.permitir_reprobatorias_inferiores)result=Math.max(result,p.minima_aprobatoria-1);
  }
  return Number(result.toFixed(digits));
}
export function displayFinalGrade(value,policy={}){
  const v=finalizeGrade(value,policy);
  return v===null?'—':policy.permite_decimales?v.toFixed(1):String(v);
}

const STATUS_PREFIX='REPROBADO. ';
/** Sólo cambia la etiqueta institucional, preservando observaciones docentes. */
export function gradeObservations(raw,existing='',policy={}){
  let note=String(existing||'').trim();
  if(note.toUpperCase().startsWith(STATUS_PREFIX.trim()))note=note.slice(STATUS_PREFIX.length).trim();
  return gradeStatus(raw,policy)==='Reprobado'?`${STATUS_PREFIX}${note}`.trim():note;
}
