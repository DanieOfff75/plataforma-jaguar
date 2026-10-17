/** Normaliza y valida el periodo antes de llegar a Supabase.
 * El ciclo no se toma del navegador: siempre se impone el ciclo activo del servidor.
 */
export function normalizeNewPeriod(raw,activeCycle){
  const cycle=String(activeCycle||'').trim();
  const match=/^(\d{4})-(\d{4})$/.exec(cycle);
  if(!match||Number(match[2])!==Number(match[1])+1){
    throw Object.assign(new Error('No existe un ciclo escolar activo válido. Configura primero el ciclo desde Control Escolar.'),{status:409});
  }
  const requested=String(raw?.ciclo_escolar||'').trim();
  if(requested&&requested!==cycle){
    throw Object.assign(new Error(`El periodo sólo puede registrarse en el ciclo activo ${cycle}.`),{status:409});
  }
  const nombre=String(raw?.nombre||'').trim().slice(0,180);
  if(!nombre)throw Object.assign(new Error('Escribe el nombre del periodo.'),{status:400});
  const numero=Number(raw?.numero_periodo);
  if(!Number.isInteger(numero)||numero<1||numero>100){
    throw Object.assign(new Error('El número de periodo debe ser un entero entre 1 y 100.'),{status:400});
  }
  const dates={};
  for(const key of ['fecha_inicio','fecha_fin']){
    const value=String(raw?.[key]||'').trim();
    if(!value){dates[key]=null;continue;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value){
      throw Object.assign(new Error(`La fecha ${key==='fecha_inicio'?'de inicio':'de fin'} no es válida.`),{status:400});
    }
    dates[key]=value;
  }
  if(dates.fecha_inicio&&dates.fecha_fin&&dates.fecha_fin<dates.fecha_inicio){
    throw Object.assign(new Error('La fecha final no puede ser anterior a la fecha de inicio.'),{status:400});
  }
  return {nombre,ciclo_escolar:cycle,numero_periodo:numero,...dates,activo:true,es_periodo_actual:false};
}
