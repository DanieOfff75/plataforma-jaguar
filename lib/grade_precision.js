import {ordinaryGrade} from './jaguar360_grade_policy.js';
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
    version:Number(row?.version||0),ciclo_escolar:row?.ciclo_escolar||null,
    ...(row?.redondeo_ordinario==='truncate'?{redondeo_ordinario:'truncate'}:{})
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
  const p=gradePolicyFromRow(policy);
  // Ordinary legacy contract: int/one decimal; exact decimal calculation matches SQL numeric round.
  return ordinaryGrade(Math.min(n,10),{minimum:p.minima_aprobatoria,precision:p.permite_decimales?DECIMAL_PLACES_WHEN_ENABLED:0,ordinaryRounding:p.redondeo_ordinario||'nearest',floor:!p.permitir_reprobatorias_inferiores});
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
