/**
 * Cierre docente desde la columna VALOR TOTAL del Excel institucional.
 * IMPORTANTE: las columnas de aspectos ya expresan puntos de su ponderación
 * (50% = máximo 5 puntos). NO volver a multiplicarlas por porcentajes.
 */
export function buildExcelGradeRows({students,components,rows,rubric,gmId,periodoId,teacherId,now}) {
  if (!Array.isArray(rows) || !Array.isArray(students) || !Array.isArray(components) || !rubric) {
    throw new Error('La carga de Excel no contiene una rúbrica o alumnos válidos.');
  }
  const sumWeight=components.reduce((n,c)=>n+Number(c.ponderacion||0),0);
  if(!components.length||Math.abs(sumWeight-100)>0.001)throw new Error('La rúbrica oficial debe sumar 100%.');
  if(rows.length!==students.length)throw new Error(`El Excel debe incluir exactamente ${students.length} alumnos, sin omisiones.`);
  const byStudent=new Map(students.map(x=>[String(x.id),x]));
  const componentMap=new Map(components.map(c=>[String(c.id),c]));
  const seen=new Set();
  const detail=[];const gradeRows=[];
  for(const row of rows){
    const key=String(row?.alumno_id||'');
    const st=byStudent.get(key);
    if(!st)throw new Error('Se detectó una matrícula que no pertenece a este grupo.');
    if(seen.has(key))throw new Error(`El alumno ${st.matricula} aparece más de una vez en el Excel.`);
    seen.add(key);
    if(row.valor_total===''||row.valor_total==null || !Number.isFinite(Number(row.valor_total)))throw new Error(`No hay VALOR TOTAL numérico para ${st.matricula}. Abre el Excel, recalcula y guarda.`);
    const total=Number(row.valor_total);
    if(total<0||total>10)throw new Error(`VALOR TOTAL fuera de 0–10 para ${st.matricula}.`);
    const entries=Array.isArray(row.aspectos)?row.aspectos:[];
    if(entries.length!==components.length)throw new Error(`Faltan aspectos de rúbrica de ${st.matricula}.`);
    const used=new Set();const activities=[];
    for(const e of entries){
      const id=String(e?.componente_id||'');const c=componentMap.get(id);
      if(!c||used.has(id))throw new Error(`Aspecto duplicado o desconocido de ${st.matricula}.`);
      used.add(id);
      if(e.valor===''||e.valor==null||!Number.isFinite(Number(e.valor)))throw new Error(`Falta el valor de ${c.nombre} para ${st.matricula}.`);
      const points=Number(e.valor),max=Number(c.ponderacion)/10;
      if(points<0||points>max+0.001)throw new Error(`${c.nombre} de ${st.matricula} debe estar entre 0 y ${max} puntos.`);
      activities.push({componente_id:c.id,nombre:c.nombre,puntos_obtenidos:points,maximo_puntos:max,ponderacion:Number(c.ponderacion),valor:points,unidad:'puntos_ponderados_excel'});
    }
    const snapshot={rubrica_id:rubric.id,version:rubric.version||1,periodo_id:Number(periodoId),fuente:'excel_valor_total',modo_calculo:'formula_del_docente',valor_total_excel:total,actividades:activities,calificacion:total,calculado_en:now||new Date().toISOString()};
    detail.push({alumno_id:st.id,nombre_completo:st.nombre_completo,matricula:st.matricula,calificacion:total,snapshot});
    gradeRows.push({alumno_id:st.id,grupo_materia_id:Number(gmId),periodo_id:Number(periodoId),docente_id:Number(teacherId),calificacion:total,observaciones:'Calificación registrada desde VALOR TOTAL de Excel docente.',rubrica_id:rubric.id,calificacion_calculada:total,detalle_evaluacion:snapshot});
  }
  return {detail,gradeRows};
}
