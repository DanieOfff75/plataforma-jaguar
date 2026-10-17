/** Consulta institucional por grupo > periodo > materia.
 * Toda lectura se limita a perfiles autorizados desde la ruta que invoca estas funciones.
 * No se recalculan ni editan calificaciones oficiales.
 */
export const GRADE_EXPLORER_ROLES=Object.freeze(['control_escolar','control','direccion_escolar']);
const bad=(msg,status=400)=>Object.assign(new Error(msg),{status});
const numberId=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:0;};
export function allowGradeExplorer(role){return GRADE_EXPLORER_ROLES.includes(role);}
function requireGradeExplorer(role){if(!allowGradeExplorer(role))throw bad('Este perfil no puede consultar calificaciones de otros grupos.',403);}

export async function academicGradesNavigation(admin,role){
  requireGradeExplorer(role);
  const [gQ,pQ,mQ]=await Promise.all([
    admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('activo',true).order('grado').order('letra'),
    admin.from('periodos_escolares').select('id,nombre,numero_periodo,ciclo_escolar,activo,es_periodo_actual').order('ciclo_escolar',{ascending:false}).order('numero_periodo'),
    admin.from('grupo_materias').select('id,grupo_id,materia_id,materias(id,nombre,clave)').limit(5000)
  ]);
  for(const q of [gQ,pQ,mQ])if(q.error)throw q.error;
  const groups=(gQ.data||[]).filter(g=>Number(g.grado)>=1&&Number(g.grado)<=3);
  const valid=new Set(groups.map(g=>Number(g.id)));
  const subjects=(mQ.data||[]).filter(m=>valid.has(Number(m.grupo_id))).map(m=>({id:m.id,grupo_id:m.grupo_id,materia_id:m.materia_id,nombre:m.materias?.nombre||'Materia sin nombre',clave:m.materias?.clave||''}));
  return {groups,periods:pQ.data||[],subjects};
}

export async function academicGradeDetail(admin,role,{grupo_id,periodo_id,grupo_materia_id}={}){
  requireGradeExplorer(role);
  const gid=numberId(grupo_id),pid=numberId(periodo_id),mid=numberId(grupo_materia_id);
  if(!gid||!pid||!mid)throw bad('Selecciona un grupo, periodo y materia válidos.');
  const [gQ,pQ,mQ]=await Promise.all([
    admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',gid).maybeSingle(),
    admin.from('periodos_escolares').select('id,nombre,numero_periodo,ciclo_escolar').eq('id',pid).maybeSingle(),
    admin.from('grupo_materias').select('id,grupo_id,materia_id,materias(id,nombre,clave)').eq('id',mid).maybeSingle()
  ]);
  for(const q of [gQ,pQ,mQ])if(q.error)throw q.error;
  if(!gQ.data?.activo||!pQ.data||!mQ.data||Number(mQ.data.grupo_id)!==gid)throw bad('La materia no corresponde al grupo seleccionado.',404);
  const [studentsQ,gradesQ]=await Promise.all([
    admin.from('alumnos').select('id,matricula,nombre_completo,grupo_id,activo').eq('grupo_id',gid).eq('activo',true).order('nombre_completo').limit(500),
    admin.from('calificaciones').select('id,alumno_id,docente_id,grupo_materia_id,periodo_id,calificacion,observaciones,calificacion_calculada,detalle_evaluacion').eq('grupo_materia_id',mid).eq('periodo_id',pid).limit(1000)
  ]);
  for(const q of [studentsQ,gradesQ])if(q.error)throw q.error;
  const grades=new Map((gradesQ.data||[]).map(r=>[Number(r.alumno_id),r]));
  const students=(studentsQ.data||[]).map((st,i)=>{
    const gr=grades.get(Number(st.id))||null;
    const snap=gr?.detalle_evaluacion&&typeof gr.detalle_evaluacion==='object'?gr.detalle_evaluacion:null;
    const components=Array.isArray(snap?.actividades)?snap.actividades.map(c=>({
      nombre:String(c.nombre||'Aspecto'),valor:c.puntos_obtenidos??c.valor??null,
      maximo:c.maximo_puntos??null,ponderacion:c.ponderacion??null,
      unidad:c.unidad|| (snap.fuente==='excel_valor_total'?'puntos_ponderados_excel':'escala_10')
    })):[];
    return {numero:i+1,id:st.id,matricula:st.matricula,nombre_completo:st.nombre_completo,
      calificacion_id:gr?.id??null,calificacion:gr?.calificacion??null,
      calificacion_calculada:gr?.calificacion_calculada??null,
      observaciones:gr?.observaciones||null,
      componentes:components,
      fuente:snap?.fuente|| (snap?'rubrica':'sin_desglose'),
      valor_total_excel:snap?.valor_total_excel??null,
      ajuste:snap?.ajuste||null};
  });
  return {grupo:gQ.data,periodo:pQ.data,materia:{id:mQ.data.id,nombre:mQ.data.materias?.nombre||'Materia',clave:mQ.data.materias?.clave||''},students,
    totals:{total:students.length,registered:students.filter(s=>s.calificacion!==null).length,pending:students.filter(s=>s.calificacion===null).length}};
}
