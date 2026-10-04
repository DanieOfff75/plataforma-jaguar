import crypto from 'node:crypto';
import { getClients, requireRoles } from '../lib/_admin.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { departmentKeyForRole, validateResponsible, listResponsibleUsers } from './responsables.js';
import { audit } from '../lib/audit.js';
import { getInstitution } from './institution.js';
import { registerVerifiableDocument, qrPng, deleteVerifiableDocument } from './documentos.js';
import { buildOfficialPdf } from '../lib/documentos_oficiales_pdf.js';

const resources = {
  groups: 'grupos',
  teachers: 'docentes',
  students: 'alumnos',
  subjects: 'materias',
  groupSubjects: 'grupo_materias',
  assignments: 'asignaciones_docentes',
  periods: 'periodos_escolares',
  schedules: 'horarios',
  workshops: 'talleres',
  workshopEnrollments: 'inscripciones_talleres',
  grades: 'calificaciones',
  attendance: 'asistencias',
  notices: 'avisos',
  incidencias: 'incidencias_prefectura'
};

const allAdmin = [
  'direccion_escolar',
  'control_escolar',
  'control'
];

const academic = [
  'direccion_escolar',
  'control_escolar',
  'control',
  'servicios_docentes',
  'coordinacion_academica'
];

const studentServices = [
  'direccion_escolar',
  'control_escolar',
  'control',
  'servicios_estudiantiles'
];

const archiveManagers = ['archivo_escolar'];
const archiveAcademics = ['archivo_escolar'];

const noticeWriters = [
  'direccion_escolar',
  'control_escolar',
  'control',
  'servicios_docentes',
  'servicios_estudiantiles',
  'prefectura',
  'coordinacion_academica',
  'docente'
];


async function institutionalDomain(admin){
  const inst=await getInstitution(admin);
  return String(inst?.dominio_institucional||'ithla.edu.mx').trim().replace(/^@/,'').toLowerCase();
}
async function institutionalEmail(admin,matricula){
  const domain=await institutionalDomain(admin);
  return `${String(matricula||'').replace(/\s+/g,'').toLowerCase()}@${domain}`;
}

async function activeCycle(admin){
  try{
    const {data,error}=await admin.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1).maybeSingle();
    if(!error && data?.ciclo_escolar) return data.ciclo_escolar;
  }catch{}
  const legacy=await admin.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle();
  return legacy.data?.ciclo_escolar||'2026-2027';
}

async function academicContext(admin){
  const cycle=await activeCycle(admin);
  const {data:periods,error}=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,fecha_inicio,fecha_fin,activo,numero_periodo,es_periodo_actual').eq('ciclo_escolar',cycle).order('numero_periodo',{ascending:true}).order('id',{ascending:true});
  if(error) throw error;
  const rows=periods||[];
  const current=rows.find(p=>p.es_periodo_actual===true) || rows.find(p=>p.activo!==false) || rows[0] || null;
  return {
    ciclo_escolar: cycle,
    periodo_actual: current,
    numero_periodo_actual: current?.numero_periodo||null,
    total_periodos: rows.length,
    periodos: rows
  };
}

function parseCycle(cycle){
  const m=String(cycle||'').trim().match(/^(\d{4})-(\d{4})$/);
  if(!m) throw Object.assign(new Error('El ciclo escolar debe tener formato AAAA-AAAA, por ejemplo 2027-2028.'),{status:400});
  const a=Number(m[1]),b=Number(m[2]);
  if(b!==a+1) throw Object.assign(new Error('El ciclo escolar debe abarcar dos años consecutivos.'),{status:400});
  return {start:a,end:b};
}

async function advanceSchoolCycle(admin,user,newCycle,actorRole='control_escolar'){
  const {start}=parseCycle(newCycle);
  const current=await activeCycle(admin);
  const {start:currentStart}=parseCycle(current);
  if(start!==currentStart+1) throw Object.assign(new Error(`Solo se puede avanzar del ciclo ${current} al siguiente ciclo consecutivo.`),{status:409});
  const {data:existingOp}=await admin.from('ciclos_escolares_operaciones').select('id,estado,nuevo_ciclo').eq('estado','aplicada').order('id',{ascending:false}).limit(1).maybeSingle();
  if(existingOp?.nuevo_ciclo===newCycle) throw Object.assign(new Error(`El ciclo ${newCycle} ya fue aplicado.`),{status:409});
  const {data:currentPeriodRow,error:cpe}=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,fecha_inicio,fecha_fin,numero_periodo,es_periodo_actual,activo').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1).maybeSingle();
  if(cpe) throw cpe;
  const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('activo',true).order('grado').order('letra');
  if(ge) throw ge;
  const activeGroups=(groups||[]).filter(g=>[1,2,3].includes(Number(g.grado)));
  if(!activeGroups.length) throw Object.assign(new Error('No hay grupos activos de 1° a 3° para avanzar el ciclo escolar.'),{status:409});

  // Primero se crean TODOS los grupos nuevos con claves temporales válidas.
  // Esto evita reutilizar accidentalmente un grupo 1A/1B/2A existente y permite
  // que la operación pueda revertirse eliminando únicamente los IDs que creó.
  const tempPrefix=`__CICLO_${newCycle.replace(/[^0-9-]/g,'')}_${Date.now()}`;
  const byGrade={1:[],2:[],3:[]};
  for(const g of activeGroups) byGrade[g.grado].push(g);
  const newGroupMap=new Map();
  const operationCreatedGroupIds=[];
  const createdGroupIds=[];
  let operationId=null;
  let snapshotForRecovery=null;
  let newPeriodId=null;
  try{
    for(const g of activeGroups){
      if(Number(g.grado)>=3) continue;
      const nextGrade=Number(g.grado)+1;
      const {data:created,error:ne}=await admin.from('grupos').insert({clave:`${tempPrefix}_${nextGrade}${g.letra||''}`,grado:nextGrade,letra:g.letra,turno:g.turno,activo:true}).select('*').single();
      if(ne) throw ne;
      if(!created) throw new Error(`No se pudo crear el grupo destino de ${g.clave}.`);
      newGroupMap.set(g.id,created);
      operationCreatedGroupIds.push(Number(created.id));
      createdGroupIds.push(Number(created.id));
    }

    const letters=[...new Set(activeGroups.map(g=>g.letra).filter(Boolean))].sort();
    if(!letters.length) letters.push('A','B','C','D','E','F');
    const shiftByLetter=new Map(activeGroups.map(g=>[String(g.letra),g.turno]));
    const newFirstGroups=[];
    for(const letter of letters){
      const turno=shiftByLetter.get(String(letter))||'Matutino';
      const {data:created,error:ce}=await admin.from('grupos').insert({clave:`${tempPrefix}_1${letter}`,grado:1,letra:letter,turno,activo:true}).select('*').single();
      if(ce) throw ce;
      if(!created) throw new Error(`No se pudo crear el nuevo grupo 1${letter}.`);
      newFirstGroups.push(created);
      operationCreatedGroupIds.push(Number(created.id));
      createdGroupIds.push(Number(created.id));
    }

    // Copiar materias mientras los grupos nuevos todavía conservan sus IDs estables.
    for(const [oldId,newG] of newGroupMap.entries()){
      const {data:gms,error:gmErr}=await admin.from('grupo_materias').select('materia_id,horas_semana,activo').eq('grupo_id',oldId);
      if(gmErr) throw gmErr;
      for(const gm of gms||[]){
        const {error:ie}=await admin.from('grupo_materias').upsert({grupo_id:newG.id,materia_id:gm.materia_id,horas_semana:gm.horas_semana,activo:true},{onConflict:'grupo_id,materia_id'});
        if(ie) throw ie;
      }
    }
    const template=byGrade[1][0];
    if(template){
      const {data:gms,error:gmErr}=await admin.from('grupo_materias').select('materia_id,horas_semana,activo').eq('grupo_id',template.id);
      if(gmErr) throw gmErr;
      for(const ng of newFirstGroups) for(const gm of gms||[]){
        const {error:ie}=await admin.from('grupo_materias').upsert({grupo_id:ng.id,materia_id:gm.materia_id,horas_semana:gm.horas_semana,activo:true},{onConflict:'grupo_id,materia_id'});
        if(ie) throw ie;
      }
    }

    const {data:students,error:se}=await admin.from('alumnos').select('id,grupo_id,grado_ingreso,turno,activo,estado_escolar').eq('activo',true);
    if(se) throw se;
    const snapshot={current_cycle:current,current_period:currentPeriodRow||null,current_period_id:currentPeriodRow?.id||null,groups:activeGroups,students:students||[]};
    snapshotForRecovery=snapshot;
    const {data:op,error:ope}=await admin.from('ciclos_escolares_operaciones').insert({ciclo_anterior:current,nuevo_ciclo:newCycle,estado:'aplicando',snapshot,grupos_nuevos:createdGroupIds}).select('id').single();
    if(ope) throw ope;
    operationId=op.id;

    for(const st of students||[]){
      const g=activeGroups.find(x=>Number(x.id)===Number(st.grupo_id));
      if(!g) continue;
      if(Number(g.grado)===3){
        const {error:ue}=await admin.from('alumnos').update({activo:false,grupo_id:null,estado_escolar:'egresado'}).eq('id',st.id);
        if(ue) throw ue;
      }else{
        const ng=newGroupMap.get(g.id);
        if(!ng) throw new Error(`No se encontró el grupo destino para ${g.clave}.`);
        const {error:ue}=await admin.from('alumnos').update({grupo_id:ng.id,grado_ingreso:Number(ng.grado),turno:ng.turno||null,estado_escolar:'activo'}).eq('id',st.id);
        if(ue) throw ue;
      }
    }

    // Solo después de crear y preparar los destinos se desactivan los grupos viejos.
    for(const g of activeGroups){
      const {error:ue}=await admin.from('grupos').update({activo:false}).eq('id',g.id);
      if(ue) throw ue;
    }
    for(const [oldId,newG] of newGroupMap.entries()){
      const oldG=activeGroups.find(g=>Number(g.id)===Number(oldId));
      if(oldG){
        const {error:ue}=await admin.from('grupos').update({clave:`${Number(oldG.grado)+1}${oldG.letra||''}`}).eq('id',newG.id);
        if(ue) throw ue;
      }
    }
    for(const ng of newFirstGroups){
      const letter=String(ng.letra||'');
      const {error:ue}=await admin.from('grupos').update({clave:`1${letter}`}).eq('id',ng.id);
      if(ue) throw ue;
    }

    const {error:de}=await admin.from('periodos_escolares').update({es_periodo_actual:false}).eq('es_periodo_actual',true);
    if(de) throw de;
    const {data:period,error:pe}=await admin.from('periodos_escolares').insert({nombre:'Periodo 1',ciclo_escolar:newCycle,numero_periodo:1,es_periodo_actual:true,fecha_inicio:`${start}-08-01`,fecha_fin:`${start+1}-07-31`,activo:true}).select('*').single();
    if(pe) throw pe;
    newPeriodId=period.id;
    const {error:ou}=await admin.from('ciclos_escolares_operaciones').update({estado:'aplicada',periodo_nuevo_id:period.id,grupos_nuevos:createdGroupIds}).eq('id',op.id);
    if(ou) throw ou;
    const result={operation_id:op.id,current_cycle:current,new_cycle:newCycle,period,promoted:(students||[]).filter(st=>{const g=activeGroups.find(x=>Number(x.id)===Number(st.grupo_id));return g&&Number(g.grado)<3;}).length,graduated:(students||[]).filter(st=>{const g=activeGroups.find(x=>Number(x.id)===Number(st.grupo_id));return g&&Number(g.grado)===3;}).length,new_first_groups:newFirstGroups.map(g=>g.clave),preserved_periods:true}; await audit(admin,{userId:user.id,role:actorRole,action:'avance_ciclo',module:'ciclo_escolar',entity:'periodos_escolares',entityId:period.id,description:`Avance de ciclo ${current} a ${newCycle}.`,before:{ciclo:current},after:{ciclo:newCycle,operation_id:op.id},req:null}); return result;
  }catch(err){
    // Compensación: si el avance falla antes de quedar aplicado, primero restaura
    // alumnos y grupos del snapshot y después elimina únicamente lo creado por esta operación.
    // Esto evita dejar alumnos apuntando a grupos temporales o un ciclo a medias.
    if(snapshotForRecovery){
      for(const st of (snapshotForRecovery.students||[])){
        try{await admin.from('alumnos').update({grupo_id:st.grupo_id,grado_ingreso:st.grado_ingreso,turno:st.turno,activo:st.activo,estado_escolar:st.estado_escolar||'activo'}).eq('id',st.id);}catch{}
      }
      for(const g of (snapshotForRecovery.groups||[])){
        try{await admin.from('grupos').update({clave:g.clave,grado:g.grado,letra:g.letra,turno:g.turno,activo:g.activo}).eq('id',g.id);}catch{}
      }
    }
    if(newPeriodId){try{await admin.from('periodos_escolares').delete().eq('id',newPeriodId);}catch{}}
    if(operationId){try{await admin.from('ciclos_escolares_operaciones').delete().eq('id',operationId);}catch{}}
    if(createdGroupIds.length){
      try{await admin.from('grupo_materias').delete().in('grupo_id',createdGroupIds);}catch{}
      try{await admin.from('grupos').delete().in('id',createdGroupIds);}catch{}
    }
    // Si el cambio de ciclo falló después de marcar el nuevo periodo, restauramos la marca del periodo anterior.
    try{
      await admin.from('periodos_escolares').update({es_periodo_actual:false}).eq('es_periodo_actual',true);
      if(snapshotForRecovery?.current_period_id) await admin.from('periodos_escolares').update({es_periodo_actual:true}).eq('id',snapshotForRecovery.current_period_id);
    }catch{}
    throw err;
  }
}

async function revertSchoolCycle(admin,user,actorRole='control_escolar'){
  const {data:op,error:oe}=await admin.from('ciclos_escolares_operaciones').select('*').eq('estado','aplicada').order('id',{ascending:false}).limit(1).maybeSingle();
  if(oe) throw oe;
  if(!op) throw Object.assign(new Error('No existe un avance de ciclo que pueda revertirse.'),{status:404});
  const snap=op.snapshot||{};
  if(!snap.current_cycle) throw Object.assign(new Error('El respaldo del ciclo no está disponible.'),{status:409});
  const createdIds=Array.isArray(op.grupos_nuevos)?op.grupos_nuevos.map(Number).filter(Boolean):[];

  // Primero se retiran los grupos creados por ESTA operación.
  // Es indispensable hacerlo antes de reactivar los grupos históricos, porque
  // ambos pueden tener claves como 1A/2A/3A y existe una clave única entre
  // grupos activos. Los alumnos todavía apuntan a los grupos nuevos, pero sus
  // referencias se restauran inmediatamente después de eliminarlos, antes de
  // que el flujo termine.
  if(createdIds.length){
    const {error:gm}=await admin.from('grupo_materias').delete().in('grupo_id',createdIds);
    if(gm) throw gm;
    const {error:gd}=await admin.from('grupos').delete().in('id',createdIds);
    if(gd) throw gd;
  }

  // Ahora sí se restauran los grupos históricos y los alumnos a su snapshot.
  for(const g of (snap.groups||[])){
    const {error:ge}=await admin.from('grupos').update({clave:g.clave,grado:g.grado,letra:g.letra,turno:g.turno,activo:g.activo}).eq('id',g.id);
    if(ge) throw ge;
  }
  for(const st of (snap.students||[])){
    const {error:se}=await admin.from('alumnos').update({grupo_id:st.grupo_id,grado_ingreso:st.grado_ingreso,turno:st.turno,activo:st.activo,estado_escolar:st.estado_escolar||'activo'}).eq('id',st.id);
    if(se) throw se;
  }

  // El periodo nuevo se elimina y se restaura el periodo que era actual antes del avance.
  if(op.periodo_nuevo_id){
    const {error:pe}=await admin.from('periodos_escolares').delete().eq('id',op.periodo_nuevo_id);
    if(pe) throw pe;
  }
  const {error:clearCurrent}=await admin.from('periodos_escolares').update({es_periodo_actual:false}).eq('es_periodo_actual',true);
  if(clearCurrent) throw clearCurrent;
  const oldPeriodId=Number(snap.current_period_id||snap.current_period?.id||0);
  if(oldPeriodId){
    const {error:restoreCurrent}=await admin.from('periodos_escolares').update({es_periodo_actual:true}).eq('id',oldPeriodId);
    if(restoreCurrent) throw restoreCurrent;
  }else{
    const {data:oldPeriod,error:po}=await admin.from('periodos_escolares').select('id').eq('ciclo_escolar',op.ciclo_anterior).order('id',{ascending:false}).limit(1).maybeSingle();
    if(po) throw po;
    if(oldPeriod){const {error:restoreLegacy}=await admin.from('periodos_escolares').update({es_periodo_actual:true}).eq('id',oldPeriod.id);if(restoreLegacy) throw restoreLegacy;}
  }

  const {error:ou}=await admin.from('ciclos_escolares_operaciones').update({estado:'revertida',revertida_at:new Date().toISOString(),revertida_por:user.id}).eq('id',op.id);
  if(ou) throw ou;
  const result={reverted:op.nuevo_ciclo,restored_cycle:op.ciclo_anterior}; await audit(admin,{userId:user.id,role:actorRole,action:'reversion_ciclo',module:'ciclo_escolar',entity:'ciclos_escolares_operaciones',entityId:op.id,description:`Reversión del ciclo ${op.nuevo_ciclo}.`,before:{ciclo:op.nuevo_ciclo},after:{ciclo:op.ciclo_anterior,estado:'revertida'}}); return result;
}

/* =========================================================
   AUTENTICACIÓN
   ========================================================= */

async function authContext(req) {
  const { token, adminClient } = getClients(req);

  if (!token) {
    throw Object.assign(
      new Error('No autenticado.'),
      { status: 401 }
    );
  }

  const {
    data: { user },
    error
  } = await adminClient.auth.getUser(token);

  if (error || !user) {
    throw Object.assign(
      new Error('Sesión inválida.'),
      { status: 401 }
    );
  }

  const {
    data: profile,
    error: profileError
  } = await adminClient
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    throw Object.assign(
      new Error(profileError.message),
      { status: 500 }
    );
  }

  if (!profile || !profile.activo) {
    throw Object.assign(
      new Error('Perfil no disponible o inactivo.'),
      { status: 403 }
    );
  }

  return {
    user,
    profile,
    adminClient
  };
}

/* =========================================================
   UTILIDADES DE USUARIO
   ========================================================= */

async function teacherId(admin, userId) {
  const { data } = await admin
    .from('docentes')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();

  return data?.id || null;
}

async function studentId(admin, userId) {
  let {
    data
  } = await admin
    .from('alumnos')
    .select('id,grupo_id,matricula,nombre_completo')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (data) {
    return data;
  }

  const {
    data: profile
  } = await admin
    .from('perfiles')
    .select('matricula,correo')
    .eq('id', userId)
    .maybeSingle();

  const matricula =
    profile?.matricula ||
    String(profile?.correo || '').split('@')[0] ||
    null;

  if (!matricula) {
    return null;
  }

  return (
    await admin
      .from('alumnos')
      .select('id,grupo_id,matricula,nombre_completo')
      .eq('matricula', matricula)
      .maybeSingle()
  ).data || null;
}

async function groupSubjectIds(admin, groupId) {
  if (!groupId) {
    return [];
  }

  const { data } = await admin
    .from('grupo_materias')
    .select('id')
    .eq('grupo_id', groupId);

  return (data || []).map(x => x.id);
}

async function enrichStudentsWithAccounts(admin, students) {
  const rows = Array.isArray(students) ? students : [];
  if (!rows.length) return rows;

  const authIds = [...new Set(rows.map(s => s.auth_user_id).filter(Boolean))];
  const matriculas = [...new Set(rows.map(s => s.matricula).filter(Boolean))];
  const profiles = new Map();

  if (authIds.length) {
    const { data, error } = await admin
      .from('perfiles')
      .select('id,nombre_completo,correo,correo_recuperacion,correo_auth,matricula,activo')
      .in('id', authIds);
    if (error) throw error;
    for (const profile of data || []) profiles.set(`id:${profile.id}`, profile);
  }

  if (matriculas.length) {
    const { data, error } = await admin
      .from('perfiles')
      .select('id,nombre_completo,correo,correo_recuperacion,correo_auth,matricula,activo')
      .in('matricula', matriculas);
    if (error) throw error;
    for (const profile of data || []) profiles.set(`mat:${profile.matricula}`, profile);
  }

  return rows.map(student => {
    const profile =
      profiles.get(`id:${student.auth_user_id}`) ||
      profiles.get(`mat:${student.matricula}`) ||
      null;
    if (!profile) return student;
    return {
      ...student,
      correo: student.correo || profile.correo || null,
      correo_recuperacion: profile.correo_recuperacion || null,
      correo_auth: profile.correo_auth || null,
      perfil_activo: profile.activo !== false
    };
  });
}

async function getStudentOverview(admin, userId) {
  const student = await studentId(admin, userId);
  if (!student) throw Object.assign(new Error('Alumno no encontrado.'), { status: 404 });

  const cycle=await activeCycle(admin);
  const [studentQuery, grades, attendance, schedules, workshops, requests] = await Promise.all([
    admin.from('alumnos').select('*,grupos(id,clave,grado,letra,turno,hora_inicio,hora_fin)').eq('id', student.id).maybeSingle(),
    admin.from('calificaciones').select('id,calificacion,observaciones,periodo_id,grupo_materia_id,docente_id,docente:docentes(id,nombre_completo),periodos_escolares(id,nombre,ciclo_escolar),grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave))').eq('alumno_id', student.id).order('id', { ascending: false }),
    admin.from('asistencias').select('id,fecha,estado,observaciones,grupo_materia_id,docente_id,grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave))').eq('alumno_id', student.id).order('fecha', { ascending: false }).limit(500),
    admin.from('horarios').select('id,grupo_materia_id,docente_id,dia_semana,hora_inicio,hora_fin,aula,ciclo_escolar,grupo_materias!inner(grupo_id,materia_id,materias(id,nombre,clave)),docente:docentes(id,nombre_completo)').eq('grupo_materias.grupo_id', student.grupo_id).eq('ciclo_escolar', cycle).order('dia_semana').order('hora_inicio'),
    admin.from('inscripciones_talleres').select('id,taller_id,ciclo_escolar,estado,fecha_inscripcion,talleres(id,nombre,descripcion)').eq('alumno_id', student.id).order('id', { ascending: false }),
    admin.from('solicitudes_estudiantiles').select('*').eq('alumno_id', student.id).order('id', { ascending: false }).limit(50)
  ]);

  for (const q of [studentQuery, grades, attendance, schedules, workshops, requests]) if (q.error) throw q.error;
  const gmIds=[...new Set((schedules.data||[]).map(r=>Number(r.grupo_materia_id)).filter(Boolean))];
  if(gmIds.length){ const {data:as,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,docentes(id,nombre_completo)').in('grupo_materia_id',gmIds).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae; const amap=new Map((as||[]).map(a=>[String(a.grupo_materia_id),a.docentes])); for(const r of schedules.data||[]){ if(!r.docente) r.docente=amap.get(String(r.grupo_materia_id))||null; }}
  if (!studentQuery.data) throw Object.assign(new Error('Alumno no encontrado.'), { status: 404 });

  const enriched = (await enrichStudentsWithAccounts(admin, [studentQuery.data]))[0];
  const values = (grades.data || []).map(x => Number(x.calificacion)).filter(Number.isFinite);
  enriched.promedio_calculado = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  enriched.horas_clase_semana = (schedules.data || []).length;
  enriched.suspendido = Boolean(enriched.suspension_fecha || enriched.suspension_motivo);

  // Un alumno suspendido conserva solo la información necesaria para resolver su situación.
  if (enriched.suspendido) {
    return { student: enriched, grades: [], attendance: [], schedules: [], workshops: [], requests: [] };
  }

  return {
    student: enriched,
    grades: grades.data || [],
    attendance: attendance.data || [],
    schedules: schedules.data || [],
    workshops: workshops.data || [],
    requests: requests.data || []
  };
}

async function getTeacherRoster(admin, user, groupSubjectId, extra = {}) {
  const tid = await teacherId(admin, user.id);
  if (!tid) throw Object.assign(new Error('Docente no encontrado.'), { status: 404 });
  const gmId = Number(groupSubjectId || 0);
  if (!gmId) throw Object.assign(new Error('Grupo-materia no válido.'), { status: 400 });

  const { data: assignment, error: assignmentError } = await admin
    .from('asignaciones_docentes')
    .select('id,docente_id,grupo_materia_id,activo,ciclo_escolar,horas_asignadas,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))')
    .eq('docente_id', tid)
    .eq('grupo_materia_id', gmId)
    .eq('activo', true)
    .eq('ciclo_escolar', await activeCycle(admin))
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) throw Object.assign(new Error('No tienes asignado este grupo-materia.'), { status: 403 });

  const groupId = assignment.grupo_materias?.grupo_id;
  const { data: students, error: studentsError } = await admin
    .from('alumnos')
    .select('*,grupos(id,clave,grado,letra,turno)')
    .eq('grupo_id', groupId)
    .order('nombre_completo');
  if (studentsError) throw studentsError;

  const enriched = await enrichStudentsWithAccounts(admin, students || []);
  const ids = enriched.map(s => s.id);
  const result = { grupo_materia: assignment.grupo_materias, students: enriched };

  if (extra.periodo_id !== undefined) {
    const { data: grades, error } = await admin.from('calificaciones')
      .select('id,alumno_id,calificacion,observaciones,periodo_id,grupo_materia_id')
      .eq('grupo_materia_id', gmId).eq('periodo_id', Number(extra.periodo_id));
    if (error) throw error;
    const map = new Map((grades || []).map(g => [String(g.alumno_id), g]));
    result.students = enriched.map(s => ({ ...s, grade: map.get(String(s.id)) || null }));
  }

  if (extra.fecha) {
    const { data: attendance, error } = await admin.from('asistencias')
      .select('id,alumno_id,estado,observaciones,fecha,grupo_materia_id,docente_id')
      .eq('grupo_materia_id', gmId).eq('fecha', extra.fecha).eq('docente_id', tid);
    if (error) throw error;
    const map = new Map((attendance || []).map(a => [String(a.alumno_id), a]));
    result.students = enriched.map(s => ({ ...s, attendance: map.get(String(s.id)) || null }));
  }

  return result;
}


/* =========================================================
   EVALUACIÓN DOCENTE: RÚBRICA + EVIDENCIA + CIERRE
   ========================================================= */
function evaluationTeacherAllowed(role){ return role === 'docente'; }
function normalizeEvaluationItems(items){
  const rows = Array.isArray(items) ? items : [];
  return rows.map((x,i)=>{
    const ponderacion=Math.max(0,Math.min(100,Number(x.ponderacion||0)));
    const maximo=Number.isFinite(Number(x.maximo))&&Number(x.maximo)>0?Number(x.maximo):Number((ponderacion/10).toFixed(2));
    return {nombre:String(x.nombre||`Actividad ${String(i+1).padStart(2,'0')}`).trim().slice(0,160),ponderacion,maximo,orden:i+1};
  }).filter(x=>x.nombre && Number.isFinite(x.ponderacion) && Number.isFinite(x.maximo) && x.maximo>0);
}
async function getTeacherEvaluationOverview(admin,user){
  const tid=await teacherId(admin,user.id);
  if(!tid) throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const cycle=await activeCycle(admin);
  const [aQ,pQ,rQ]=await Promise.all([
    admin.from('asignaciones_docentes').select('id,docente_id,grupo_materia_id,activo,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))').eq('docente_id',tid).eq('activo',true).eq('ciclo_escolar',cycle).order('id'),
    admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').eq('ciclo_escolar',cycle).order('id'),
    admin.from('rubricas_evaluacion').select('id,docente_id,grupo_materia_id,periodo_id,titulo,estado,version,updated_at,submitted_at,grupo_materia:grupo_materias(grupos(id,clave,grado,letra,turno),materias(id,nombre,clave)),periodo:periodos_escolares(id,nombre,ciclo_escolar)').eq('docente_id',tid).order('id',{ascending:false}).limit(500)
  ]);
  for(const q of [aQ,pQ,rQ]) if(q.error) throw q.error;
  let assignments=aQ.data||[];
  if(!assignments.length){
    const fb=await admin.from('asignaciones_docentes').select('id,docente_id,grupo_materia_id,activo,ciclo_escolar,horas_asignadas,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))').eq('docente_id',tid).eq('activo',true).order('id');
    if(fb.error) throw fb.error; assignments=fb.data||[];
  }
  let periods=pQ.data||[];
  if(!periods.length){
    const fb=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').order('id');
    if(fb.error) throw fb.error; periods=fb.data||[];
  }
  const rubricMap=new Map((rQ.data||[]).map(r=>[`${r.grupo_materia_id}|${r.periodo_id}`,r]));
  return {assignments,periods,rubricas:[...rubricMap.values()]};
}
async function getTeacherEvaluation(admin,user,gmId,periodoId){
  const tid=await teacherId(admin,user.id); if(!tid) throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const roster=await getTeacherRoster(admin,user,gmId,{periodo_id:periodoId});
  const {data:rubric,error:re}=await admin.from('rubricas_evaluacion').select('*').eq('docente_id',tid).eq('grupo_materia_id',Number(gmId)).eq('periodo_id',Number(periodoId)).maybeSingle();
  if(re) throw re;
  if(!rubric) { const {data:periodo}=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar').eq('id',Number(periodoId)).maybeSingle(); return {...roster,periodo:periodo||null,rubrica:null,componentes:[],scores:[],cierre:null}; }
  const [cQ,sQ,zQ,pQ]=await Promise.all([
    admin.from('rubrica_componentes').select('*').eq('rubrica_id',rubric.id).order('orden'),
    admin.from('evaluacion_notas').select('id,rubrica_id,componente_id,alumno_id,valor,updated_at').eq('rubrica_id',rubric.id).limit(10000),
    admin.from('cierres_evaluacion').select('*').eq('rubrica_id',rubric.id).maybeSingle(),
    admin.from('periodos_escolares').select('id,nombre,ciclo_escolar').eq('id',Number(periodoId)).maybeSingle()
  ]);
  for(const q of [cQ,sQ,zQ,pQ]) if(q.error) throw q.error;
  return {...roster,periodo:pQ.data||null,rubrica:rubric,componentes:cQ.data||[],scores:sQ.data||[],cierre:zQ.data||null};
}
async function teacherOwnAssignment(admin,user,gmId,periodoId){
  const tid=await teacherId(admin,user.id);
  const {data,error}=await admin.from('asignaciones_docentes').select('id,docente_id,grupo_materia_id,activo,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))').eq('docente_id',tid).eq('grupo_materia_id',Number(gmId)).eq('activo',true).eq('ciclo_escolar',await activeCycle(admin)).maybeSingle();
  if(error) throw error;
  if(!data) throw Object.assign(new Error('No tienes asignado este grupo-materia.'),{status:403});
  return {tid,assignment:data,periodoId:Number(periodoId)};
}
async function buildEvaluationClosure(admin,user,gmId,periodoId){
  const ctx=await teacherOwnAssignment(admin,user,gmId,periodoId);
  const {data:rubric,error:re}=await admin.from('rubricas_evaluacion').select('*').eq('docente_id',ctx.tid).eq('grupo_materia_id',Number(gmId)).eq('periodo_id',Number(periodoId)).maybeSingle();
  if(re) throw re;
  if(!rubric) throw Object.assign(new Error('Primero registra la rúbrica de evaluación.'),{status:400});
  if(rubric.estado==='cerrada') throw Object.assign(new Error('Este periodo ya fue cerrado y no puede modificarse.'),{status:409});
  const [cQ,studentsQ,sQ,pQ]=await Promise.all([
    admin.from('rubrica_componentes').select('*').eq('rubrica_id',rubric.id).order('orden'),
    admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id').eq('grupo_id',ctx.assignment.grupo_materias.grupo_id).eq('activo',true).order('nombre_completo'),
    admin.from('evaluacion_notas').select('id,componente_id,alumno_id,valor').eq('rubrica_id',rubric.id).limit(20000),
    admin.from('periodos_escolares').select('id,nombre,ciclo_escolar').eq('id',Number(periodoId)).maybeSingle()
  ]);
  for(const q of [cQ,studentsQ,sQ,pQ]) if(q.error) throw q.error;
  const componentes=cQ.data||[]; const students=studentsQ.data||[]; const scores=sQ.data||[];
  const total=componentes.reduce((a,x)=>a+Number(x.ponderacion||0),0);
  if(Math.abs(total-100)>0.001) throw Object.assign(new Error(`La ponderación debe sumar exactamente 100%. Actualmente suma ${total.toFixed(2)}%.`),{status:400});
  if(!componentes.length) throw Object.assign(new Error('La rúbrica no tiene actividades.'),{status:400});
  const map=new Map(); for(const x of scores) map.set(`${x.alumno_id}|${x.componente_id}`,x);
  const detail=[]; const gradeRows=[];
  for(const st of students){
    let final=0; const activities=[];
    for(const c of componentes){
      const row=map.get(`${st.id}|${c.id}`); const value=row?.valor;
      if(value===null||value===undefined||value==='') throw Object.assign(new Error(`Falta la calificación de ${st.nombre_completo} en ${c.nombre}.`),{status:400});
      const n=Number(value); if(!Number.isFinite(n)||n<0||n>10) throw Object.assign(new Error(`La calificación de ${st.nombre_completo} en ${c.nombre} debe estar entre 0 y 10.`),{status:400});
      const maxPoints=Number(c.maximo);
      final += (n/10)*maxPoints;
      activities.push({componente_id:c.id,nombre:c.nombre,valor:n,maximo_puntos:maxPoints,ponderacion:Number(c.ponderacion)});
    }
    const rounded=Math.round(final*10)/10;
    const snapshot={rubrica_id:rubric.id,version:rubric.version||1,periodo_id:Number(periodoId),actividades:activities,calificacion:rounded,calculado_en:new Date().toISOString()};
    detail.push({alumno_id:st.id,nombre_completo:st.nombre_completo,matricula:st.matricula,calificacion:rounded,snapshot});
    gradeRows.push({alumno_id:st.id,grupo_materia_id:Number(gmId),periodo_id:Number(periodoId),docente_id:ctx.tid,calificacion:rounded,observaciones:'Calificación calculada mediante rúbrica docente.',rubrica_id:rubric.id,calificacion_calculada:rounded,detalle_evaluacion:snapshot});
  }
  return {ctx,rubric,componentes,students,detail,gradeRows,periodo:pQ.data||null,total_ponderacion:total};
}


/* =========================================================
   BITÁCORA DIARIA DE EXCEL ACADÉMICO · V2
   Tres hojas: ASISTENCIAS, ACTIVIDADES y VALORES PONDERACIÓN.
   La rúbrica oficial viene de rubricas_evaluacion; nunca se captura
   una ponderación diaria en el Excel.
   ========================================================= */
function normalizeDailyActivity(x,i){
  const nombre=String(x?.nombre||'').trim().slice(0,160);
  if(!nombre) return null;
  const key=String(x?.key||`act-${i+1}`).trim().slice(0,80);
  return {key:key||`act-${i+1}`,nombre,fecha:x?.fecha||null,orden:i+1};
}
function normalizeDailyRubric(x){
  const components=Array.isArray(x?.components)?x.components.map((c,i)=>({
    id:Number(c.id||0),nombre:String(c.nombre||`Aspecto ${i+1}`).trim().slice(0,160),
    ponderacion:Number(Number(c.ponderacion||0).toFixed(2)),maximo:Number(Number(c.maximo||10).toFixed(2)),orden:Number(c.orden||i+1)
  })).filter(c=>c.id&&c.nombre&&Number.isFinite(c.ponderacion)&&Number.isFinite(c.maximo)&&c.maximo>0):[];
  const total=components.reduce((a,c)=>a+c.ponderacion,0);
  return {id:Number(x?.id||0),version:Number(x?.version||1),titulo:String(x?.titulo||'Rúbrica de evaluación'),components,total:Number(total.toFixed(2))};
}
function normalizeDailyScores(rows){
  const out={};
  for(const r of Array.isArray(rows)?rows:[]){
    const alumnoId=String(Number(r?.alumno_id||0)); const componentId=String(Number(r?.componente_id||0));
    if(!alumnoId||alumnoId==='0'||!componentId||componentId==='0') continue;
    const v=r?.valor===''||r?.valor==null?null:Number(r.valor);
    if(v!==null&&(!Number.isFinite(v)||v<0||v>10)) throw Object.assign(new Error(`El valor de ${alumnoId} debe estar entre 0 y 10.`),{status:400});
    out[`${alumnoId}|${componentId}`]=v;
  }
  return out;
}
function stableDailyState(state){
  const legacyScores=state?.activityScores&&Object.keys(state.activityScores).length?state.activityScores:(state?.scores||{});
  return JSON.parse(JSON.stringify({
    activities:(state?.activities||[]).map((x,i)=>normalizeDailyActivity(x,i)).filter(Boolean),
    activityScores:legacyScores||{},
    weightedValues:state?.weightedValues||{},
    attendance:state?.attendance||{},
    rubric:normalizeDailyRubric(state?.rubric||{}),
    meta:{version:Number(state?.meta?.version||2),periodo_id:Number(state?.meta?.periodo_id||0),grupo_materia_id:Number(state?.meta?.grupo_materia_id||0),docente_id:Number(state?.meta?.docente_id||0)}
  }));
}
function compareDailyLocked(previous,next){
  if(!previous)return;
  const pa=previous.activities||[],na=next.activities||[];
  for(let i=0;i<pa.length;i++){
    const a=pa[i],b=na[i];
    if(!b||String(a.key)!==String(b.key)||String(a.nombre)!==String(b.nombre)) throw Object.assign(new Error(`No se permite modificar la actividad existente "${a.nombre}". Las evidencias anteriores son inmutables.`),{status:409});
  }
  for(const k of Object.keys(previous.activityScores||{})) if((previous.activityScores[k]??null)!==(next.activityScores?.[k]??null)) throw Object.assign(new Error('No se permite modificar actividades o calificaciones de días anteriores desde una nueva carga.'),{status:409});
  for(const k of Object.keys(previous.weightedValues||{})) if((previous.weightedValues[k]??null)!==(next.weightedValues?.[k]??null)) throw Object.assign(new Error('No se permite modificar valores de ponderación ya respaldados. Para corregirlos debe realizarse una corrección institucional.'),{status:409});
  for(const k of Object.keys(previous.attendance||{})) if((previous.attendance[k]??null)!==(next.attendance?.[k]??null)) throw Object.assign(new Error('No se permite modificar asistencias históricas desde el Excel.'),{status:409});
  const pr=previous.rubric||{},nr=next.rubric||{};
  if(Number(pr.id||0)&&Number(nr.id||0)&&Number(pr.id)!==Number(nr.id)) throw Object.assign(new Error('La rúbrica del archivo no corresponde a la rúbrica institucional registrada.'),{status:409});
}
async function teacherDailyContext(admin,user,gmId,periodoId){
  const ctx=await teacherOwnAssignment(admin,user,gmId,periodoId);
  const {data:period,error:pe}=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').eq('id',Number(periodoId)).maybeSingle(); if(pe) throw pe;
  if(!period) throw Object.assign(new Error('Periodo escolar no encontrado.'),{status:404});
  const gm=ctx.assignment.grupo_materias;
  const {data:teacher,error:te}=await admin.from('docentes').select('id,nombre_completo,numero_empleado,especialidad').eq('id',ctx.tid).maybeSingle(); if(te) throw te;
  const {data:color,error:ce}=await admin.from('docente_materia_colores').select('color_hex').eq('docente_id',ctx.tid).eq('materia_id',gm.materia_id).maybeSingle(); if(ce) throw ce;
  const roster=await getTeacherRoster(admin,user,gmId);
  const {data:rubric,error:re}=await admin.from('rubricas_evaluacion').select('id,titulo,version,estado,escala_maxima').eq('docente_id',ctx.tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).maybeSingle(); if(re) throw re;
  let components=[]; if(rubric){const {data:cs,error:ce2}=await admin.from('rubrica_componentes').select('id,nombre,ponderacion,maximo,orden').eq('rubrica_id',rubric.id).order('orden'); if(ce2) throw ce2; components=cs||[];}
  const {data:notes,error:ne}=rubric?await admin.from('evaluacion_notas').select('alumno_id,componente_id,valor').eq('rubrica_id',rubric.id).limit(20000):{data:[],error:null}; if(ne) throw ne;
  const {data:latest,error:le}=await admin.from('bitacora_excel_diaria').select('*').eq('docente_id',ctx.tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(le) throw le;
  const scoreSeed={}; for(const n of notes||[]) scoreSeed[`${n.alumno_id}|${n.componente_id}`]=n.valor;
  return {ctx,period,teacher:teacher||{},gm,students:roster.students||[],latest:latest||null,color_hex:color?.color_hex||'#4EA72E',rubric:rubric?{...rubric,components,total:Number((components.reduce((a,c)=>a+Number(c.ponderacion||0),0)).toFixed(2))}:null,scoreSeed};
}
async function getTeacherDailyGradebook(admin,user,gmId,periodoId,fecha){
  const d=await teacherDailyContext(admin,user,gmId,periodoId);
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(fecha||''))?String(fecha):new Date().toISOString().slice(0,10);
  const {data:attendance,error:ae}=await admin.from('asistencias').select('alumno_id,fecha,estado,observaciones').eq('grupo_materia_id',gmId).eq('docente_id',d.ctx.tid).order('fecha'); if(ae) throw ae;
  const latestState=d.latest?.snapshot||{activities:[],activityScores:{},weightedValues:d.scoreSeed||{},attendance:{},rubric:d.rubric||{},meta:{}};
  const amap=Object.fromEntries((attendance||[]).filter(x=>x.fecha===date).map(x=>[String(x.alumno_id),{estado:x.estado,observaciones:x.observaciones||null}]));
  const historyMap=new Map(); for(const a of (attendance||[])){const k=String(a.alumno_id);const obj=historyMap.get(k)||{};obj[a.fecha]=a.estado||'';historyMap.set(k,obj);}
  const students=(d.students||[]).map(s=>({...s,attendance:amap[String(s.id)]||null,attendanceHistory:historyMap.get(String(s.id))||{}}));
  return {teacher:d.teacher,grupo_materia:d.gm,periodo:d.period,fecha:date,color_hex:d.color_hex,students,attendanceDates:[...new Set((attendance||[]).map(x=>x.fecha))].sort(),latest_id:d.latest?.id||null,latest_version:d.latest?.version||0,latest_fecha:d.latest?.fecha_clase||null,rubric:d.rubric,state:stableDailyState({...latestState,rubric:d.rubric||latestState.rubric,weightedValues:Object.keys(latestState.weightedValues||{}).length?latestState.weightedValues:d.scoreSeed})};
}
async function prepareTeacherDailyUpload(admin,user,gmId,periodoId,fecha,filename){
  const d=await teacherDailyContext(admin,user,gmId,periodoId); const safe=String(filename||'calificaciones.xlsx').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100);
  const path=`${d.ctx.tid}/${periodoId}/${gmId}/${fecha}/${Date.now()}-${safe}`;
  const {data,error}=await admin.storage.from('bitacora-calificaciones').createSignedUploadUrl(path,{upsert:false}); if(error) throw error;
  return {bucket:'bitacora-calificaciones',path,token:data.token};
}
async function commitTeacherDailyUpload(admin,user,body,profile){
  const gmId=Number(body?.grupo_materia_id||0),periodoId=Number(body?.periodo_id||0),fecha=String(body?.fecha||'');
  if(!gmId||!periodoId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha)) throw Object.assign(new Error('Grupo, periodo y fecha son obligatorios.'),{status:400});
  const d=await teacherDailyContext(admin,user,gmId,periodoId); const incoming=stableDailyState(body?.state||{}); incoming.meta={...incoming.meta,periodo_id:periodoId,grupo_materia_id:gmId,docente_id:d.ctx.tid,version:2};
  if(Number(incoming.meta.grupo_materia_id)!==gmId||Number(incoming.meta.periodo_id)!==periodoId) throw Object.assign(new Error('El archivo no pertenece al grupo o periodo seleccionado.'),{status:409});
  if(d.rubric){const total=d.rubric.total;if(Math.abs(total-100)>0.001) throw Object.assign(new Error(`La rúbrica institucional debe sumar exactamente 100%. Actualmente suma ${total.toFixed(2)}%.`),{status:409}); incoming.rubric=d.rubric;}
  if(incoming.activities.length>40) throw Object.assign(new Error('El archivo no puede contener más de 40 actividades.'),{status:400});
  const latest=d.latest?.snapshot?stableDailyState(d.latest.snapshot):null; if(latest) compareDailyLocked(latest,incoming);
  const allowed=new Set((d.students||[]).map(s=>String(s.id))); for(const k of Object.keys(incoming.activityScores||{})){const [sid]=k.split('|');if(!allowed.has(String(sid))) delete incoming.activityScores[k];}
  for(const k of Object.keys(incoming.weightedValues||{})){const [sid,cid]=k.split('|');if(!allowed.has(String(sid))||!(d.rubric?.components||[]).some(c=>String(c.id)===String(cid))) delete incoming.weightedValues[k];}
  const {data:existing,error:ee}=await admin.from('bitacora_excel_diaria').select('id,version').eq('docente_id',d.ctx.tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).eq('fecha_clase',fecha).order('version',{ascending:false}).limit(1).maybeSingle(); if(ee) throw ee;
  const version=Number(existing?.version||0)+1;
  const row={docente_id:d.ctx.tid,grupo_materia_id:gmId,periodo_id:periodoId,fecha_clase:fecha,version,anterior_id:d.latest?.id||null,archivo_path:String(body?.file_path||'').startsWith(`${d.ctx.tid}/`)?String(body.file_path):null,archivo_nombre:String(body?.file_name||'').slice(0,180)||null,archivo_sha256:String(body?.file_sha256||'').slice(0,64)||null,filas:(d.students||[]).length,actividades:incoming.activities.length,ponderacion_total:Number((incoming.rubric?.total||0).toFixed(2)),snapshot:incoming,uploaded_by:user.id};
  const {data:snap,error:se}=await admin.from('bitacora_excel_diaria').insert(row).select('*').single(); if(se) throw se;
  if(existing?.id){const {error:ue}=await admin.from('bitacora_excel_diaria').update({estado:'reemplazado'}).eq('id',existing.id);if(ue) throw ue;}
  await audit(admin,{userId:user.id,role:profile?.rol||'docente',action:'upload_daily_gradebook',module:'bitacora_excel',entity:'bitacora_excel_diaria',entityId:snap.id,description:`Carga diaria ${fecha} ${d.gm?.materias?.nombre||''} ${d.gm?.grupos?.clave||''}`,after:{version,sha256:row.archivo_sha256,actividades:row.actividades,rubrica_total:row.ponderacion_total}});
  return snap;
}
async function listDailyGradebooks(admin,profile,query){
  if(!['servicios_docentes','control_escolar','control','direccion_escolar','coordinacion_academica'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
  let q=admin.from('bitacora_excel_diaria').select('id,docente_id,grupo_materia_id,periodo_id,fecha_clase,version,archivo_nombre,archivo_sha256,estado,filas,actividades,ponderacion_total,created_at,docentes(id,nombre_completo),grupo_materias(id,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave)),periodos_escolares(id,nombre,ciclo_escolar)').order('created_at',{ascending:false}).limit(500);
  if(query?.grupo_materia_id) q=q.eq('grupo_materia_id',Number(query.grupo_materia_id)); if(query?.docente_id) q=q.eq('docente_id',Number(query.docente_id)); if(query?.periodo_id) q=q.eq('periodo_id',Number(query.periodo_id));
  const {data,error}=await q;if(error)throw error;return data||[];
}
async function getDailyGradebookSnapshot(admin,user,profile,id){
  if(!['servicios_docentes','control_escolar','control','direccion_escolar','coordinacion_academica','docente'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
  const {data,error}=await admin.from('bitacora_excel_diaria').select('*,docentes(id,nombre_completo,numero_empleado),grupo_materias(id,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave)),periodos_escolares(id,nombre,ciclo_escolar)').eq('id',Number(id)).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Respaldo no encontrado.'),{status:404});
  if(profile.rol==='docente'){const tid=await teacherId(admin,user.id);if(Number(data.docente_id)!==Number(tid))throw Object.assign(new Error('No autorizado.'),{status:403});}
  return data;
}


/* =========================================================
   DASHBOARD
   ========================================================= */

async function dashboard(admin, profile, user) {
  const names = [
    'alumnos',
    'docentes',
    'grupos',
    'materias',
    'talleres',
    'avisos',
    'incidencias_prefectura',
    'solicitudes_estudiantiles'
  ];

  const counts = {};

  for (const name of names) {
    let q=admin.from(name).select('*',{count:'exact',head:true});
    if(name==='alumnos') q=q.eq('activo',true).not('estado_escolar','in','(archivado,baja,traslado,egresado)');
    if(name==='docentes') q=q.eq('activo',true).not('estado_profesional','in','(archivado,baja,inactivo)');
    const result=await q;
    counts[name]=result.count||0;
  }

  const {
    data: groups
  } = await admin
    .from('grupos')
    .select('id,clave,grado,letra,turno')
    .eq('activo', true)
    .order('grado')
    .order('letra');

  const {
    data: notices
  } = await admin
    .from('avisos')
    .select(
      'id,titulo,contenido,fecha_publicacion,activo'
    )
    .eq('activo', true)
    .order('fecha_publicacion', {
      ascending: false
    })
    .limit(6);

  const {
    data: gradeRows
  } = await admin
    .from('calificaciones')
    .select('calificacion')
    .limit(2000);

  const nums = (gradeRows || [])
    .map(x => Number(x.calificacion))
    .filter(Number.isFinite);

  const promedio = nums.length
    ? nums.reduce((a, b) => a + b, 0) / nums.length
    : null;

  const {
    data: attendanceRows
  } = await admin
    .from('asistencias')
    .select('estado')
    .limit(5000);

  const attendanceRate = attendanceRows?.length
    ? (
        attendanceRows.filter(
          x =>
            x.estado === 'presente' ||
            x.estado === 'justificada'
        ).length /
        attendanceRows.length
      ) * 100
    : null;

  const {
    count: horariosCount
  } = await admin
    .from('horarios')
    .select('*', {
      count: 'exact',
      head: true
    });


  if (profile.rol === 'docente') {
    const tid = await teacherId(admin, user.id);

    const {
      data: teacher
    } = await admin
      .from('docentes')
      .select('horas_solicitadas,horas_asignadas')
      .eq('id', tid || -1)
      .maybeSingle();

    return {
      counts,
      groups: groups || [],
      notices: notices || [],
      teacher: teacher || {},
      promedio,
      attendanceRate,
      horariosCount: horariosCount || 0
    };
  }

  return {
    counts,
    groups: groups || [],
    notices: notices || [],
    promedio,
    attendanceRate,
    horariosCount: horariosCount || 0
  };
}


function isArchiveManager(profile){return archiveManagers.includes(profile?.rol);}
function isArchiveAcademic(profile){return archiveAcademics.includes(profile?.rol);}
function archiveSafeName(name='archivo'){
  return String(name||'archivo').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,140) || 'archivo';
}
function archiveDocumentKind(kind){
  const x=String(kind||'').trim().toLowerCase();
  if(!['alumno','docente','institucional'].includes(x)) throw Object.assign(new Error('Tipo de expediente no válido.'),{status:400});
  return x;
}

async function archiveOwnExpedientIds(admin,user,profile){
  const out={alumnoId:null,docenteId:null};
  if(profile?.rol==='alumno') out.alumnoId=await studentId(admin,user.id);
  if(profile?.rol==='docente') out.docenteId=await teacherId(admin,user.id);
  return out;
}

async function archiveDocumentCanView(admin,user,profile,doc,opts={}){
  if(String(doc?.estado||'')==='anulado') return false;
  if(isArchiveManager(profile)) return true;
  const {data:grant,error}=await admin.from('accesos_expediente')
    .select('id,estado,expira_at,documento_id')
    .eq('solicitado_por',user.id)
    .eq('documento_id',doc.id)
    .eq('estado','aprobado')
    .order('id',{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error) throw error;
  if(!grant) return false;
  if(grant.expira_at && new Date(grant.expira_at).getTime()<Date.now()) return false;
  return true;
}

async function enrichArchiveRows(admin,rows){
  const result=rows||[];
  const studentIds=[...new Set(result.filter(r=>r.tipo_expediente==='alumno').map(r=>Number(r.expediente_id)).filter(Boolean))];
  const teacherIds=[...new Set(result.filter(r=>r.tipo_expediente==='docente').map(r=>Number(r.expediente_id)).filter(Boolean))];
  const [sq,tq]=await Promise.all([
    studentIds.length?admin.from('alumnos').select('id,nombre_completo,matricula,estado_escolar,activo,grupos(id,clave,grado,letra)').in('id',studentIds):Promise.resolve({data:[],error:null}),
    teacherIds.length?admin.from('docentes').select('id,nombre_completo,numero_empleado,activo,estado_profesional').in('id',teacherIds):Promise.resolve({data:[],error:null})
  ]);
  if(sq.error)throw sq.error;if(tq.error)throw tq.error;
  const sm=new Map((sq.data||[]).map(x=>[Number(x.id),x]));
  const tm=new Map((tq.data||[]).map(x=>[Number(x.id),x]));
  return result.map(r=>({...r,expediente:(r.tipo_expediente==='alumno'?sm.get(Number(r.expediente_id)):r.tipo_expediente==='docente'?tm.get(Number(r.expediente_id)):null)||null}));
}


function officialDocumentManagers(profile){
  return profile?.rol==='archivo_escolar';
}
function officialDocumentIssuers(profile){
  return profile?.rol==='archivo_escolar';
}
function officialRoleFromDepartment(code){const map={AE:'archivo_escolar',DIR:'direccion_escolar',CE:'control_escolar',SD:'servicios_docentes',SE:'servicios_estudiantiles',PRE:'prefectura',CA:'coordinacion_academica',RM:'recursos_monetarios'};return map[String(code||'').toUpperCase()]||null;}
function normalizeOfficialSignerCodes(values){const allowed=new Set(['DIR','CE','SD','SE','PRE','CA','RM']);return [...new Set((Array.isArray(values)?values:[]).map(x=>String(x||'').trim().toUpperCase()).filter(x=>allowed.has(x)))];}

async function getOfficialDocumentTypes(admin,profile){
  if(!officialDocumentManagers(profile)) throw Object.assign(new Error('Solo Archivo Escolar, Dirección Escolar o Control Escolar pueden consultar el catálogo de documentos oficiales.'),{status:403});
  const {data,error}=await admin.from('catalogo_documentos_oficiales').select('*').eq('activo',true).order('categoria').order('nombre');
  if(error)throw error;
  return data||[];
}

async function getOfficialDocuments(admin,user,profile,req){
  if(!officialDocumentManagers(profile)) throw Object.assign(new Error('Solo Archivo Escolar, Dirección Escolar o Control Escolar pueden consultar documentos oficiales emitidos.'),{status:403});
  let q=admin.from('documentos_oficiales_emitidos').select('*').order('id',{ascending:false}).limit(500);
  const type=String(req.query?.tipo||'').trim(); if(type)q=q.eq('tipo_codigo',type);
  const estado=String(req.query?.estado||'').trim(); if(estado)q=q.eq('estado',estado);
  const {data,error}=await q;if(error)throw error;
  const rows=data||[];
  const studentIds=[...new Set(rows.map(r=>Number(r.alumno_id)).filter(Boolean))];
  const teacherIds=[...new Set(rows.map(r=>Number(r.docente_id)).filter(Boolean))];
  const [sq,tq]=await Promise.all([
    studentIds.length?admin.from('alumnos').select('id,nombre_completo,matricula').in('id',studentIds):Promise.resolve({data:[],error:null}),
    teacherIds.length?admin.from('docentes').select('id,nombre_completo,numero_empleado').in('id',teacherIds):Promise.resolve({data:[],error:null})
  ]);
  if(sq.error)throw sq.error;if(tq.error)throw tq.error;
  const sm=new Map((sq.data||[]).map(x=>[Number(x.id),x]));
  const tm=new Map((tq.data||[]).map(x=>[Number(x.id),x]));
  return rows.map(r=>({...r,alumno:sm.get(Number(r.alumno_id))||null,docente:tm.get(Number(r.docente_id))||null}));
}

async function requireOfficialResponsible(admin,department){
  const rows=await listResponsibleUsers(admin,department);
  const row=rows?.[0]||null;
  if(!row)throw Object.assign(new Error(`No hay un encargado activo para el departamento ${department}. Dirección Escolar debe registrarlo antes de emitir documentos oficiales.`),{status:409});
  const profile=row.perfil||{};
  if(!profile.firma_path && !row.firma_path){
    throw Object.assign(new Error(`El encargado de ${department} no tiene una firma institucional registrada. Registra la firma antes de emitir documentos oficiales.`),{status:409});
  }
  return row;
}

async function generateOfficialDocument(admin,user,profile,body,req){
  if(!officialDocumentIssuers(profile)) throw Object.assign(new Error('No tienes permisos para gestionar documentos oficiales.'),{status:403});
  const code=String(body.tipo_codigo||'').trim();
  if(!code)throw Object.assign(new Error('Selecciona el tipo de documento.'),{status:400});
  const {data:catalog,error:ce}=await admin.from('catalogo_documentos_oficiales').select('*').eq('codigo',code).eq('activo',true).maybeSingle();
  if(ce)throw ce;if(!catalog)throw Object.assign(new Error('Tipo de documento no disponible.'),{status:404});

  const requestedSigners=normalizeOfficialSignerCodes(body.departamentos_firma);
  const defaultSigners=catalog.requiere_firma_direccion&&!requestedSigners.includes('DIR')?['DIR']:requestedSigners;
  if(profile.rol==='archivo_escolar' && !body.internal_emit){
    const institution=await getInstitution(admin);
    const today=new Date().toISOString().slice(0,10);
    let alumno=null,docente=null;
    if(catalog.requiere_alumno){const alumnoId=Number(body.alumno_id||0);if(!alumnoId)throw Object.assign(new Error('Este documento requiere seleccionar un alumno.'),{status:400});const {data,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,curp,turno,grado_ingreso,ciclo_escolar,estado_escolar,grupos(id,clave,grado,letra,turno)').eq('id',alumnoId).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});alumno=data;}
    if(catalog.requiere_docente){const docenteId=Number(body.docente_id||0);if(!docenteId)throw Object.assign(new Error('Este documento requiere seleccionar un docente.'),{status:400});const {data,error}=await admin.from('docentes').select('id,nombre_completo,numero_empleado,estado_profesional,activo').eq('id',docenteId).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Docente no encontrado.'),{status:404});docente=data;}
    const expedienteTipo=alumno?'alumno':docente?'docente':'institucional', expedienteId=alumno?Number(alumno.id):docente?Number(docente.id):Number(institution.id||0);
    const payload={tipo_codigo:code,alumno_id:alumno?.id||null,docente_id:docente?.id||null,destinatario:String(body.destinatario||'').trim(),asunto:String(body.asunto||'').trim(),cuerpo:String(body.cuerpo||'').trim(),departamentos_firma:defaultSigners,solicitado_por:user.id,fecha_solicitud:today};
    const {data:request,error:re}=await admin.from('solicitudes_documentos_oficiales').insert({folio:`SOL-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,tipo_codigo:code,expediente_tipo:expedienteTipo,expediente_id:expedienteId,alumno_id:alumno?.id||null,docente_id:docente?.id||null,destinatario:payload.destinatario||null,asunto:payload.asunto||null,cuerpo:payload.cuerpo||null,payload,departamentos_firma:defaultSigners,aprobaciones:{},estado:defaultSigners.length?'pendiente':'aprobada',solicitado_por:user.id}).select('*').single();if(re)throw re;
    for(const dept of defaultSigners){const role=officialRoleFromDepartment(dept);if(role)try{await notifyJaguarRole(admin,role,{titulo:`Oficio pendiente de revisión · ${request.folio}`,contenido:`Archivo Escolar solicita que revises, aceptes/rechaces y firmes el documento ${catalog.nombre}.`,tipo:'oficio_firma',solicitudId:request.id});}catch(e){console.warn('No se pudo notificar firma interdepartamental:',e.message)}}
    await audit(admin,{userId:user.id,role:profile.rol,action:'request_official_document_signature',module:'archivo_escolar',entity:'solicitudes_documentos_oficiales',entityId:request.id,description:`Solicitud ${request.folio} para ${catalog.nombre}.`,after:request,req});
    if(defaultSigners.length) return {request_created:true,request_id:request.id,folio:request.folio,estado:request.estado,departamentos_firma:defaultSigners,message:'Documento preparado y enviado a revisión/firma interdepartamental.'};
    body={...body,internal_emit:true,approval_request_id:request.id};
  }

  const institution=await getInstitution(admin);
  const today=new Date().toISOString().slice(0,10);
  let alumno=null,docente=null;
  if(catalog.requiere_alumno){
    const alumnoId=Number(body.alumno_id||0);if(!alumnoId)throw Object.assign(new Error('Este documento requiere seleccionar un alumno.'),{status:400});
    const {data,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,curp,turno,grado_ingreso,ciclo_escolar,estado_escolar,grupos(id,clave,grado,letra,turno)').eq('id',alumnoId).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});alumno=data;
  }
  if(catalog.requiere_docente){
    const docenteId=Number(body.docente_id||0);if(!docenteId)throw Object.assign(new Error('Este documento requiere seleccionar un docente.'),{status:400});
    const {data,error}=await admin.from('docentes').select('id,nombre_completo,numero_empleado,estado_profesional,activo').eq('id',docenteId).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Docente no encontrado.'),{status:404});docente=data;
  }
  const destinatario=String(body.destinatario||'').trim().slice(0,500)||null;
  const asunto=String(body.asunto||'').trim().slice(0,500)||null;
  const cuerpo=String(body.cuerpo||'').trim().slice(0,6000)||null;
  if(catalog.requiere_destinatario&&!destinatario)throw Object.assign(new Error('Este documento requiere destinatario.'),{status:400});
  if(catalog.requiere_asunto&&!asunto)throw Object.assign(new Error('Este documento requiere asunto.'),{status:400});
  if(catalog.permite_cuerpo_libre&&catalog.codigo!=='CIT-OFI'&&!cuerpo)throw Object.assign(new Error('Este tipo de documento requiere un cuerpo o mensaje.'),{status:400});
  const requiredStatus={ 'CON-EGR':'egresado','CON-BAJ':'baja','CON-TRS':'traslado' };
  if(alumno&&requiredStatus[catalog.codigo] && String(alumno.estado_escolar||'').toLowerCase()!==requiredStatus[catalog.codigo]) throw Object.assign(new Error(`La ${catalog.nombre.toLowerCase()} solo puede emitirse cuando el estado escolar sea "${requiredStatus[catalog.codigo]}".`),{status:409});

  const emitter=String(catalog.departamento_emisor||'AE').trim().toUpperCase();
  let signer=await requireOfficialResponsible(admin,emitter);
  let secondary=null;
  let additionalSigners=[];
  if(body.internal_emit && body.approval_request_id){
    const {data:reqRow,error:rqe}=await admin.from('solicitudes_documentos_oficiales').select('*').eq('id',Number(body.approval_request_id)).maybeSingle();if(rqe)throw rqe;if(!reqRow)throw Object.assign(new Error('Solicitud de firma no encontrada.'),{status:404});
    const approvals=reqRow.aprobaciones||{};const needed=reqRow.departamentos_firma||[];
    const missing=needed.filter(code=>approvals?.[code]?.estado!=='aprobada');if(missing.length)throw Object.assign(new Error(`Aún faltan firmas: ${missing.join(', ')}.`),{status:409});
    const signed=[];for(const code of [emitter,...needed]){if(signed.some(x=>x===code))continue;const a=approvals?.[code];const rr=a?.usuario_id?await admin.from('perfiles').select('id,nombre_completo,correo,rol,firma_path,firma_sha256').eq('id',a.usuario_id).maybeSingle():{data:null,error:null};if(rr.error)throw rr.error;const person=rr.data;if(person?.firma_path)signed.push(code===emitter?null:{...person,cargo:a.cargo||`Responsable de ${code}`});else {const current=await requireOfficialResponsible(admin,code);signed.push(code===emitter?null:current);if(code===emitter)signer=current;}} additionalSigners=signed.filter(Boolean);
    if(additionalSigners.length)secondary=additionalSigners[0];
  } else if(catalog.requiere_firma_direccion && emitter!=='DIR') secondary=await requireOfficialResponsible(admin,'DIR');

  const expedienteTipo=alumno?'alumno':docente?'docente':'institucional';
  const expedienteId=alumno?Number(alumno.id):docente?Number(docente.id):Number(institution.id||0);
  const tempFolio=`PEND-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  const draft={folio:tempFolio,tipo_codigo:catalog.codigo,alumno_id:alumno?.id||null,docente_id:docente?.id||null,expediente_tipo:expedienteTipo,expediente_id:expedienteId,destinatario,asunto,cuerpo,datos:{alumno:alumno?{id:alumno.id,nombre_completo:alumno.nombre_completo,matricula:alumno.matricula,grupo:alumno.grupos?.clave}:null,docente:docente?{id:docente.id,nombre_completo:docente.nombre_completo,numero_empleado:docente.numero_empleado}:null},estado:'borrador',emitido_por:user.id,departamento_emisor:emitter};
  const {data:created,error:ie}=await admin.from('documentos_oficiales_emitidos').insert(draft).select('*').single();if(ie)throw ie;
  const folio=`${institution.siglas||'JAG'}-${catalog.codigo}-${new Date().getFullYear()}-${String(created.id).padStart(6,'0')}`;
  const {error:uf}=await admin.from('documentos_oficiales_emitidos').update({folio,actualizado_at:new Date().toISOString()}).eq('id',created.id);if(uf)throw uf;

  let verification=null;
  let storagePath=null;
  let archiveDocumentId=null;
  try{
    verification=await registerVerifiableDocument(admin,{folio,tipo:catalog.codigo,titulo:catalog.nombre,alumno_id:alumno?.id||null,created_by:user.id,req,payload:{institucion:{siglas:institution.siglas,nombre:institution.nombre_institucion},alumno:alumno?{nombre:alumno.nombre_completo,matricula:alumno.matricula,grupo:alumno.grupos?.clave,grado:alumno.grupos?.grado}:undefined,docente:docente?{nombre:docente.nombre_completo,numero_empleado:docente.numero_empleado}:undefined,documento:{tipo:catalog.nombre,folio}}});
    const qrBytes=await qrPng(verification.verificationUrl,{size:180});
    const pdfBytes=await buildOfficialPdf({admin,institution,type:catalog.codigo,folio,date:today,student:alumno,teacher:docente,destinatario,asunto,cuerpo,signer,secondarySigner:secondary,additionalSigners:additionalSigners.slice(1),qrBytes});
    const hash=crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex');
    storagePath=`oficiales/${new Date().getFullYear()}/${folio}.pdf`;
    const {error:se}=await admin.storage.from('archivo-escolar').upload(storagePath,Buffer.from(pdfBytes),{contentType:'application/pdf',upsert:false});if(se)throw se;
    const {data:ret,error:re}=await admin.from('catalogo_retencion_documental').select('confidencialidad,codigo').eq('codigo',catalog.codigo_retencion).eq('activo',true).maybeSingle();if(re)throw re;
    if(!ret)throw Object.assign(new Error(`El código de retención ${catalog.codigo_retencion||'—'} no está configurado.`),{status:409});
    const archiveRow={tipo_expediente:expedienteTipo,expediente_id:expedienteId,codigo_retencion:ret.codigo,folio,titulo:catalog.nombre,version:1,estado:'vigente',confidencialidad:ret.confidencialidad,alcance:'oficial',archivo_path:storagePath,archivo_nombre:`${folio}.pdf`,archivo_sha256:hash,mime_type:'application/pdf',size_bytes:Buffer.byteLength(Buffer.from(pdfBytes)),metadatos:{documento_oficial_id:created.id,departamento_emisor:emitter,tipo_codigo:catalog.codigo},creado_por:user.id,actualizado_at:new Date().toISOString(),origen:'generado_automaticamente',documento_oficial_id:created.id};
    const {data:arch,error:ae}=await admin.from('expedientes_documentales').insert(archiveRow).select('id').single();if(ae)throw ae;
    archiveDocumentId=Number(arch.id);
    const {data:final,error:fe}=await admin.from('documentos_oficiales_emitidos').update({folio,archivo_path:storagePath,archivo_nombre:`${folio}.pdf`,archivo_sha256:hash,documento_verificable_id:verification.id,estado:'emitido',actualizado_at:new Date().toISOString(),datos:{...draft.datos,archivo_documental_id:arch.id,verificacion_url:verification.verificationUrl}}).eq('id',created.id).select('*').single();if(fe)throw fe;
    if(body.internal_emit && body.approval_request_id){await admin.from('solicitudes_documentos_oficiales').update({estado:'emitida',documento_oficial_id:created.id,resuelto_at:new Date().toISOString(),actualizado_at:new Date().toISOString()}).eq('id',Number(body.approval_request_id));}
    await admin.from('registro_accesos_expediente').insert({tipo_expediente:expedienteTipo,expediente_id:expedienteId,documento_id:arch.id,usuario_id:user.id,accion:'subida',motivo:`Emisión automática de ${catalog.codigo}`,created_at:new Date().toISOString()});
    let archiveRequestId=null;
    if(body.archive_request_id){
      archiveRequestId=Number(body.archive_request_id)||null;
      if(archiveRequestId){
        const {data:ar,error:are}=await admin.from('solicitudes_archivo_escolar').select('*').eq('id',archiveRequestId).maybeSingle();if(are)throw are;if(!ar)throw Object.assign(new Error('La solicitud de Archivo Escolar no existe.'),{status:404});
        if(!['aprobada','en_revision'].includes(ar.estado))throw Object.assign(new Error('La solicitud no está en un estado que permita emitir el documento.'),{status:409});
        if((ar.expediente_tipo==='alumno'&&Number(ar.expediente_id)!==Number(alumno?.id))||(ar.expediente_tipo==='docente'&&Number(ar.expediente_id)!==Number(docente?.id)))throw Object.assign(new Error('La solicitud no corresponde a la persona del documento.'),{status:400});
        const {data:linkedRequest,error:ureq}=await admin.from('solicitudes_archivo_escolar').update({estado:'atendida',respuesta:`Se generó el documento oficial ${folio}.`,documento_oficial_id:created.id,atendida_por:user.id,atendida_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',archiveRequestId).select('*').single();if(ureq)throw ureq;
        await audit(admin,{userId:user.id,role:profile.rol,action:'close_archive_transparency_request',module:'archivo_escolar',entity:'solicitudes_archivo_escolar',entityId:archiveRequestId,description:`Solicitud ${linkedRequest.folio||archiveRequestId} atendida mediante ${folio}`,after:linkedRequest,req});
      }
    }
    await audit(admin,{userId:user.id,role:profile.rol,action:'issue_official_document',module:'archivo_escolar',entity:'documentos_oficiales_emitidos',entityId:created.id,description:`Emisión ${catalog.codigo} · ${folio}`,after:final,req});
    return {id:created.id,folio,tipo:catalog.codigo,filename:`${folio}.pdf`,pdf_base64:Buffer.from(pdfBytes).toString('base64'),verification_url:verification.verificationUrl,archive_request_id:archiveRequestId};
  }catch(error){
    if(storagePath)try{await admin.storage.from('archivo-escolar').remove([storagePath]);}catch{}
    if(verification?.id)await deleteVerifiableDocument(admin,verification.id);
    if(archiveDocumentId){
      await admin.from('expedientes_documentales').update({estado:'anulado',actualizado_at:new Date().toISOString(),cerrado_por:user.id,cerrado_at:new Date().toISOString(),cierre_motivo:'La emisión del documento oficial no terminó correctamente.'}).eq('id',archiveDocumentId);
    }
    await admin.from('documentos_oficiales_emitidos').update({estado:'cancelado',actualizado_at:new Date().toISOString(),datos:{...draft.datos,error:'La emisión no se completó correctamente.'}}).eq('id',created.id);
    throw error;
  }
}

async function getOfficialDocumentRequests(admin,user,profile){
  if(profile?.rol!=='archivo_escolar')throw Object.assign(new Error('Solo Archivo Escolar puede consultar el seguimiento de sus solicitudes de firma.'),{status:403});
  const {data,error}=await admin.from('solicitudes_documentos_oficiales').select('*,catalogo_documentos_oficiales(codigo,nombre)').eq('solicitado_por',user.id).order('id',{ascending:false}).limit(300);if(error)throw error;
  return (data||[]).map(r=>({id:r.id,folio:r.folio,tipo_codigo:r.tipo_codigo,tipo_nombre:r.catalogo_documentos_oficiales?.nombre||r.tipo_codigo,destinatario:r.destinatario,asunto:r.asunto,estado:r.estado,departamentos_firma:r.departamentos_firma||[],aprobaciones:r.aprobaciones||{},documento_oficial_id:r.documento_oficial_id,creado_at:r.creado_at,motivo_rechazo:r.motivo_rechazo}));
}
async function getOfficialDocumentApprovals(admin,user,profile){
  const dept=departmentKeyForRole(profile?.rol);if(!dept||dept==='AE')throw Object.assign(new Error('No tienes bandeja de firmas interdepartamentales.'),{status:403});
  const {data,error}=await admin.from('solicitudes_documentos_oficiales').select('*,catalogo_documentos_oficiales(codigo,nombre)').contains('departamentos_firma',[dept]).in('estado',['pendiente','en_revision']).order('id',{ascending:false}).limit(200);if(error)throw error;
  return (data||[]).map(r=>({id:r.id,folio:r.folio,tipo_codigo:r.tipo_codigo,tipo_nombre:r.catalogo_documentos_oficiales?.nombre||r.tipo_codigo,destinatario:r.destinatario,asunto:r.asunto,cuerpo:r.cuerpo,estado:r.estado,mi_estado:r.aprobaciones?.[dept]?.estado||'pendiente',solicitante_nombre:'Archivo Escolar'}));
}
async function resolveOfficialDocumentApproval(admin,user,profile,body,req){
  const dept=departmentKeyForRole(profile?.rol);if(!dept||dept==='AE')throw Object.assign(new Error('Este perfil no puede firmar oficios interdepartamentales.'),{status:403});
  const id=Number(body.id||0),decision=body.decision==='aprobada'?'aprobada':body.decision==='rechazada'?'rechazada':null;if(!id||!decision)throw Object.assign(new Error('Decisión no válida.'),{status:400});
  const {data:row,error}=await admin.from('solicitudes_documentos_oficiales').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!row)throw Object.assign(new Error('Solicitud de oficio no encontrada.'),{status:404});if(!(row.departamentos_firma||[]).includes(dept))throw Object.assign(new Error('Este oficio no requiere la firma de tu departamento.'),{status:403});if(['emitida','cancelada'].includes(row.estado))throw Object.assign(new Error('El oficio ya fue resuelto.'),{status:409});
  if(decision==='rechazada'){const motivo=String(body.motivo||'').trim();if(!motivo)throw Object.assign(new Error('El rechazo requiere un motivo.'),{status:400});const approvals={...(row.aprobaciones||{}),[dept]:{estado:'rechazada',usuario_id:user.id,motivo,at:new Date().toISOString()}};const {data:updated,error:ue}=await admin.from('solicitudes_documentos_oficiales').update({estado:'rechazada',aprobaciones:approvals,motivo_rechazo:motivo,actualizado_at:new Date().toISOString()}).eq('id',id).select('*').single();if(ue)throw ue;await audit(admin,{userId:user.id,role:profile.rol,action:'reject_official_document_signature',module:'archivo_escolar',entity:'solicitudes_documentos_oficiales',entityId:id,description:`Firma ${dept} rechazada para ${row.folio}.`,after:updated,req});try{await createJaguarNotification(admin,row.solicitado_por,{titulo:`Oficio ${row.folio} rechazado`,contenido:`${dept} rechazó el oficio. Motivo: ${motivo}`,tipo:'oficio_firma',solicitudId:id});}catch{}return updated;}
  const responsible=await requireOfficialResponsible(admin,dept);const approvals={...(row.aprobaciones||{}),[dept]:{estado:'aprobada',usuario_id:user.id,nombre:profile?.nombre_completo||responsible?.nombre_completo,cargo:responsible?.cargo||`Responsable de ${dept}`,firma_path:profile?.firma_path||responsible?.perfil?.firma_path||responsible?.firma_path||null,firma_sha256:profile?.firma_sha256||responsible?.perfil?.firma_sha256||responsible?.firma_sha256||null,at:new Date().toISOString()}};
  const needed=row.departamentos_firma||[];const all=needed.every(x=>approvals?.[x]?.estado==='aprobada');const next=all?'aprobada':'en_revision';const {data:updated,error:ue}=await admin.from('solicitudes_documentos_oficiales').update({estado:next,aprobaciones:approvals,actualizado_at:new Date().toISOString(),resuelto_at:all?new Date().toISOString():null}).eq('id',id).select('*').single();if(ue)throw ue;
  await audit(admin,{userId:user.id,role:profile.rol,action:'approve_official_document_signature',module:'archivo_escolar',entity:'solicitudes_documentos_oficiales',entityId:id,description:`Firma ${dept} registrada para ${row.folio}.`,after:updated,req});
  if(all){const payload=row.payload||{};await generateOfficialDocument(admin,{id:row.solicitado_por}, {rol:'archivo_escolar'}, {...payload,internal_emit:true,approval_request_id:id,departamentos_firma:needed},req);try{await notifyJaguarRole(admin,'archivo_escolar',{titulo:`Oficio ${row.folio} listo`,contenido:`Todas las firmas requeridas fueron registradas y el documento fue emitido.`,tipo:'oficio_firma',solicitudId:id});}catch{}}else{try{await createJaguarNotification(admin,row.solicitado_por,{titulo:`Firma registrada · ${row.folio}`,contenido:`El departamento ${dept} aceptó y firmó el oficio. Aún faltan otras firmas.`,tipo:'oficio_firma',solicitudId:id});}catch{}}
  return updated;
}

async function getArchiveDocuments(admin,user,profile,req){
  if(!isArchiveManager(profile)) throw Object.assign(new Error('El índice documental completo está reservado exclusivamente a Archivo Escolar.'),{status:403});
  let q=admin.from('expedientes_documentales').select('*').order('creado_at',{ascending:false}).limit(1000);
  const kind=req.query?.tipo_expediente?archiveDocumentKind(req.query.tipo_expediente):null;
  if(kind)q=q.eq('tipo_expediente',kind);
  const ownerId=Number(req.query?.expediente_id||0);
  if(ownerId)q=q.eq('expediente_id',ownerId);
  const {data,error}=await q;if(error)throw error;
  let rows=await enrichArchiveRows(admin,data||[]);
  const manager=isArchiveManager(profile);
  const academic=isArchiveAcademic(profile);
  const own=await archiveOwnExpedientIds(admin,user,profile);
  rows=rows.filter(r=>{
    if(r.estado==='anulado') return manager;
    if(manager) return true;
    if(r.tipo_expediente==='alumno'&&Number(r.expediente_id)===Number(own.alumnoId)) return true;
    if(r.tipo_expediente==='docente'&&Number(r.expediente_id)===Number(own.docenteId)) return true;
    return academic;
  }).map(r=>{
    const ownDoc=(r.tipo_expediente==='alumno'&&Number(r.expediente_id)===Number(own.alumnoId)) || (r.tipo_expediente==='docente'&&Number(r.expediente_id)===Number(own.docenteId));
    const directlyVisible=manager || ownDoc || (academic && !['confidencial','restringido'].includes(String(r.confidencialidad||'')) && r.estado!=='anulado');
    const canRequest=academic && !manager && !ownDoc && ['confidencial','restringido'].includes(String(r.confidencialidad||'')) && r.estado!=='anulado';
    const out={...r,puede_consultar:directlyVisible,puede_solicitar_acceso:canRequest};
    if(!directlyVisible){
      delete out.archivo_path; delete out.archivo_nombre; delete out.archivo_sha256; delete out.mime_type; delete out.size_bytes; delete out.metadatos;
    }
    return out;
  });
  return rows;
}

async function getArchiveAccessRequests(admin,user,profile){
  if(!(isArchiveManager(profile)||isArchiveAcademic(profile)||['alumno','docente'].includes(profile?.rol))) throw Object.assign(new Error('No autorizado.'),{status:403});
  let q=admin.from('accesos_expediente').select('*').order('id',{ascending:false}).limit(500);
  if(!isArchiveManager(profile))q=q.eq('solicitado_por',user.id);
  const {data,error}=await q;if(error)throw error;
  const rows=data||[];
  const docIds=[...new Set(rows.map(r=>Number(r.documento_id)).filter(Boolean))];
  const requesterIds=[...new Set(rows.map(r=>String(r.solicitado_por||'')).filter(Boolean))];
  const [dq,pq]=await Promise.all([
    docIds.length?admin.from('expedientes_documentales').select('id,tipo_expediente,expediente_id,titulo,version,confidencialidad,estado').in('id',docIds):Promise.resolve({data:[],error:null}),
    requesterIds.length?admin.from('perfiles').select('id,nombre_completo,correo,rol').in('id',requesterIds):Promise.resolve({data:[],error:null})
  ]);
  if(dq.error)throw dq.error;if(pq.error)throw pq.error;
  const dm=new Map((dq.data||[]).map(x=>[Number(x.id),x]));
  const pm=new Map((pq.data||[]).map(x=>[String(x.id),x]));
  return rows.map(r=>({...r,documento:dm.get(Number(r.documento_id))||null,solicitante:pm.get(String(r.solicitado_por))||null}));
}


function archiveReviewRole(profile){
  if(['control_escolar','control'].includes(profile?.rol)) return 'control';
  if(profile?.rol==='direccion_escolar') return 'direccion';
  return null;
}

async function getArchiveTransparencyRequests(admin,user,profile){
  const manager=isArchiveManager(profile);
  const requester=['alumno','docente'].includes(profile?.rol);
  if(!manager && !requester) throw Object.assign(new Error('No autorizado.'),{status:403});
  let q=admin.from('solicitudes_archivo_escolar').select('*').order('id',{ascending:false}).limit(500);
  if(requester) q=q.eq('solicitante_id',user.id);
  const {data,error}=await q;if(error)throw error;
  const rows=data||[];
  if(!manager) return rows.map(r=>({
    id:r.id,tipo_solicitud:r.tipo_solicitud,periodo_referencia:r.periodo_referencia,detalle:r.detalle,
    estado:r.estado,respuesta:r.respuesta,documento_oficial_id:r.documento_oficial_id,created_at:r.created_at,updated_at:r.updated_at
  }));
  const ids=[...new Set(rows.map(r=>String(r.solicitante_id||'')).filter(Boolean))];
  const [pq]=await Promise.all([ids.length?admin.from('perfiles').select('id,nombre_completo,correo,rol').in('id',ids):Promise.resolve({data:[],error:null})]);
  if(pq.error)throw pq.error;
  const pm=new Map((pq.data||[]).map(x=>[String(x.id),x]));
  return rows.map(r=>({...r,solicitante:pm.get(String(r.solicitante_id))||null}));
}

async function createArchiveTransparencyRequest(admin,user,profile,body,req){
  if(!['alumno','docente'].includes(profile?.rol)) throw Object.assign(new Error('Solo alumnos y docentes pueden presentar solicitudes a Archivo Escolar.'),{status:403});
  const tipo=String(body.tipo_solicitud||'').trim();
  if(!['consulta','copia','constancia','correccion_dato'].includes(tipo)) throw Object.assign(new Error('Tipo de solicitud no válido.'),{status:400});
  const detalle=String(body.detalle||'').trim().slice(0,1800); if(detalle.length<5) throw Object.assign(new Error('Describe brevemente qué necesitas.'),{status:400});
  let expedienteTipo=profile.rol==='alumno'?'alumno':'docente';
  const expedienteId=profile.rol==='alumno'?await studentId(admin,user.id):await teacherId(admin,user.id);
  if(!expedienteId) throw Object.assign(new Error('No encontramos tu expediente asociado a esta cuenta.'),{status:404});
  const periodo=String(body.periodo_referencia||'').trim().slice(0,100)||null;
  const {data:dup,error:de}=await admin.from('solicitudes_archivo_escolar').select('id,estado').eq('solicitante_id',user.id).eq('tipo_solicitud',tipo).in('estado',['pendiente','en_revision','aprobada']).order('id',{ascending:false}).limit(1).maybeSingle();
  if(de)throw de;
  if(dup)throw Object.assign(new Error('Ya tienes una solicitud de este tipo en proceso. Espera la respuesta antes de crear otra.'),{status:409});
  const row={solicitante_id:user.id,solicitante_tipo:profile.rol,tipo_solicitud:tipo,expediente_tipo:expedienteTipo,expediente_id:Number(expedienteId),periodo_referencia:periodo,detalle,estado:'pendiente'};
  const {data:created,error}=await admin.from('solicitudes_archivo_escolar').insert(row).select('*').single();if(error)throw error;
  const folio=`AE-SOL-${new Date().getFullYear()}-${String(created.id).padStart(6,'0')}`;
  const {data,error:fe}=await admin.from('solicitudes_archivo_escolar').update({folio,updated_at:new Date().toISOString()}).eq('id',created.id).select('*').single();if(fe)throw fe;
  await audit(admin,{userId:user.id,role:profile.rol,action:'create_archive_transparency_request',module:'archivo_escolar',entity:'solicitudes_archivo_escolar',entityId:data.id,description:`Solicitud ${folio} de Archivo Escolar: ${tipo}`,after:data,req});
  return data;
}

async function resolveArchiveTransparencyRequest(admin,user,profile,body,req){
  if(!isArchiveManager(profile)) throw Object.assign(new Error('Solo Archivo Escolar/Control Escolar y Dirección Escolar pueden atender solicitudes.'),{status:403});
  const id=Number(body.id||0),estado=String(body.estado||'').trim();
  if(!id||!['en_revision','aprobada','rechazada','atendida'].includes(estado)) throw Object.assign(new Error('Estado de solicitud no válido.'),{status:400});
  const {data:current,error:ce}=await admin.from('solicitudes_archivo_escolar').select('*').eq('id',id).maybeSingle();if(ce)throw ce;if(!current)throw Object.assign(new Error('Solicitud no encontrada.'),{status:404});
  if(['atendida','cancelada','rechazada'].includes(current.estado)) throw Object.assign(new Error('La solicitud ya fue cerrada.'),{status:409});
  const respuesta=String(body.respuesta||'').trim().slice(0,2200)||null;
  if(['rechazada','atendida'].includes(estado)&&!respuesta) throw Object.assign(new Error('Escribe la respuesta que quedará en el expediente de la solicitud.'),{status:400});
  let documentoId=Number(body.documento_oficial_id||0)||null;
  if(documentoId){
    const {data:doc,error:de}=await admin.from('documentos_oficiales_emitidos').select('id,alumno_id,docente_id,estado').eq('id',documentoId).maybeSingle();if(de)throw de;if(!doc||doc.estado!=='emitido')throw Object.assign(new Error('El documento oficial no está disponible para vincular.'),{status:400});
    if((current.expediente_tipo==='alumno' && Number(doc.alumno_id)!==Number(current.expediente_id))||(current.expediente_tipo==='docente' && Number(doc.docente_id)!==Number(current.expediente_id))) throw Object.assign(new Error('El documento oficial no corresponde a la persona solicitante.'),{status:400});
  }
  const now=new Date().toISOString();
  const patch={estado,respuesta,updated_at:now};
  if(['atendida','rechazada'].includes(estado)){patch.atendida_por=user.id;patch.atendida_at=now;}
  if(documentoId)patch.documento_oficial_id=documentoId;
  const {data,error}=await admin.from('solicitudes_archivo_escolar').update(patch).eq('id',id).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'resolve_archive_transparency_request',module:'archivo_escolar',entity:'solicitudes_archivo_escolar',entityId:id,description:`Solicitud de Archivo Escolar ${estado}`,before:current,after:data,req});
  return data;
}

async function getArchiveGradeClaims(admin,user,profile){
  if(!(isArchiveManager(profile)||['coordinacion_academica','servicios_docentes','docente','alumno'].includes(profile?.rol))) throw Object.assign(new Error('No autorizado.'),{status:403});
  const {data,error}=await admin.from('reclamos_calificacion').select('*,calificaciones(id,alumno_id,calificacion,docente_id,docente:docentes(id,nombre_completo,auth_user_id),alumno:alumnos(id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra)),grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave),grupos(id,clave,grado,letra)),periodos_escolares(id,nombre,ciclo_escolar))').order('creado_at',{ascending:false}).limit(1000);
  if(error)throw error;
  let rows=data||[];
  if(profile.rol==='alumno'){
    const sid=await studentId(admin,user.id); rows=rows.filter(r=>Number(r.alumno_id)===Number(sid));
  }else if(profile.rol==='docente'){
    const tid=await teacherId(admin,user.id); rows=rows.filter(r=>Number(r.calificaciones?.docente_id)===Number(tid));
  }
  return rows;
}

async function getTeacherPlans(admin,user,profile){
  if(!(isArchiveAcademic(profile)||profile?.rol==='docente')) throw Object.assign(new Error('No autorizado.'),{status:403});
  let q=admin.from('planeaciones_docentes').select('*,docentes(id,nombre_completo,numero_empleado),grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave),grupos(id,clave,grado,letra,turno)),periodos_escolares(id,nombre,ciclo_escolar)').order('updated_at',{ascending:false}).limit(500);
  if(profile.rol==='docente'){
    const tid=await teacherId(admin,user.id); if(!tid)throw Object.assign(new Error('Docente no encontrado.'),{status:404}); q=q.eq('docente_id',tid);
  }
  const {data,error}=await q;if(error)throw error;return data||[];
}

async function archiveSchoolRecords(admin,req){
  const q=String(req?.query?.q||'').trim().toLowerCase();
  const estado=String(req?.query?.estado||'').trim().toLowerCase();
  const [sq,tq,mq]=await Promise.all([
    admin.from('alumnos').select('id,nombre_completo,matricula,activo,estado_escolar,grado_ingreso,grupo_id,archivado_at,archivado_motivo,archivado_tipo,grupos(id,clave,grado,letra,turno)').order('id',{ascending:false}).limit(3000),
    admin.from('docentes').select('id,nombre_completo,numero_empleado,correo,activo,estado_profesional,archivado_at').order('id',{ascending:false}).limit(3000),
    admin.from('movimientos_alumnos').select('id,alumno_id,folio,tipo,motivo,escuela_destino,fecha_movimiento,observaciones,created_at').order('id',{ascending:false}).limit(5000)
  ]);
  for(const x of [sq,tq,mq]) if(x.error) throw x.error;
  const students=(sq.data||[]).filter(x=>(!q||`${x.nombre_completo||''} ${x.matricula||''} ${x.grupos?.clave||''}`.toLowerCase().includes(q))&&(!estado||String(x.estado_escolar||'activo').toLowerCase()===estado));
  const teachers=(tq.data||[]).filter(x=>(!q||`${x.nombre_completo||''} ${x.numero_empleado||''} ${x.correo||''}`.toLowerCase().includes(q))&&(!estado||String(x.estado_profesional||'activo').toLowerCase()===estado));
  return {students,teachers,movements:mq.data||[]};
}

async function archiveDashboard(admin){
  const [students,teachers,docs,access,claims,plans]=await Promise.all([
    admin.from('alumnos').select('id,activo,estado_escolar').in('estado_escolar',['archivado','baja','traslado','egresado']).limit(5000),
    admin.from('docentes').select('id,activo,estado_profesional').in('estado_profesional',['archivado','baja']).limit(5000),
    admin.from('expedientes_documentales').select('id,estado,confidencialidad').limit(5000),
    admin.from('accesos_expediente').select('id,estado').eq('estado','pendiente').limit(5000),
    admin.from('reclamos_calificacion').select('id,estado').in('estado',['pendiente','en_revision_docente','escalado_direccion']).limit(5000),
    admin.from('planeaciones_docentes').select('id,estado').in('estado',['enviada','devuelta']).limit(5000)
  ]);
  for(const q of [students,teachers,docs,access,claims,plans])if(q.error)throw q.error;
  return {alumnos_archivados:students.data?.length||0,docentes_archivados:teachers.data?.length||0,documentos:docs.data?.length||0,solicitudes_acceso_pendientes:access.data?.length||0,reclamos_pendientes:claims.data?.length||0,planeaciones_pendientes:plans.data?.length||0};
}

async function prepareArchiveUpload(admin,user,profile,body){
  const allowed=['archivo_escolar','direccion_escolar','control_escolar','control','docente','servicios_docentes','coordinacion_academica'];
  if(!allowed.includes(profile.rol))throw Object.assign(new Error('No autorizado para subir documentos.'),{status:403});
  const tipo=archiveDocumentKind(body.tipo_expediente);
  let expedienteId=Number(body.expediente_id||0);
  if(profile.rol==='docente'){
    const tid=await teacherId(admin,user.id);if(!tid)throw Object.assign(new Error('Docente no encontrado.'),{status:404});if(!expedienteId)expedienteId=Number(tid);if(tipo!=='docente'||Number(tid)!==expedienteId)throw Object.assign(new Error('Un docente solo puede subir documentos de su propio expediente profesional.'),{status:403});
  }else if(!expedienteId) throw Object.assign(new Error('Expediente no válido.'),{status:400});
  if(profile.rol==='servicios_docentes'&&tipo!=='docente') throw Object.assign(new Error('Servicios Docentes solo puede cargar documentos profesionales.'),{status:403});
  const safe=archiveSafeName(body.filename||'archivo');
  const path=`${tipo}/${expedienteId}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,10)}-${safe}`;
  const {data,error}=await admin.storage.from('archivo-escolar').createSignedUploadUrl(path,{upsert:false});if(error)throw error;
  return {bucket:'archivo-escolar',path,token:data?.token||null,filename:safe};
}

async function saveArchiveDocument(admin,user,profile,body,req){
  if(!isArchiveManager(profile) && !['docente','servicios_docentes','coordinacion_academica'].includes(profile.rol))throw Object.assign(new Error('No autorizado para registrar documentos.'),{status:403});
  const tipo=archiveDocumentKind(body.tipo_expediente);
  const expedienteId=Number(body.expediente_id||0);if(!expedienteId)throw Object.assign(new Error('Expediente no válido.'),{status:400});
  if(profile.rol==='docente'){
    const tid=await teacherId(admin,user.id);if(tipo!=='docente'||Number(tid)!==expedienteId)throw Object.assign(new Error('Solo puedes registrar documentos de tu propio expediente.'),{status:403});
  }
  if(['servicios_docentes','coordinacion_academica'].includes(profile.rol) && tipo!=='docente')throw Object.assign(new Error('Solo Servicios Docentes y Coordinación Académica pueden registrar documentos profesionales de docentes.'),{status:403});
  if(tipo==='alumno'){
    const {data:owner,error:oe}=await admin.from('alumnos').select('id').eq('id',expedienteId).maybeSingle();if(oe)throw oe;if(!owner)throw Object.assign(new Error('Alumno de expediente no encontrado.'),{status:404});
  }
  if(tipo==='docente'){
    const {data:owner,error:oe}=await admin.from('docentes').select('id').eq('id',expedienteId).maybeSingle();if(oe)throw oe;if(!owner)throw Object.assign(new Error('Docente de expediente no encontrado.'),{status:404});
  }
  const title=String(body.titulo||'').trim().slice(0,240);if(!title)throw Object.assign(new Error('El título del documento es obligatorio.'),{status:400});
  const code=String(body.codigo_retencion||'').trim();
  if(!code)throw Object.assign(new Error('Todo documento de Archivo Escolar debe quedar clasificado con un código de retención.'),{status:400});
  const {data:cat,error:ce}=await admin.from('catalogo_retencion_documental').select('*').eq('codigo',code).eq('activo',true).maybeSingle();
  if(ce)throw ce;if(!cat)throw Object.assign(new Error('Código de retención no válido o inactivo.'),{status:400});
  const allowedCategories=tipo==='alumno'?['alumno','evaluacion']:tipo==='docente'?['docente']:['institucional','administrativo'];
  if(!allowedCategories.includes(String(cat.categoria)))throw Object.assign(new Error(`El código ${code} no corresponde al tipo de expediente ${tipo}.`),{status:400});
  const requestedConf=['publico','interno','confidencial','restringido'].includes(body.confidencialidad)?body.confidencialidad:null;
  const rank={publico:0,interno:1,confidencial:2,restringido:3};
  if(requestedConf && rank[requestedConf] < rank[cat.confidencialidad]){
    throw Object.assign(new Error(`La clasificación ${cat.confidencialidad} exige un nivel de confidencialidad igual o mayor.`),{status:400});
  }
  const finalConf=requestedConf||cat.confidencialidad;
  const {data:prev,error:pe}=await admin.from('expedientes_documentales').select('id,version,estado').eq('tipo_expediente',tipo).eq('expediente_id',expedienteId).eq('titulo',title).order('version',{ascending:false}).limit(1).maybeSingle();if(pe)throw pe;
  const version=Number(prev?.version||0)+1;
  if(prev?.id && prev.estado==='vigente') await admin.from('expedientes_documentales').update({estado:'cerrado',actualizado_at:new Date().toISOString(),cerrado_por:user.id,cerrado_at:new Date().toISOString()}).eq('id',prev.id);
  const requestedState=String(body.estado||'vigente')==='borrador'?'borrador':'vigente';
  const row={tipo_expediente:tipo,expediente_id:expedienteId,codigo_retencion:code,folio:String(body.folio||'').trim().slice(0,120)||null,titulo:title,version,estado:requestedState,confidencialidad:finalConf,alcance:String(body.alcance||cat.alcance||'interno').slice(0,80),archivo_path:String(body.archivo_path||'').trim()||null,archivo_nombre:String(body.archivo_nombre||'').slice(0,180)||null,archivo_sha256:String(body.archivo_sha256||'').slice(0,64)||null,mime_type:String(body.mime_type||'').slice(0,160)||null,size_bytes:Number(body.size_bytes||0)||null,metadatos:body.metadatos&&typeof body.metadatos==='object'?body.metadatos:{},creado_por:user.id,actualizado_at:new Date().toISOString()};
  if(row.archivo_path){
    const expectedPrefix=`${tipo}/${expedienteId}/${user.id}/`;
    if(!row.archivo_path.startsWith(expectedPrefix))throw Object.assign(new Error('La ruta del archivo debe corresponder a la carga preparada para este usuario y expediente.'),{status:400});
  }
  if(row.archivo_sha256 && !/^[a-f0-9]{64}$/i.test(row.archivo_sha256))throw Object.assign(new Error('La huella SHA-256 del archivo no es válida.'),{status:400});
  const {data,error}=await admin.from('expedientes_documentales').insert(row).select('*').single();if(error)throw error;
  await admin.from('registro_accesos_expediente').insert({tipo_expediente:data.tipo_expediente,expediente_id:data.expediente_id,documento_id:data.id,usuario_id:user.id,accion:'subida',motivo:'Registro/alta documental',created_at:new Date().toISOString()});
  await audit(admin,{userId:user.id,role:profile.rol,action:'create_archive_document',module:'archivo_escolar',entity:'expedientes_documentales',entityId:data.id,description:`Documento ${title} v${version}`,after:data,req});
  return data;
}

async function changeArchiveDocumentStatus(admin,user,profile,body,req){
  if(!isArchiveManager(profile))throw Object.assign(new Error('Solo Archivo Escolar puede cerrar o anular documentos desde el expediente documental.'),{status:403});
  const id=Number(body.documento_id||0),estado=String(body.estado||'').trim();
  if(!id||!['cerrado','anulado'].includes(estado))throw Object.assign(new Error('Estado documental no válido.'),{status:400});
  const motivo=String(body.motivo||'').trim().slice(0,1000);if(!motivo)throw Object.assign(new Error('El motivo es obligatorio.'),{status:400});
  const {data:doc,error:de}=await admin.from('expedientes_documentales').select('*').eq('id',id).maybeSingle();if(de)throw de;if(!doc)throw Object.assign(new Error('Documento no encontrado.'),{status:404});
  if(doc.estado==='anulado')throw Object.assign(new Error('El documento ya está anulado.'),{status:409});
  if(doc.estado==='cerrado')throw Object.assign(new Error('El documento ya está cerrado.'),{status:409});
  const now=new Date().toISOString();
  const {data,error}=await admin.from('expedientes_documentales').update({estado,actualizado_at:now,cerrado_por:user.id,cerrado_at:now,cierre_motivo:motivo}).eq('id',id).select('*').single();if(error)throw error;
  await admin.from('registro_accesos_expediente').insert({tipo_expediente:data.tipo_expediente,expediente_id:data.expediente_id,documento_id:data.id,usuario_id:user.id,accion:estado==='anulado'?'cierre':'cierre',motivo,created_at:now});
  await audit(admin,{userId:user.id,role:profile.rol,action:estado==='anulado'?'anular_archive_document':'close_archive_document',module:'archivo_escolar',entity:'expedientes_documentales',entityId:id,description:`Documento ${estado}.`,before:{estado:doc.estado},after:{estado,cierre_motivo:motivo},req});
  return data;
}

async function getArchiveDocumentUrl(admin,user,profile,body,req){
  const id=Number(body.documento_id||0);if(!id)throw Object.assign(new Error('Documento no válido.'),{status:400});
  const {data:doc,error}=await admin.from('expedientes_documentales').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!doc)throw Object.assign(new Error('Documento no encontrado.'),{status:404});
  const can=await archiveDocumentCanView(admin,user,profile,doc);if(!can)throw Object.assign(new Error('No tienes autorización para consultar este documento.'),{status:403});
  if(!doc.archivo_path)throw Object.assign(new Error('Este registro no contiene un archivo descargable.'),{status:409});
  const {data,error:se}=await admin.storage.from('archivo-escolar').createSignedUrl(doc.archivo_path,300);if(se)throw se;
  const action=String(body.accion||'consulta')==='descarga'?'descarga':'consulta';
  const {data:grant}=await admin.from('accesos_expediente').select('id,expira_at').eq('solicitado_por',user.id).eq('documento_id',doc.id).eq('estado','aprobado').order('id',{ascending:false}).limit(1).maybeSingle();
  await admin.from('registro_accesos_expediente').insert({tipo_expediente:doc.tipo_expediente,expediente_id:doc.expediente_id,documento_id:doc.id,solicitud_id:grant?.id||null,usuario_id:user.id,accion:action,motivo:String(body.motivo||'').slice(0,500)||null,ip:String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim().slice(0,100)||null,user_agent:String(req.headers?.['user-agent']||'').slice(0,500)||null});
  await audit(admin,{userId:user.id,role:profile.rol,action:'access_archive_document',module:'archivo_escolar',entity:'expedientes_documentales',entityId:doc.id,description:`Consulta de documento ${doc.titulo}`,req});
  return {url:data?.signedUrl||data?.signedURL||data?.signed_url||null,expires_in:300,documento:doc};
}


async function getArchivePathUrl(admin,user,profile,body,req){
  const path=String(body.archivo_path||'').trim();if(!path)throw Object.assign(new Error('Ruta de archivo no válida.'),{status:400});
  let allowed=isArchiveManager(profile);
  let tipo='docente',expedienteId=null;
  const {data:plan,error:pe}=await admin.from('planeaciones_docentes').select('id,docente_id,archivo_path').eq('archivo_path',path).order('id',{ascending:false}).limit(1).maybeSingle();if(pe)throw pe;
  if(plan){
    expedienteId=Number(plan.docente_id);
    if(profile.rol==='docente'){
      const tid=await teacherId(admin,user.id);allowed=Number(tid)===Number(plan.docente_id);
    }else if(isArchiveAcademic(profile)){
      allowed=true;
    }
    if(!allowed)throw Object.assign(new Error('No tienes autorización para consultar esta planeación.'),{status:403});
  }else{
    // Fuera de una planeación, solo Archivo Escolar/Control/Dirección puede abrir rutas privadas.
    // Esto evita que un rol académico obtenga una URL firmada de un documento oficial por conocer su ruta.
    if(profile.rol==='docente'){
      const tid=await teacherId(admin,user.id);allowed=path.startsWith(`docente/${tid}/`);expedienteId=Number(tid);
    }
    if(!allowed)throw Object.assign(new Error('No tienes autorización para consultar este archivo.'),{status:403});
  }
  const {data,error}=await admin.storage.from('archivo-escolar').createSignedUrl(path,300);if(error)throw error;
  if(expedienteId) await admin.from('registro_accesos_expediente').insert({tipo_expediente:tipo,expediente_id:expedienteId,usuario_id:user.id,accion:'consulta',motivo:'Consulta de planeación/documento',ip:String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim().slice(0,100)||null,user_agent:String(req.headers?.['user-agent']||'').slice(0,500)||null});
  return {url:data?.signedUrl||data?.signedURL||data?.signed_url||null,expires_in:300};
}

async function requestArchiveAccess(admin,user,profile,body,req){
  if(isArchiveManager(profile))throw Object.assign(new Error('Las autoridades de Archivo no requieren solicitar acceso.'),{status:400});
  if(!isArchiveAcademic(profile))throw Object.assign(new Error('Solo personal académico autorizado puede solicitar acceso documental restringido.'),{status:403});
  const documentId=Number(body.documento_id||0);if(!documentId)throw Object.assign(new Error('Documento no válido.'),{status:400});
  const {data:doc,error:de}=await admin.from('expedientes_documentales').select('id,tipo_expediente,expediente_id,titulo,confidencialidad,estado').eq('id',documentId).maybeSingle();if(de)throw de;if(!doc)throw Object.assign(new Error('Documento no encontrado.'),{status:404});
  if(doc.estado==='anulado')throw Object.assign(new Error('El documento está anulado.'),{status:409});
  if(!['confidencial','restringido'].includes(String(doc.confidencialidad||'')))throw Object.assign(new Error('Este documento no requiere una solicitud de acceso.'),{status:400});
  const own=await archiveDocumentCanView(admin,user,profile,doc);if(own)throw Object.assign(new Error('Ya tienes autorización para consultar este documento.'),{status:409});
  const motivo=String(body.motivo||'').trim().slice(0,1000);if(!motivo)throw Object.assign(new Error('Indica el motivo de la solicitud.'),{status:400});
  const {data:existing,error:ee}=await admin.from('accesos_expediente').select('id,estado').eq('documento_id',documentId).eq('solicitado_por',user.id).eq('estado','pendiente').maybeSingle();if(ee)throw ee;if(existing)throw Object.assign(new Error('Ya existe una solicitud pendiente para este documento.'),{status:409});
  const row={tipo_expediente:doc.tipo_expediente,expediente_id:doc.expediente_id,documento_id:doc.id,solicitado_por:user.id,motivo,estado:'pendiente',alcance_solicitado:String(body.alcance_solicitado||'consulta').slice(0,80)};
  const {data,error}=await admin.from('accesos_expediente').insert(row).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'request_archive_access',module:'archivo_escolar',entity:'accesos_expediente',entityId:data.id,description:`Solicitud de acceso a ${doc.titulo}`,after:data,req});
  return data;
}

async function resolveArchiveAccess(admin,user,profile,body,req){
  if(!isArchiveManager(profile))throw Object.assign(new Error('Solo Dirección o Control Escolar pueden resolver accesos de Archivo Escolar.'),{status:403});
  const id=Number(body.id||0),decision=String(body.decision||'').toLowerCase();
  if(!id||!['aprobado','rechazado','revocado'].includes(decision))throw Object.assign(new Error('Solicitud o decisión no válida.'),{status:400});
  const {data:current,error:ce}=await admin.from('accesos_expediente').select('*').eq('id',id).maybeSingle();if(ce)throw ce;if(!current)throw Object.assign(new Error('Solicitud de acceso no encontrada.'),{status:404});
  const {data:doc,error:de}=current.documento_id?await admin.from('expedientes_documentales').select('id,confidencialidad,estado,titulo').eq('id',current.documento_id).maybeSingle():{data:null,error:null};if(de)throw de;
  if(decision==='aprobado' && current.estado!=='pendiente')throw Object.assign(new Error('Solo se pueden aprobar solicitudes pendientes.'),{status:409});
  if(decision==='rechazado' && current.estado!=='pendiente')throw Object.assign(new Error('Solo se pueden rechazar solicitudes pendientes.'),{status:409});
  if(decision==='revocado' && current.estado!=='aprobado')throw Object.assign(new Error('Solo se pueden revocar accesos actualmente aprobados.'),{status:409});
  const reviewerRole=archiveReviewRole(profile);
  if(decision==='aprobado' && !reviewerRole)throw Object.assign(new Error('La aprobación solo puede hacerla Control Escolar o Dirección Escolar.'),{status:403});
  const expiraAt=body.expira_at?new Date(body.expira_at):null;
  if(expiraAt && Number.isNaN(expiraAt.getTime()))throw Object.assign(new Error('La fecha de expiración no es válida.'),{status:400});
  if(expiraAt && expiraAt.getTime()<=Date.now())throw Object.assign(new Error('La fecha de expiración debe ser futura.'),{status:400});
  const patch={resuelto_por:user.id,resuelto_at:new Date().toISOString()};

  if(decision==='aprobado'){
    const restricted=String(doc?.confidencialidad||'')==='restringido';
    if(restricted){
      if(reviewerRole==='control'){
        if(current.aprobacion_control_por)throw Object.assign(new Error('Control Escolar ya registró su revisión de esta solicitud.'),{status:409});
        patch.aprobacion_control_por=user.id;patch.aprobacion_control_at=new Date().toISOString();
      }else{
        if(current.aprobacion_direccion_por)throw Object.assign(new Error('Dirección Escolar ya registró su revisión de esta solicitud.'),{status:409});
        patch.aprobacion_direccion_por=user.id;patch.aprobacion_direccion_at=new Date().toISOString();
      }
      const controlDone=Boolean(current.aprobacion_control_por||(reviewerRole==='control'&&patch.aprobacion_control_por));
      const directionDone=Boolean(current.aprobacion_direccion_por||(reviewerRole==='direccion'&&patch.aprobacion_direccion_por));
      patch.estado=(controlDone&&directionDone)?'aprobado':'pendiente';
      if(patch.estado==='aprobado')patch.expira_at=expiraAt?expiraAt.toISOString():null;
    }else{
      patch.estado='aprobado';
      patch.expira_at=expiraAt?expiraAt.toISOString():null;
      if(reviewerRole==='control'){patch.aprobacion_control_por=user.id;patch.aprobacion_control_at=new Date().toISOString();}
      if(reviewerRole==='direccion'){patch.aprobacion_direccion_por=user.id;patch.aprobacion_direccion_at=new Date().toISOString();}
    }
  }else if(decision==='rechazado'){
    patch.estado='rechazado';
  }else{
    patch.estado='revocado';
    patch.expira_at=current.expira_at||null;
  }

  const {data,error}=await admin.from('accesos_expediente').update(patch).eq('id',id).select('*').single();if(error)throw error;
  const msg=patch.estado==='aprobado'?'Acceso aprobado.':patch.estado==='pendiente' && decision==='aprobado'?'Primera revisión registrada. Hace falta la segunda autoridad para un documento restringido.':`Solicitud de acceso ${patch.estado}.`;
  await audit(admin,{userId:user.id,role:profile.rol,action:`archive_access_${decision}`,module:'archivo_escolar',entity:'accesos_expediente',entityId:id,description:msg,after:data,req});
  if(data.documento_id) await admin.from('registro_accesos_expediente').insert({tipo_expediente:data.tipo_expediente,expediente_id:data.expediente_id,documento_id:data.documento_id,solicitud_id:data.id,usuario_id:user.id,accion:patch.estado==='aprobado'?'autorizacion':decision==='revocado'?'cierre':'rechazo',motivo:String(body.observaciones||'').slice(0,500)||null,created_at:new Date().toISOString()});
  return data;
}

async function submitGradeClaim(admin,user,profile,body,req){
  if(profile.rol!=='alumno')throw Object.assign(new Error('Solo alumnos pueden presentar un reclamo de calificación.'),{status:403});
  const sid=await studentId(admin,user.id),gradeId=Number(body.calificacion_id||0);if(!sid||!gradeId)throw Object.assign(new Error('Calificación no válida.'),{status:400});
  const {data:grade,error:ge}=await admin.from('calificaciones').select('id,alumno_id,grupo_materia_id,periodo_id,docente_id,calificacion').eq('id',gradeId).maybeSingle();if(ge)throw ge;if(!grade||Number(grade.alumno_id)!==Number(sid))throw Object.assign(new Error('La calificación no pertenece a tu expediente.'),{status:403});
  const motivo=String(body.motivo||'').trim().slice(0,1500);if(!motivo)throw Object.assign(new Error('Escribe el motivo de tu reclamo.'),{status:400});
  const {data:existing,error:ee}=await admin.from('reclamos_calificacion').select('id,estado').eq('calificacion_id',gradeId).eq('alumno_id',sid).in('estado',['pendiente','en_revision_docente','escalado_direccion']).maybeSingle();if(ee)throw ee;if(existing)throw Object.assign(new Error('Ya existe un reclamo activo para esta calificación.'),{status:409});
  const row={alumno_id:sid,calificacion_id:grade.id,grupo_materia_id:grade.grupo_materia_id,periodo_id:grade.periodo_id,motivo,evidencia:body.evidencia&&typeof body.evidencia==='object'?body.evidencia:{},estado:'pendiente',creado_por:user.id};
  const {data,error}=await admin.from('reclamos_calificacion').insert(row).select('*').single();if(error)throw error;
  const teacher=grade.docente_id?await admin.from('docentes').select('id,auth_user_id').eq('id',grade.docente_id).maybeSingle():{data:null,error:null};if(teacher.error)throw teacher.error;
  if(teacher.data?.auth_user_id)try{await createJaguarNotification(admin,teacher.data.auth_user_id,{titulo:'Nuevo reclamo de calificación',contenido:`Un alumno presentó un reclamo sobre una calificación (#${grade.id}).`,tipo:'reclamo_calificacion'});}catch(e){console.warn(e.message)}
  await audit(admin,{userId:user.id,role:profile.rol,action:'submit_grade_claim',module:'archivo_escolar',entity:'reclamos_calificacion',entityId:data.id,description:`Reclamo de calificación #${grade.id}`,after:data,req});
  return data;
}

async function resolveGradeClaim(admin,user,profile,body,req){
  const id=Number(body.id||0),estado=String(body.estado||'').trim();if(!id||!estado)throw Object.assign(new Error('Reclamo o estado no válido.'),{status:400});
  const allowed=new Set(['en_revision_docente','resuelto_docente','escalado_direccion','resuelto_direccion','rechazado','cerrado']);if(!allowed.has(estado))throw Object.assign(new Error('Estado de reclamo no válido.'),{status:400});
  const {data:claim,error:ce}=await admin.from('reclamos_calificacion').select('*,calificaciones(id,alumno_id,docente_id)').eq('id',id).maybeSingle();if(ce)throw ce;if(!claim)throw Object.assign(new Error('Reclamo no encontrado.'),{status:404});
  const now=new Date().toISOString();let patch={estado};
  if(['en_revision_docente','resuelto_docente','escalado_direccion'].includes(estado)){
    const tid=await teacherId(admin,user.id);if(profile.rol!=='docente' || !tid || Number(tid)!==Number(claim.calificaciones?.docente_id))throw Object.assign(new Error('Solo el docente responsable puede atender este reclamo en primera instancia.'),{status:403});
    patch.respondido_por=user.id;patch.respondido_docente_at=now;patch.respuesta_docente=String(body.respuesta||'').trim().slice(0,2000)||null;if(estado==='escalado_direccion')patch.escalado_at=now;
  }else{
    if(!isArchiveManager(profile))throw Object.assign(new Error('Solo Dirección o Control Escolar pueden cerrar o resolver el reclamo a nivel institucional.'),{status:403});
    patch.resuelto_por=user.id;patch.resuelto_at=now;patch.respuesta_direccion=String(body.respuesta||'').trim().slice(0,2000)||null;
  }
  const {data,error}=await admin.from('reclamos_calificacion').update(patch).eq('id',id).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'resolve_grade_claim',module:'archivo_escolar',entity:'reclamos_calificacion',entityId:id,description:`Reclamo actualizado a ${estado}`,after:data,req});
  return data;
}

async function saveTeacherPlanning(admin,user,profile,body,req){
  if(profile.rol!=='docente')throw Object.assign(new Error('Solo docentes pueden registrar planeaciones propias.'),{status:403});
  const tid=await teacherId(admin,user.id);if(!tid)throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const tipo=['anual','periodo','semanal','diaria'].includes(body.tipo)?body.tipo:'periodo';
  const gmId=Number(body.grupo_materia_id||0)||null,periodoId=Number(body.periodo_id||0)||null;
  if(gmId){
    const {data:assignment,error:ae}=await admin.from('asignaciones_docentes').select('id,activo').eq('docente_id',tid).eq('grupo_materia_id',gmId).eq('activo',true).maybeSingle();
    if(ae)throw ae;if(!assignment)throw Object.assign(new Error('No tienes una asignación docente activa para esa materia/grupo.'),{status:403});
  }
  let q=admin.from('planeaciones_docentes').select('id,version,estado').eq('docente_id',tid).eq('tipo',tipo).order('version',{ascending:false}).limit(1);
  if(gmId)q=q.eq('grupo_materia_id',gmId); else q=q.is('grupo_materia_id',null);
  if(periodoId)q=q.eq('periodo_id',periodoId); else q=q.is('periodo_id',null);
  const {data:prev,error:pe}=await q.maybeSingle();if(pe)throw pe;
  const version=Number(prev?.version||0)+1;
  const row={docente_id:tid,grupo_materia_id:gmId,periodo_id:periodoId,ciclo_escolar:String(body.ciclo_escolar||await activeCycle(admin)).slice(0,20),version,tipo,fecha_planeada:body.fecha_planeada||null,estado:'borrador',titulo:String(body.titulo||'Planeación docente').trim().slice(0,240),snapshot:body.snapshot&&typeof body.snapshot==='object'?body.snapshot:{},archivo_path:String(body.archivo_path||'').trim()||null,archivo_nombre:String(body.archivo_nombre||'').slice(0,180)||null,archivo_sha256:String(body.archivo_sha256||'').slice(0,64)||null,updated_at:new Date().toISOString()};
  if(row.archivo_path&&!row.archivo_path.startsWith(`docente/${tid}/`))throw Object.assign(new Error('La ruta de la planeación no corresponde al docente.'),{status:400});
  const {data,error}=await admin.from('planeaciones_docentes').insert(row).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'save_teacher_planning',module:'archivo_escolar',entity:'planeaciones_docentes',entityId:data.id,description:`Planeación ${row.titulo} v${version}`,after:data,req});
  return data;
}

async function sendTeacherPlanning(admin,user,profile,body,req){
  if(profile.rol!=='docente')throw Object.assign(new Error('Solo docentes pueden enviar sus planeaciones.'),{status:403});
  const tid=await teacherId(admin,user.id),id=Number(body.id||0);if(!tid||!id)throw Object.assign(new Error('Planeación no válida.'),{status:400});
  const {data:current,error:ce}=await admin.from('planeaciones_docentes').select('*').eq('id',id).maybeSingle();if(ce)throw ce;if(!current||Number(current.docente_id)!==Number(tid))throw Object.assign(new Error('No puedes enviar esta planeación.'),{status:403});
  if(!['borrador','devuelta'].includes(current.estado))throw Object.assign(new Error('Solo puedes enviar una planeación en borrador o devuelta para corrección.'),{status:409});
  const {data,error}=await admin.from('planeaciones_docentes').update({estado:'enviada',enviado_at:new Date().toISOString(),enviado_por:user.id,updated_at:new Date().toISOString()}).eq('id',id).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'submit_teacher_planning',module:'archivo_escolar',entity:'planeaciones_docentes',entityId:id,description:'Planeación enviada a revisión',after:data,req});
  return data;
}

async function reviewTeacherPlanning(admin,user,profile,body,req){
  if(!isArchiveAcademic(profile))throw Object.assign(new Error('No autorizado para revisar planeaciones.'),{status:403});
  const id=Number(body.id||0),estado=['revisada','devuelta','cerrada'].includes(body.estado)?body.estado:null;if(!id||!estado)throw Object.assign(new Error('Revisión no válida.'),{status:400});
  const {data:current,error:ce}=await admin.from('planeaciones_docentes').select('*').eq('id',id).maybeSingle();if(ce)throw ce;if(!current)throw Object.assign(new Error('Planeación no encontrada.'),{status:404});
  const allowedTransition=((estado==='revisada'||estado==='devuelta')&&current.estado==='enviada') || (estado==='cerrada'&&current.estado==='revisada');
  if(!allowedTransition)throw Object.assign(new Error(`La planeación está en estado ${current.estado} y no puede pasar directamente a ${estado}.`),{status:409});
  const patch={estado,revision_observaciones:String(body.observaciones||'').trim().slice(0,2000)||null,revisado_por:user.id,revisado_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data,error}=await admin.from('planeaciones_docentes').update(patch).eq('id',id).select('*').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'review_teacher_planning',module:'archivo_escolar',entity:'planeaciones_docentes',entityId:id,description:`Planeación marcada como ${estado}`,after:data,req});
  return data;
}


/* =========================================================
   RECURSOS MONETARIOS · OPERACIÓN SEGURA
   ========================================================= */
function isFinanceManager(profile){return ['recursos_monetarios','direccion_escolar'].includes(profile?.rol);}
function isFinanceOperator(profile){return profile?.rol==='recursos_monetarios';}
function ensureFinanceRead(profile){if(!isFinanceManager(profile))throw Object.assign(new Error('Solo Recursos Monetarios o Dirección Escolar pueden consultar información financiera.'),{status:403});}
function ensureFinanceWrite(profile){if(!isFinanceOperator(profile))throw Object.assign(new Error('Esta operación corresponde al encargado de Recursos Monetarios.'),{status:403});}
function ensureFinanceDirection(profile){if(profile?.rol!=='direccion_escolar')throw Object.assign(new Error('Esta operación requiere autorización de Dirección Escolar.'),{status:403});}
function fmtMoney(n){return Number(n||0).toLocaleString('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2});}
function financeFolio(prefix){const now=new Date();return `${prefix}-${now.getFullYear()}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;}

async function buildPaymentReceiptPdf({admin,institution,payment,student,concept,signer,verificationUrl,qrBytes,documentType='CON-PAG'}){
  // Recibo de caja: formato compacto tipo ticket, independiente de los documentos oficiales tipo oficio.
  const width=226; // ~80 mm
  const margin=16;
  const lineWidth=width-(margin*2);
  const payer=student?.nombre_completo||payment.pagador_nombre||'Ingreso institucional';
  const method=String(payment.metodo_pago||'otro').replace(/^./,m=>m.toUpperCase());
  const amount=Number(payment.importe||0);
  const money=fmtMoney(amount);
  const instName=String(institution?.nombre||institution?.razon_social||'INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO').toUpperCase();
  const motto=String(institution?.lema||institution?.motto||'Scientia, Humanitas et Progressum');
  const conceptName=String(concept?.nombre||'Pago escolar');
  const ref=String(payment.referencia_pago||'').trim();
  const date=String(payment.fecha_pago||'');
  const qrSize=82;

  function textWidth(text,font,size){return font.widthOfTextAtSize(String(text),size)}
  function center(page,text,font,size,y){
    const t=String(text);page.drawText(t,{x:(width-textWidth(t,font,size))/2,y,size,font});
  }
  function line(page,y,dashed=false){
    if(dashed){
      for(let x=margin;x<width-margin;x+=7) page.drawLine({start:{x,y},end:{x:Math.min(x+4,width-margin),y},thickness:0.7,color:rgb(.55,.55,.55)});
    }else page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.7,color:rgb(.35,.35,.35)});
  }
  function wrap(text,font,size,maxWidth){
    const words=String(text||'').split(/\s+/).filter(Boolean),rows=[];let row='';
    for(const word of words){
      const test=row?`${row} ${word}`:word;
      if(textWidth(test,font,size)<=maxWidth) row=test;
      else {if(row) rows.push(row);row=word;}
    }
    if(row) rows.push(row); return rows;
  }
  function drawLabelValue(page,label,value,y,fonts){
    page.drawText(label,{x:margin,y,size:8,font:fonts.bold,color:rgb(.3,.3,.3)});
    const val=String(value||'—');
    const max=width-margin-86;
    const rows=wrap(val,fonts.regular,8.5,max);
    rows.slice(0,2).forEach((r,i)=>page.drawText(r,{x:margin+86,y:y-(i*10),size:8.5,font:fonts.regular}));
    return y-(Math.max(1,Math.min(2,rows.length))*10);
  }

  // Start with a generous ticket and trim naturally only through content positioning.
  const height=560 + (instName.length>42?22:0) + (payer.length>42?18:0) + (conceptName.length>42?18:0);
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([width,height]);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono=await pdf.embedFont(StandardFonts.Courier);
  const fonts={regular,bold,mono};
  let y=height-22;

  center(page,'RECIBO DE PAGO',bold,15,y); y-=17;
  center(page,'COMPROBANTE DE CAJA',regular,8.5,y); y-=15;
  line(page,y,true); y-=13;

  for(const row of wrap(instName,bold,8.5,lineWidth)) { center(page,row,bold,8.5,y); y-=10; }
  center(page,`Ciclo ${payment.ciclo_escolar||'—'}`,regular,7.5,y); y-=10;
  center(page,motto,regular,6.5,y); y-=13;
  line(page,y); y-=13;

  page.drawText('FOLIO',{x:margin,y,size:8,font:bold});
  page.drawText(String(payment.folio||'—'),{x:margin+39,y,size:8.5,font:mono}); y-=12;
  page.drawText('FECHA',{x:margin,y,size:8,font:bold});
  page.drawText(date||'—',{x:margin+39,y,size:8.5,font:regular}); y-=14;

  page.drawText('RECIBIMOS DE',{x:margin,y,size:8,font:bold}); y-=11;
  for(const row of wrap(payer,bold,9.2,lineWidth)) { page.drawText(row,{x:margin,y,size:9.2,font:bold}); y-=11; }
  if(student?.matricula){page.drawText(`Matrícula: ${student.matricula}`,{x:margin,y,size:7.8,font:regular});y-=11;}
  y-=2; line(page,y,true); y-=12;

  page.drawText('CONCEPTO',{x:margin,y,size:8,font:bold}); y-=11;
  for(const row of wrap(conceptName,bold,9.2,lineWidth)) { page.drawText(row,{x:margin,y,size:9.2,font:bold}); y-=11; }
  y-=3;

  page.drawText('IMPORTE',{x:margin,y,size:9,font:bold});
  const amountText=money;
  page.drawText(amountText,{x:width-margin-textWidth(amountText,bold,17),y:y-1,size:17,font:bold}); y-=24;
  line(page,y); y-=12;

  y=drawLabelValue(page,'MÉTODO',method,y,fonts);
  if(ref) y=drawLabelValue(page,'REFERENCIA',ref,y,fonts);
  if(payment.cuenta_nombre||payment.cuenta_clave){y=drawLabelValue(page,'CUENTA',payment.cuenta_nombre||payment.cuenta_clave,y,fonts);}
  y-=3; line(page,y,true); y-=12;

  center(page,'GRACIAS POR SU PAGO',bold,9.5,y); y-=12;
  center(page,'Conserve este comprobante.',regular,7.5,y); y-=14;

  if(qrBytes){
    try{
      const qr=await pdf.embedPng(qrBytes);
      page.drawImage(qr,{x:(width-qrSize)/2,y:y-qrSize,width:qrSize,height:qrSize});
      y-=qrSize+8;
      center(page,'Verificación digital',regular,7,y); y-=12;
    }catch{}
  }

  line(page,y,true); y-=11;
  center(page,`Documento ${documentType}`,mono,6.5,y); y-=9;
  center(page,'ITHLA · Recursos Monetarios',regular,6.5,y);

  return Buffer.from(await pdf.save());
}
async function financeDashboard(admin,user,profile){
  ensureFinanceRead(profile);
  const cycle=await activeCycle(admin);
  const [accounts,concepts,charges,payments,expenses,budgets,transfers,cashClosures,config,students,movementRows]=await Promise.all([
    admin.from('recursos_cuentas').select('*').eq('activo',true).order('id'),
    admin.from('recursos_conceptos').select('*').eq('activo',true).order('tipo').order('nombre'),
    admin.from('recursos_cargos').select('*,alumnos(id,nombre_completo,matricula,grupos(clave,grado,letra)),recursos_conceptos(id,codigo,nombre)').eq('ciclo_escolar',cycle).order('id',{ascending:false}).limit(1000),
    admin.from('recursos_pagos').select('*,alumnos(id,nombre_completo,matricula,grupos(clave,grado,letra)),recursos_conceptos(id,codigo,nombre),recursos_cuentas(id,clave,nombre)').eq('ciclo_escolar',cycle).order('id',{ascending:false}).limit(1000),
    admin.from('recursos_egresos').select('*,recursos_conceptos(id,codigo,nombre),recursos_presupuestos(id,categoria,importe_autorizado),recursos_cuentas(id,clave,nombre)').eq('ciclo_escolar',cycle).order('id',{ascending:false}).limit(1000),
    admin.from('recursos_presupuestos').select('*').eq('ciclo_escolar',cycle).order('categoria'),
    admin.from('recursos_transferencias').select('*,recursos_cuentas!cuenta_origen_id(id,clave,nombre),destino:recursos_cuentas!cuenta_destino_id(id,clave,nombre)').eq('ciclo_escolar',cycle).order('id',{ascending:false}).limit(500),
    admin.from('recursos_cortes_caja').select('*,recursos_cuentas(id,clave,nombre)').order('fecha_corte',{ascending:false}).limit(100),
    admin.from('recursos_config').select('*').eq('id',1).maybeSingle(),
    admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra)').eq('activo',true).order('nombre_completo').limit(3000),
    admin.from('jaguar_recursos_movimientos').select('*').order('fecha',{ascending:false}).order('id',{ascending:false}).limit(250)
  ]);
  for(const q of [accounts,concepts,charges,payments,expenses,budgets,transfers,cashClosures,config,students,movementRows])if(q.error){if(q===movementRows && /relation .*jaguar_recursos_movimientos.* does not exist/i.test(q.error.message||'')){movementRows.data=[];movementRows.error=null;}else throw q.error;}
  const accountMap=new Map((accounts.data||[]).map(a=>[Number(a.id),a]));
  const conceptMap=new Map((concepts.data||[]).map(c=>[Number(c.id),c]));
  const movements=(movementRows.data||[]).map(m=>({...m,cuenta_origen:accountMap.get(Number(m.cuenta_origen_id))||null,cuenta_destino:accountMap.get(Number(m.cuenta_destino_id))||null,concepto:conceptMap.get(Number(m.concepto_id))||null}));
  const paidByCharge=new Map();for(const p of payments.data||[]){if(p.estado==='registrado'&&p.cargo_id)paidByCharge.set(Number(p.cargo_id),(paidByCharge.get(Number(p.cargo_id))||0)+Number(p.importe||0));}
  const accountRows=(accounts.data||[]).map(a=>{const incoming=(payments.data||[]).filter(p=>p.estado==='registrado'&&Number(p.cuenta_id)===Number(a.id)).reduce((s,p)=>s+Number(p.importe||0),0);const outgoing=(expenses.data||[]).filter(e=>e.estado==='pagado'&&Number(e.cuenta_id)===Number(a.id)).reduce((s,e)=>s+Number(e.importe||0),0);const transferIn=(transfers.data||[]).filter(t=>t.estado==='registrado'&&Number(t.cuenta_destino_id)===Number(a.id)).reduce((s,t)=>s+Number(t.importe||0),0);const transferOut=(transfers.data||[]).filter(t=>t.estado==='registrado'&&Number(t.cuenta_origen_id)===Number(a.id)).reduce((s,t)=>s+Number(t.importe||0),0);return {...a,ingresos:incoming,egresos:outgoing,transferencias_entrada:transferIn,transferencias_salida:transferOut,saldo:Number(a.saldo_inicial||0)+incoming-outgoing+transferIn-transferOut};});
  const income=(payments.data||[]).filter(p=>p.estado==='registrado').reduce((s,p)=>s+Number(p.importe||0),0);
  const expense=(expenses.data||[]).filter(e=>e.estado==='pagado').reduce((s,e)=>s+Number(e.importe||0),0);
  const pendingCharges=(charges.data||[]).filter(c=>['pendiente','parcial'].includes(c.estado)).reduce((s,c)=>s+Math.max(0,Number(c.importe||0)-(paidByCharge.get(Number(c.id))||0)),0);
  const budgetAuthorized=(budgets.data||[]).filter(b=>['aprobado','cerrado'].includes(b.estado)).reduce((s,b)=>s+Number(b.importe_autorizado||0),0);
  const budgetSpent=expense;
  const monthly={};for(const p of payments.data||[]){if(p.estado!=='registrado')continue;const m=String(p.fecha_pago||'').slice(0,7);monthly[m]??={month:m,income:0,expenses:0};monthly[m].income+=Number(p.importe||0);}for(const e of expenses.data||[]){if(e.estado!=='pagado')continue;const m=String(e.fecha_egreso||'').slice(0,7);monthly[m]??={month:m,income:0,expenses:0};monthly[m].expenses+=Number(e.importe||0);}
  const configData=config.data||{monto_requiere_aprobacion:1000,meta_ingresos:0};
  const incomeTarget=Math.max(0,Number(configData.meta_ingresos||0));
  const incomeVariance=Number((income-incomeTarget).toFixed(2));
  const incomeProgress=incomeTarget>0?Number((income/incomeTarget*100).toFixed(2)):0;
  const net=Number((income-expense).toFixed(2));
  return {cycle,accounts:accountRows,concepts:concepts.data||[],students:students.data||[],transfers:transfers.data||[],cashClosures:cashClosures.data||[],movements,charges:(charges.data||[]).map(c=>({...c,paid:Number(paidByCharge.get(Number(c.id))||0),remaining:Math.max(0,Number(c.importe||0)-Number(paidByCharge.get(Number(c.id))||0))})),payments:payments.data||[],expenses:expenses.data||[],budgets:budgets.data||[],config:configData,summary:{income,expense,net,balance:accountRows.reduce((s,a)=>s+Number(a.saldo||0),0),pendingCharges,budgetAuthorized,budgetSpent,incomeTarget,incomeVariance,incomeProgress,pendingExpenses:(expenses.data||[]).filter(e=>e.estado==='pendiente_aprobacion').length,pendingCashDifferences:(cashClosures.data||[]).filter(x=>Math.abs(Number(x.diferencia||0))>0.005).length},monthly:Object.values(monthly).sort((a,b)=>a.month.localeCompare(b.month))};
}

async function financeCreateCharge(admin,user,profile,body,req){
  ensureFinanceWrite(profile);
  const alumnoId=Number(body.alumno_id||0),conceptId=Number(body.concepto_id||0),importe=Number(body.importe||0);if(!alumnoId||!conceptId||!(importe>0))throw Object.assign(new Error('Selecciona alumno, concepto y un importe mayor a cero.'),{status:400});
  const [{data:student,error:se},{data:concept,error:ce}]=await Promise.all([
    admin.from('alumnos').select('id,nombre_completo,matricula,activo,grupos(clave,grado,letra)').eq('id',alumnoId).maybeSingle(),
    admin.from('recursos_conceptos').select('*').eq('id',conceptId).eq('activo',true).maybeSingle()
  ]);if(se)throw se;if(ce)throw ce;if(!student||student.activo===false)throw Object.assign(new Error('Alumno no encontrado o inactivo.'),{status:404});if(!concept||!['cobro','ambos'].includes(concept.tipo))throw Object.assign(new Error('El concepto seleccionado no es un concepto de cobro.'),{status:400});
  const cycle=await activeCycle(admin);const folio=financeFolio('CARGO');const row={folio,alumno_id:alumnoId,concepto_id:conceptId,ciclo_escolar:cycle,importe:Number(importe.toFixed(2)),fecha_cargo:body.fecha_cargo||new Date().toISOString().slice(0,10),fecha_limite:body.fecha_limite||null,referencia:String(body.referencia||'').trim().slice(0,240)||null,notas:String(body.notas||'').trim().slice(0,1000)||null,creado_por:user.id};const {data,error}=await admin.from('recursos_cargos').insert(row).select('*,recursos_conceptos(id,codigo,nombre)').single();if(error)throw error;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_create_charge',module:'recursos_monetarios',entity:'recursos_cargos',entityId:data.id,description:`Cargo ${data.folio} por ${fmtMoney(data.importe)}.`,after:data,req});return data;
}

async function financeRegisterPayment(admin,user,profile,body,req){
  ensureFinanceWrite(profile);
  const chargeId=Number(body.cargo_id||0)||null,studentIdValue=Number(body.alumno_id||0)||null,conceptIdValue=Number(body.concepto_id||0)||null,accountId=Number(body.cuenta_id||0),importe=Number(body.importe||0);if(!(importe>0)||!accountId)throw Object.assign(new Error('Captura un importe válido y selecciona la cuenta receptora.'),{status:400});
  let charge=null,student=null,concept=null;
  if(chargeId){const {data,error}=await admin.from('recursos_cargos').select('*,alumnos(id,nombre_completo,matricula,activo,grupos(clave,grado,letra)),recursos_conceptos(id,codigo,nombre)').eq('id',chargeId).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('Cargo no encontrado.'),{status:404});charge=data;student=data.alumnos;concept=data.recursos_conceptos;const {data:paidRows,error:pe}=await admin.from('recursos_pagos').select('importe').eq('cargo_id',chargeId).eq('estado','registrado');if(pe)throw pe;const paid=(paidRows||[]).reduce((s,p)=>s+Number(p.importe||0),0);if(importe>Number(charge.importe)-paid+0.005)throw Object.assign(new Error(`El pago supera el saldo pendiente del cargo. Pendiente: ${fmtMoney(Number(charge.importe)-paid)}.`),{status:409});if(studentIdValue&&Number(studentIdValue)!==Number(charge.alumno_id))throw Object.assign(new Error('El cargo no corresponde al alumno seleccionado.'),{status:409});
  } else if(studentIdValue){const {data,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,activo,grupos(clave,grado,letra)').eq('id',studentIdValue).maybeSingle();if(error)throw error;if(!data||data.activo===false)throw Object.assign(new Error('Alumno no encontrado o inactivo.'),{status:404});student=data;if(conceptIdValue){const {data:c,error:ce}=await admin.from('recursos_conceptos').select('*').eq('id',conceptIdValue).eq('activo',true).maybeSingle();if(ce)throw ce;concept=c;}}
  if(!concept){const {data:c,error:ce}=await admin.from('recursos_conceptos').select('*').eq('id',conceptIdValue).eq('activo',true).maybeSingle();if(ce)throw ce;if(!c||!['cobro','ambos'].includes(c.tipo))throw Object.assign(new Error('Selecciona un concepto de cobro válido.'),{status:400});concept=c;}
  const {data:account,error:ae}=await admin.from('recursos_cuentas').select('*').eq('id',accountId).eq('activo',true).maybeSingle();if(ae)throw ae;if(!account)throw Object.assign(new Error('Cuenta receptora no válida.'),{status:400});
  const signer=await requireOfficialResponsible(admin,'RM');if(!student&&charge)throw Object.assign(new Error('El cargo debe pertenecer a un alumno.'),{status:409});if(!student&&!String(body.pagador_nombre||'').trim())throw Object.assign(new Error('Para un ingreso institucional captura el nombre de quien realizó el pago.'),{status:400});const cycle=await activeCycle(admin);const folio=financeFolio('PAG');const payment={folio,alumno_id:student?.id||null,cargo_id:charge?.id||null,concepto_id:concept.id,cuenta_id:account.id,ciclo_escolar:cycle,importe:Number(importe.toFixed(2)),metodo_pago:['efectivo','transferencia','deposito','tarjeta','otro'].includes(String(body.metodo_pago||''))?body.metodo_pago:'otro',referencia_pago:String(body.referencia_pago||'').trim().slice(0,240)||null,fecha_pago:body.fecha_pago||new Date().toISOString().slice(0,10),estado:'registrado',recibio_por:user.id,pagador_nombre:String(body.pagador_nombre||student?.nombre_completo||'').trim().slice(0,180)||null,notas:String(body.notas||'').trim().slice(0,1000)||null};const documentType=student?'CON-PAG':'CON-ING';
  let verification=null,storagePath=null,official=null,archive=null;
  try{
    verification=await registerVerifiableDocument(admin,{folio,tipo:documentType,titulo:'Constancia / comprobante de pago',alumno_id:student?.id||null,created_by:user.id,req,payload:{institucion:await institutionPayload(admin),alumno:student?{nombre:student.nombre_completo,matricula:student.matricula,grupo:student.grupos?.clave}:null,concepto:concept.nombre,importe:payment.importe,fecha_pago:payment.fecha_pago,estado:'valido'}});
    const institution=await getInstitution(admin);const qr=await qrPng(verification.verificationUrl,{size:190});const pdf=await buildPaymentReceiptPdf({admin,institution,payment,student,concept,signer,verificationUrl:verification.verificationUrl,qrBytes:qr,documentType});storagePath=`finanzas/pagos/${String(payment.fecha_pago).slice(0,4)}/${folio}.pdf`;const {error:up}=await admin.storage.from('archivo-escolar').upload(storagePath,pdf,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});if(up)throw up;
    const {data:off,error:oe}=await admin.from('documentos_oficiales_emitidos').insert({folio,tipo_codigo:documentType,alumno_id:student?.id||null,docente_id:null,expediente_tipo:student?'alumno':'institucional',expediente_id:student?.id||Number(institution.id||0),destinatario:student?.nombre_completo||payment.pagador_nombre||null,asunto:'Constancia de pago',cuerpo:`Pago registrado por ${fmtMoney(payment.importe)} correspondiente a ${concept.nombre}.`,datos:{importe:payment.importe,metodo_pago:payment.metodo_pago,referencia_pago:payment.referencia_pago,fecha_pago:payment.fecha_pago},archivo_path:storagePath,archivo_nombre:`${folio}.pdf`,archivo_sha256:crypto.createHash('sha256').update(pdf).digest('hex'),documento_verificable_id:verification.id,estado:'emitido',emitido_por:user.id,departamento_emisor:'RM'}).select('*').single();if(oe)throw oe;official=off;
    const {data:arc,error:arce}=await admin.from('expedientes_documentales').insert({tipo_expediente:student?'alumno':'institucional',expediente_id:student?.id||Number(institution.id||0),codigo_retencion:student?'FIN-PAG':'FIN-ING',folio,titulo:`${student?'Comprobante de pago':'Comprobante de ingreso'} ${folio}`,version:1,estado:'vigente',confidencialidad:'restringido',alcance:'interno',archivo_path:storagePath,archivo_nombre:`${folio}.pdf`,archivo_sha256:crypto.createHash('sha256').update(pdf).digest('hex'),mime_type:'application/pdf',size_bytes:pdf.length,metadatos:{origen:'recursos_monetarios',concepto:concept.nombre,importe:payment.importe,metodo_pago:payment.metodo_pago,referencia_pago:payment.referencia_pago},creado_por:user.id,actualizado_at:new Date().toISOString(),origen:'recursos_monetarios',documento_oficial_id:official.id}).select('*').single();if(arce)throw arce;archive=arc;
    const {data:saved,error:pe}=await admin.from('recursos_pagos').insert({...payment,archivo_path:storagePath,archivo_sha256:crypto.createHash('sha256').update(pdf).digest('hex'),documento_verificable_id:verification.id,comprobante_generado_at:new Date().toISOString()}).select('*').single();if(pe)throw pe;
    await audit(admin,{userId:user.id,role:profile.rol,action:'finance_register_payment',module:'recursos_monetarios',entity:'recursos_pagos',entityId:saved.id,description:`Pago ${folio} por ${fmtMoney(saved.importe)}.`,after:{payment:saved,official_id:official.id,archive_id:archive.id},req});
    return {payment:saved,official,archive,verification_url:verification.verificationUrl,pdf_base64:pdf.toString('base64'),filename:`${folio}.pdf`};
  }catch(e){
    try{if(storagePath)await admin.storage.from('archivo-escolar').remove([storagePath]);}catch{}
    try{if(archive?.id)await admin.from('expedientes_documentales').delete().eq('id',archive.id);}catch{}
    try{if(official?.id)await admin.from('documentos_oficiales_emitidos').delete().eq('id',official.id);}catch{}
    try{if(verification?.id)await deleteVerifiableDocument(admin,verification.id);}catch{}
    throw e;
  }
}

async function institutionPayload(admin){const i=await getInstitution(admin);return {siglas:i?.siglas||'ITHLA',nombre:i?.nombre_institucion||''};}

async function financeReceiptUrl(admin,user,profile,body,req){
  const id=Number(body.id||0);if(!id)throw Object.assign(new Error('Pago no válido.'),{status:400});const {data:p,error}=await admin.from('recursos_pagos').select('*,alumnos(id,nombre_completo,matricula)').eq('id',id).maybeSingle();if(error)throw error;if(!p)throw Object.assign(new Error('Pago no encontrado.'),{status:404});if(profile.rol==='alumno'){const sid=await studentId(admin,user.id);if(!sid||Number(sid.id)!==Number(p.alumno_id))throw Object.assign(new Error('No tienes acceso a este comprobante.'),{status:403});}else ensureFinanceRead(profile);if(!p.archivo_path)throw Object.assign(new Error('Este pago todavía no tiene comprobante archivado.'),{status:409});const {data,error:se}=await admin.storage.from('archivo-escolar').createSignedUrl(p.archivo_path,300);if(se)throw se;return {url:data?.signedUrl||data?.signedURL||null,expires_in:300,folio:p.folio,estado:p.estado};
}

async function financeStudentPayments(admin,user,profile){
  if(profile.rol!=='alumno')throw Object.assign(new Error('Este recurso es exclusivo para alumnos.'),{status:403});const sid=await studentId(admin,user.id);if(!sid)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});const {data,error}=await admin.from('recursos_pagos').select('id,folio,importe,metodo_pago,referencia_pago,fecha_pago,estado,archivo_path,recursos_conceptos(nombre),recursos_cargos(folio)').eq('alumno_id',sid.id).order('id',{ascending:false}).limit(100);if(error)throw error;return data||[];
}

async function financeStudentCharges(admin,user,profile){
  if(profile.rol!=='alumno')throw Object.assign(new Error('Este recurso es exclusivo para alumnos.'),{status:403});
  const sid=await studentId(admin,user.id);if(!sid)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const cycle=await activeCycle(admin);
  const {data:charges,error}=await admin.from('recursos_cargos').select('*,recursos_conceptos(id,codigo,nombre)').eq('alumno_id',sid.id).eq('ciclo_escolar',cycle).order('id',{ascending:false}).limit(100);if(error)throw error;
  const ids=(charges||[]).map(x=>x.id);let paid=[];if(ids.length){const q=await admin.from('recursos_pagos').select('cargo_id,importe').in('cargo_id',ids).eq('estado','registrado');if(q.error)throw q.error;paid=q.data||[];}
  const by=new Map();for(const p of paid)by.set(Number(p.cargo_id),(by.get(Number(p.cargo_id))||0)+Number(p.importe||0));
  return (charges||[]).map(c=>({...c,paid:Number(by.get(Number(c.id))||0),remaining:Math.max(0,Number(c.importe||0)-Number(by.get(Number(c.id))||0))})).filter(c=>c.remaining>0);
}
async function financeRequestCredentialPayment(admin,user,profile,body,req){
  if(profile.rol!=='servicios_estudiantiles')throw Object.assign(new Error('Solo Servicios Estudiantiles puede solicitar el pago de una credencial.'),{status:403});
  const alumnoId=Number(body.alumno_id||0);if(!alumnoId)throw Object.assign(new Error('Alumno no válido.'),{status:400});
  const {data:student,error:se}=await admin.from('alumnos').select('id,nombre_completo,matricula,activo').eq('id',alumnoId).maybeSingle();if(se)throw se;if(!student||student.activo===false)throw Object.assign(new Error('Alumno no encontrado o inactivo.'),{status:404});
  const {data:concept,error:ce}=await admin.from('recursos_conceptos').select('*').eq('codigo','CREDENCIAL').eq('activo',true).maybeSingle();if(ce)throw ce;if(!concept)throw Object.assign(new Error('No existe el concepto financiero CREDENCIAL.'),{status:409});
  const cycle=await activeCycle(admin);const amount=Number(body.importe||concept.monto_sugerido||0);if(!(amount>0))throw Object.assign(new Error('Configura el monto_sugerido del concepto CREDENCIAL o captura el importe.'),{status:400});
  const {data:existing,error:ee}=await admin.from('recursos_cargos').select('*,recursos_conceptos(id,codigo,nombre)').eq('alumno_id',alumnoId).eq('concepto_id',concept.id).eq('ciclo_escolar',cycle).in('estado',['pendiente','parcial']).order('id',{ascending:false}).limit(1).maybeSingle();if(ee)throw ee;if(existing)return existing;
  const folio=financeFolio('CARGO');const row={folio,alumno_id:alumnoId,concepto_id:concept.id,ciclo_escolar:cycle,importe:Number(amount.toFixed(2)),fecha_cargo:new Date().toISOString().slice(0,10),notas:'Solicitud de pago de credencial escolar.',creado_por:user.id};const {data,error}=await admin.from('recursos_cargos').insert(row).select('*,recursos_conceptos(id,codigo,nombre)').single();if(error)throw error;await audit(admin,{userId:user.id,role:profile.rol,action:'credential_payment_request',module:'servicios_estudiantiles',entity:'recursos_cargos',entityId:data.id,description:`Solicitud de pago de credencial para ${student.nombre_completo}.`,after:data,req});return data;
}
async function financeVoidPayment(admin,user,profile,body,req){
  ensureFinanceWrite(profile);const id=Number(body.id||0),motivo=String(body.motivo||'').trim().slice(0,1000);if(!id||!motivo)throw Object.assign(new Error('Indica el pago y un motivo de anulación.'),{status:400});const {data:p,error}=await admin.from('recursos_pagos').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!p)throw Object.assign(new Error('Pago no encontrado.'),{status:404});if(p.estado==='anulado')throw Object.assign(new Error('El pago ya está anulado.'),{status:409});const now=new Date().toISOString();const {data:updated,error:ue}=await admin.from('recursos_pagos').update({estado:'anulado',anulado_por:user.id,anulado_at:now,motivo_anulacion:motivo}).eq('id',id).eq('estado','registrado').select('*').single();if(ue)throw ue;if(p.documento_verificable_id)await admin.from('documentos_verificables').update({estado:'cancelado'}).eq('id',p.documento_verificable_id);if(p.archivo_path){const {data:docs}=await admin.from('expedientes_documentales').select('id').eq('archivo_path',p.archivo_path).limit(10);for(const d of docs||[])await admin.from('expedientes_documentales').update({estado:'anulado',cierre_motivo:motivo,cerrado_por:user.id,cerrado_at:now,actualizado_at:now}).eq('id',d.id);}await admin.from('documentos_oficiales_emitidos').update({estado:'cancelado',actualizado_at:now}).eq('documento_verificable_id',p.documento_verificable_id||0);await audit(admin,{userId:user.id,role:profile.rol,action:'finance_void_payment',module:'recursos_monetarios',entity:'recursos_pagos',entityId:id,description:`Pago ${p.folio} anulado.`,before:p,after:updated,req});return updated;
}

async function financeCreateExpense(admin,user,profile,body,req){
  ensureFinanceWrite(profile);const conceptId=Number(body.concepto_id||0),importe=Number(body.importe||0);if(!conceptId||!(importe>0)||!String(body.descripcion||'').trim())throw Object.assign(new Error('Selecciona concepto, importe y descripción.'),{status:400});const {data:concept,error:ce}=await admin.from('recursos_conceptos').select('*').eq('id',conceptId).eq('activo',true).maybeSingle();if(ce)throw ce;if(!concept||!['egreso','ambos'].includes(concept.tipo))throw Object.assign(new Error('El concepto seleccionado no es de egreso.'),{status:400});const {data:cfg,error:cfge}=await admin.from('recursos_config').select('monto_requiere_aprobacion').eq('id',1).maybeSingle();if(cfge)throw cfge;const threshold=Number(cfg?.monto_requiere_aprobacion??1000),requires=importe>=threshold;const cycle=await activeCycle(admin);const presupuestoId=Number(body.presupuesto_id||0)||null;if(presupuestoId){const {data:b,error:be}=await admin.from('recursos_presupuestos').select('*').eq('id',presupuestoId).maybeSingle();if(be)throw be;if(!b||b.ciclo_escolar!==cycle)throw Object.assign(new Error('El presupuesto seleccionado no pertenece al ciclo activo.'),{status:400});}const row={folio:financeFolio('EGR'),ciclo_escolar:cycle,concepto_id:conceptId,presupuesto_id:presupuestoId,proveedor:String(body.proveedor||'').trim().slice(0,180)||null,proveedor_rfc:String(body.proveedor_rfc||'').trim().slice(0,20)||null,descripcion:String(body.descripcion||'').trim().slice(0,1200),importe:Number(importe.toFixed(2)),metodo_pago:['efectivo','transferencia','deposito','tarjeta','otro'].includes(String(body.metodo_pago||''))?body.metodo_pago:null,referencia_pago:String(body.referencia_pago||'').trim().slice(0,240)||null,fecha_egreso:body.fecha_egreso||new Date().toISOString().slice(0,10),estado:requires?'pendiente_aprobacion':'aprobado',requiere_aprobacion:requires,creado_por:user.id,notas:String(body.notas||'').trim().slice(0,1000)||null};const {data,error}=await admin.from('recursos_egresos').insert(row).select('*').single();if(error)throw error;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_create_expense',module:'recursos_monetarios',entity:'recursos_egresos',entityId:data.id,description:`Egreso ${data.folio} por ${fmtMoney(data.importe)}.`,after:data,req});return data;
}

async function financeApproveExpense(admin,user,profile,body,req){ensureFinanceDirection(profile);const id=Number(body.id||0);if(!id)throw Object.assign(new Error('Egreso no válido.'),{status:400});const {data:e,error}=await admin.from('recursos_egresos').select('*,recursos_presupuestos(id,categoria,importe_autorizado)').eq('id',id).maybeSingle();if(error)throw error;if(!e)throw Object.assign(new Error('Egreso no encontrado.'),{status:404});if(e.estado!=='pendiente_aprobacion')throw Object.assign(new Error('El egreso no está pendiente de aprobación.'),{status:409});if(e.presupuesto_id){const {data:spent,error:se}=await admin.from('recursos_egresos').select('importe').eq('presupuesto_id',e.presupuesto_id).eq('estado','pagado').neq('id',id);if(se)throw se;const used=(spent||[]).reduce((s,x)=>s+Number(x.importe||0),0);if(used+Number(e.importe)>Number(e.recursos_presupuestos?.importe_autorizado||0)+0.005)throw Object.assign(new Error('El egreso supera el presupuesto disponible de su categoría.'),{status:409});}const {data:updated,error:ue}=await admin.from('recursos_egresos').update({estado:'aprobado',aprobado_por:user.id,aprobado_at:new Date().toISOString(),actualizado_at:new Date().toISOString()}).eq('id',id).eq('estado','pendiente_aprobacion').select('*').single();if(ue)throw ue;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_approve_expense',module:'recursos_monetarios',entity:'recursos_egresos',entityId:id,description:`Egreso ${updated.folio} aprobado.`,before:e,after:updated,req});return updated;}

async function financePayExpense(admin,user,profile,body,req){ensureFinanceWrite(profile);const id=Number(body.id||0),accountId=Number(body.cuenta_id||0);if(!id||!accountId)throw Object.assign(new Error('Selecciona el egreso y la cuenta de pago.'),{status:400});const {data:e,error}=await admin.from('recursos_egresos').select('*,recursos_presupuestos(id,categoria,importe_autorizado)').eq('id',id).maybeSingle();if(error)throw error;if(!e)throw Object.assign(new Error('Egreso no encontrado.'),{status:404});if(e.estado!=='aprobado')throw Object.assign(new Error('El egreso debe estar aprobado antes de pagarse.'),{status:409});const {data:a,error:ae}=await admin.from('recursos_cuentas').select('*').eq('id',accountId).eq('activo',true).maybeSingle();if(ae)throw ae;if(!a)throw Object.assign(new Error('Cuenta de pago no válida.'),{status:400});if(e.presupuesto_id){const {data:spent,error:se}=await admin.from('recursos_egresos').select('importe').eq('presupuesto_id',e.presupuesto_id).eq('estado','pagado').neq('id',id);if(se)throw se;const used=(spent||[]).reduce((s,x)=>s+Number(x.importe||0),0);if(used+Number(e.importe)>Number(e.recursos_presupuestos?.importe_autorizado||0)+0.005)throw Object.assign(new Error('El pago dejaría el presupuesto por debajo de cero.'),{status:409});}const now=new Date().toISOString();const {data:updated,error:ue}=await admin.from('recursos_egresos').update({estado:'pagado',cuenta_id:accountId,metodo_pago:e.metodo_pago||'otro',pagado_por:user.id,pagado_at:now,actualizado_at:now}).eq('id',id).eq('estado','aprobado').select('*').single();if(ue)throw ue;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_pay_expense',module:'recursos_monetarios',entity:'recursos_egresos',entityId:id,description:`Egreso ${updated.folio} pagado.`,before:e,after:updated,req});return updated;}

async function financeCreateBudget(admin,user,profile,body,req){ensureFinanceWrite(profile);const category=String(body.categoria||'').trim();const importe=Number(body.importe_autorizado||0);if(!category||importe<0)throw Object.assign(new Error('Captura categoría y presupuesto válido.'),{status:400});const cycle=await activeCycle(admin);const {data,error}=await admin.from('recursos_presupuestos').upsert({ciclo_escolar:cycle,categoria:category,descripcion:String(body.descripcion||'').trim().slice(0,1000)||null,importe_autorizado:Number(importe.toFixed(2)),estado:'borrador',creado_por:user.id,actualizado_at:new Date().toISOString()},{onConflict:'ciclo_escolar,categoria'}).select('*').single();if(error)throw error;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_create_budget',module:'recursos_monetarios',entity:'recursos_presupuestos',entityId:data.id,description:`Presupuesto ${category} preparado.`,after:data,req});return data;}

async function financeApproveBudget(admin,user,profile,body,req){ensureFinanceDirection(profile);const id=Number(body.id||0);if(!id)throw Object.assign(new Error('Presupuesto no válido.'),{status:400});const {data:b,error}=await admin.from('recursos_presupuestos').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!b)throw Object.assign(new Error('Presupuesto no encontrado.'),{status:404});if(b.estado!=='borrador')throw Object.assign(new Error('Solo puedes aprobar un presupuesto en borrador.'),{status:409});const {data:updated,error:ue}=await admin.from('recursos_presupuestos').update({estado:'aprobado',aprobado_por:user.id,aprobado_at:new Date().toISOString(),actualizado_at:new Date().toISOString()}).eq('id',id).eq('estado','borrador').select('*').single();if(ue)throw ue;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_approve_budget',module:'recursos_monetarios',entity:'recursos_presupuestos',entityId:id,description:`Presupuesto ${updated.categoria} aprobado.`,before:b,after:updated,req});return updated;}

async function financeTransfer(admin,user,profile,body,req){
  ensureFinanceWrite(profile);
  const origin=Number(body.cuenta_origen_id||0),destination=Number(body.cuenta_destino_id||0),importe=Number(body.importe||0);
  const concepto=String(body.concepto||'').trim().slice(0,240);
  if(!origin||!destination||origin===destination||!(importe>0)||!concepto)throw Object.assign(new Error('Selecciona cuentas diferentes, importe y concepto.'),{status:400});
  const cycle=await activeCycle(admin);
  const fecha=body.fecha_transferencia||new Date().toISOString().slice(0,10);
  const {data:orig,error:oe}=await admin.from('recursos_cuentas').select('*').eq('id',origin).eq('activo',true).maybeSingle();if(oe)throw oe;if(!orig)throw Object.assign(new Error('Cuenta de origen no válida.'),{status:400});
  const {data:dest,error:de}=await admin.from('recursos_cuentas').select('*').eq('id',destination).eq('activo',true).maybeSingle();if(de)throw de;if(!dest)throw Object.assign(new Error('Cuenta destino no válida.'),{status:400});
  const {data:transfer,error}=await admin.from('recursos_transferencias').insert({folio:financeFolio('TRF'),ciclo_escolar:cycle,cuenta_origen_id:origin,cuenta_destino_id:destination,importe:Number(importe.toFixed(2)),fecha_transferencia:fecha,referencia:String(body.referencia||'').trim().slice(0,240)||null,concepto,creado_por:user.id,estado:'registrado'}).select('*,recursos_cuentas!cuenta_origen_id(id,clave,nombre),destino:recursos_cuentas!cuenta_destino_id(id,clave,nombre)').single();
  if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'finance_transfer',module:'recursos_monetarios',entity:'recursos_transferencias',entityId:transfer.id,description:`Transferencia ${transfer.folio} por ${fmtMoney(transfer.importe)}.`,after:transfer,req});
  return transfer;
}

async function financeCashClose(admin,user,profile,body,req){
  ensureFinanceWrite(profile);
  const accountId=Number(body.cuenta_id||0);const fecha=String(body.fecha_corte||new Date().toISOString().slice(0,10)).slice(0,10);const contado=Number(body.saldo_contado);
  if(!accountId||!Number.isFinite(contado)||contado<0)throw Object.assign(new Error('Selecciona una caja y captura un saldo contado válido.'),{status:400});
  const {data:account,error:ae}=await admin.from('recursos_cuentas').select('*').eq('id',accountId).eq('activo',true).maybeSingle();if(ae)throw ae;if(!account||account.tipo!=='caja')throw Object.assign(new Error('El corte solo puede hacerse sobre una cuenta de tipo caja.'),{status:400});
  const {data:existing,error:ee}=await admin.from('recursos_cortes_caja').select('id').eq('cuenta_id',accountId).eq('fecha_corte',fecha).maybeSingle();if(ee)throw ee;if(existing)throw Object.assign(new Error('Ya existe un corte para esa caja y fecha.'),{status:409});
  const {data:balance,error:be}=await admin.rpc('jaguar_recursos_saldo_cuenta',{p_cuenta_id:accountId,p_fecha:fecha});if(be)throw be;const teorico=Number(balance||0);const row={folio:financeFolio('CJA'),cuenta_id:accountId,fecha_corte:fecha,saldo_teorico:Number(teorico.toFixed(2)),saldo_contado:Number(contado.toFixed(2)),diferencia:Number((contado-teorico).toFixed(2)),observaciones:String(body.observaciones||'').trim().slice(0,1000)||null,responsable_id:user.id};
  const {data:cut,error}=await admin.from('recursos_cortes_caja').insert(row).select('*,recursos_cuentas(id,clave,nombre)').single();if(error)throw error;
  await audit(admin,{userId:user.id,role:profile.rol,action:'finance_cash_close',module:'recursos_monetarios',entity:'recursos_cortes_caja',entityId:cut.id,description:`Corte ${cut.folio} de ${cut.recursos_cuentas?.nombre||'caja'}.`,after:cut,req});
  return cut;
}

async function financeVoidTransfer(admin,user,profile,body,req){
  ensureFinanceDirection(profile);
  const id=Number(body.id||0), motivo=String(body.motivo||'').trim().slice(0,1000);
  if(!id||!motivo)throw Object.assign(new Error('Indica la transferencia y el motivo de anulación.'),{status:400});
  const {data:t,error:te}=await admin.from('recursos_transferencias').select('*').eq('id',id).maybeSingle();
  if(te)throw te;
  if(!t)throw Object.assign(new Error('Transferencia no encontrada.'),{status:404});
  if(t.estado==='anulado')throw Object.assign(new Error('La transferencia ya está anulada.'),{status:409});
  const {data:updated,error:ue}=await admin.from('recursos_transferencias').update({estado:'anulado',anulado_por:user.id,anulado_at:new Date().toISOString(),motivo_anulacion:motivo}).eq('id',id).eq('estado','registrado').select('*').single();
  if(ue)throw ue;
  await audit(admin,{userId:user.id,role:profile.rol,action:'finance_void_transfer',module:'recursos_monetarios',entity:'recursos_transferencias',entityId:id,description:`Transferencia ${t.folio} anulada.`,before:t,after:updated,req});
  return updated;
}

async function financeSaveConfig(admin,user,profile,body,req){ensureFinanceDirection(profile);const threshold=Number(body.monto_requiere_aprobacion),target=Number(body.meta_ingresos||0);if(!Number.isFinite(threshold)||threshold<0)throw Object.assign(new Error('Monto de aprobación inválido.'),{status:400});if(!Number.isFinite(target)||target<0)throw Object.assign(new Error('Meta de ingresos inválida.'),{status:400});const {data,error}=await admin.from('recursos_config').update({monto_requiere_aprobacion:Number(threshold.toFixed(2)),meta_ingresos:Number(target.toFixed(2)),updated_by:user.id,updated_at:new Date().toISOString()}).eq('id',1).select('*').single();if(error)throw error;await audit(admin,{userId:user.id,role:profile.rol,action:'finance_update_config',module:'recursos_monetarios',entity:'recursos_config',entityId:1,description:`Parámetros financieros: umbral ${fmtMoney(threshold)}, meta de ingresos ${fmtMoney(target)}.`,after:data,req});return data;}

async function institutionStatistics(admin,user,profile,req){
  if(profile.rol!=='direccion_escolar')throw Object.assign(new Error('Las estadísticas institucionales son de Dirección Escolar.'),{status:403});
  const cycle=String(req.query?.ciclo||await activeCycle(admin)).trim();const {data,error}=await admin.rpc('jaguar_institution_statistics',{p_ciclo:cycle});if(error){if(/function .* does not exist|schema cache/i.test(error.message||''))throw Object.assign(new Error('Falta instalar sql/ITHLA_DB_COMPLETO_2026_2027.sql en Supabase.'),{status:409});throw error;}return data||{};
}

/* =========================================================
   LECTURA DE RECURSOS
   ========================================================= */

async function getResource(
  admin,
  key,
  user,
  profile,
  req
) {
  if (key === 'dashboard') {
    return dashboard(admin, profile, user);
  }
  if (key === 'financeDashboard') return financeDashboard(admin,user,profile);
  if (key === 'financeStudentPayments') return financeStudentPayments(admin,user,profile);
  if (key === 'financeStudentCharges') return financeStudentCharges(admin,user,profile);
  if (key === 'institutionStatistics') return institutionStatistics(admin,user,profile,req);
  if (key === 'periodContext') return academicContext(admin);
  if (key === 'teacherDashboard') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo docentes pueden consultar este recurso.'), {status:403});
    const tid = await teacherId(admin, user.id);
    if (!tid) throw Object.assign(new Error('Docente no encontrado.'), {status:404});
    const {data:period} = await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,numero_periodo,es_periodo_actual,fecha_inicio,fecha_fin').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1).maybeSingle();
    const cycle = period?.ciclo_escolar || '2026-2027';
    // El inicio del docente debe usar la misma fuente que "Mis grupos":
    // asignaciones_docentes activas. El ciclo se intenta primero, pero si el
    // periodo activo y las asignaciones tienen ciclos desfasados, se recuperan
    // igualmente las asignaciones activas para no mostrar un panel vacío.
    const [aQ,nQ,cQ,sQ,hQ,tQ] = await Promise.all([
      admin.from('asignaciones_docentes').select('id,grupo_materia_id,horas_asignadas,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))').eq('docente_id',tid).eq('activo',true).eq('ciclo_escolar',cycle),
      admin.from('avisos').select('id,titulo,contenido,fecha_publicacion').eq('activo',true).order('fecha_publicacion',{ascending:false}).limit(8),
      admin.from('solicitudes_estudiantiles').select('id,tipo,motivo,estado,created_at,alumnos(nombre_completo,matricula),grupo_materias(materias(nombre))').eq('tipo','aclaracion_calificacion').eq('docente_destino_id',tid).order('id',{ascending:false}).limit(8),
      admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra)').eq('activo',true),
      admin.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,grupo_materia_id,grupo_materias(id,grupo_id,materia_id,grupos(id,clave,grado,letra),materias(id,nombre,clave))').eq('docente_id',tid).eq('ciclo_escolar',cycle).order('dia_semana').order('hora_inicio'),
      admin.from('docentes').select('id,nombre_completo,correo,numero_empleado,horas_solicitadas,horas_asignadas').eq('id',tid).maybeSingle()
    ]);
    for (const q of [aQ,nQ,cQ,sQ,hQ,tQ]) if(q.error) throw q.error;
    let assignments=aQ.data||[];
    if(!assignments.length){
      const fallback=await admin.from('asignaciones_docentes').select('id,grupo_materia_id,horas_asignadas,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))').eq('docente_id',tid).eq('activo',true);
      if(fallback.error) throw fallback.error;
      assignments=fallback.data||[];
    }
    // Si no hubo asignaciones en el ciclo activo, reutilizar exactamente la
    // consulta de "Mis grupos" (activas, sin filtrar por ciclo) para que el
    // docente vea sus grupos reales mientras se corrige el ciclo de los datos.
    if(!assignments.length){
      const allActive=await admin.from('asignaciones_docentes')
        .select('id,grupo_materia_id,horas_asignadas,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))')
        .eq('docente_id',tid).eq('activo',true);
      if(allActive.error) throw allActive.error;
      assignments=allActive.data||[];
    }
    const groupIds=new Set(assignments.map(a=>Number(a.grupo_materia?.grupo_id)).filter(Boolean));
    const students=(sQ.data||[]).filter(s=>groupIds.has(Number(s.grupo_id)));
    // Las materias del inicio se derivan de los grupos/materias asignados, no
    // de un catálogo independiente. Así una asignación real siempre aparece.
    const subjects=[...new Map(assignments.map(a=>[a.grupo_materia?.materia_id,a.grupo_materia?.materias]).filter(x=>x[0])).values()];
    const colorQ=subjects.length?await admin.from('docente_materia_colores').select('materia_id,color_hex').eq('docente_id',tid):{data:[],error:null};
    if(colorQ.error) throw colorQ.error;
    const colorMap=new Map((colorQ.data||[]).map(x=>[String(x.materia_id),x.color_hex]));
    const subjectColors=subjects.map(m=>({materia_id:m.id,color_hex:colorMap.get(String(m.id))||'#4EA72E',materia:m}));
    return {cycle,period:period||null,teacher:tQ.data||{},students:students.sort((a,b)=>String(a.nombre_completo||'').localeCompare(String(b.nombre_completo||''),'es',{sensitivity:'base'})),assignments,subjects,subjectColors,notices:nQ.data||[],clarifications:cQ.data||[],schedules:hQ.data||[]};
  }

  if (key === 'departmentDashboard') {
    const allowed=['servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica','direccion_escolar','control_escolar','control'];
    if(!allowed.includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
    const {data:period}=await admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle();
    const cycle=period?.ciclo_escolar||'2026-2027';
    const [students,teachers,groups,subjects,notices,requests,incidents,grades]=await Promise.all([
      admin.from('alumnos').select('id,nombre_completo,grado_ingreso,grupo_id,activo,grupos(id,clave,grado,letra)').eq('activo',true),
      admin.from('docentes').select('id,nombre_completo,activo').eq('activo',true),
      admin.from('grupos').select('id,clave,grado,letra,turno').eq('activo',true),
      admin.from('materias').select('id,nombre,activa').eq('activa',true),
      admin.from('avisos').select('id,titulo,contenido,fecha_publicacion').eq('activo',true).order('fecha_publicacion',{ascending:false}).limit(8),
      admin.from('solicitudes_estudiantiles').select('id,tipo,estado,created_at,alumnos(nombre_completo,matricula)').order('id',{ascending:false}).limit(500),
      admin.from('incidencias_prefectura').select('id,tipo,alumno_id,fecha,alumnos(grupo_id,grupos(id,clave,grado,letra))').order('id',{ascending:false}).limit(1000),
      admin.from('calificaciones').select('alumno_id,calificacion,grupo_materia_id,grupo_materias(grupo_id,grupos(id,clave,grado,letra))').limit(5000)
    ]);
    for(const q of [students,teachers,groups,subjects,notices,requests,incidents,grades]) if(q.error) throw q.error;
    const ss=students.data||[], gs=grades.data||[];
    const avg=(rows)=>{const n=rows.map(x=>Number(x.calificacion)).filter(Number.isFinite);return n.length?n.reduce((a,b)=>a+b,0)/n.length:null};
    const byGrade={}; for(const s of ss){const g=Number(s.grupos?.grado||s.grado_ingreso||0);if(g) (byGrade[g]??=[]).push(s)}
    const byGroup={}; for(const s of ss){const k=s.grupos?.clave||'Sin grupo';(byGroup[k]??=[]).push(s)}
    const groupAverages=Object.entries(byGroup).map(([group,arr])=>({group,count:arr.length,average:avg(gs.filter(x=>arr.some(s=>Number(s.id)===Number(x.alumno_id))))})).sort((a,b)=>String(a.group).localeCompare(String(b.group),'es',{numeric:true}));
    const incidentByGroup={};for(const r of incidents.data||[]){const k=r.alumnos?.grupos?.clave||'Sin grupo';incidentByGroup[k]=(incidentByGroup[k]||0)+1}
    const topIncidentGroup=Object.entries(incidentByGroup).sort((a,b)=>b[1]-a[1])[0]||null;
    const reqPending=(requests.data||[]).filter(r=>r.estado==='pendiente');
    return {cycle,period:period||null,totalStudents:ss.length,totalTeachers:(teachers.data||[]).length,totalGroups:(groups.data||[]).length,totalSubjects:(subjects.data||[]).length,average:avg(gs),averageByGrade:Object.fromEntries(Object.entries(byGrade).map(([g,arr])=>[g,{count:arr.length,average:avg(gs.filter(x=>arr.some(s=>Number(s.id)===Number(x.alumno_id))))}])),groupAverages,pendingRequests:reqPending.length,notifications:(notices.data||[]).slice(0,5),incidentCount:(incidents.data||[]).length,topIncidentGroup,incidents:incidents.data||[],grades:gs};
  }

  if (key === 'departmentRequests') {
    const roleMap={servicios_docentes:['servicios_docentes'],servicios_estudiantiles:['servicios_estudiantiles'],prefectura:['prefectura'],coordinacion_academica:['coordinacion_academica'],control_escolar:['control_escolar'],direccion_escolar:['direccion_escolar','control_escolar','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica']};
    if(profile.rol==='alumno') return [];
    if(!roleMap[profile.rol]) throw Object.assign(new Error('Este departamento no administra solicitudes.'),{status:403});
    let query=admin.from('solicitudes_estudiantiles').select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))').order('id',{ascending:false}).limit(500);
    const {data,error}=await query;if(error)throw error;
    return (data||[]).filter(r=>{if(r.tipo==='aclaracion_calificacion')return false; const t=String(r.departamento_destino||r.destino_departamento||''); return profile.rol==='direccion_escolar'||!t||roleMap[profile.rol]?.includes(t)||({taller:'servicios_estudiantiles',grado:'servicios_estudiantiles',grupo:'servicios_estudiantiles',turno:'servicios_estudiantiles'}[r.tipo]===profile.rol);});
  }

  if (key === 'studentBoleta') {
    if(profile.rol!=='alumno') throw Object.assign(new Error('Solo alumnos pueden consultar su boleta.'),{status:403});
    const x=await getStudentOverview(admin,user.id);
    const bySubject={}; for(const g of x.grades){const sid=g.grupo_materias?.materia_id; if(!sid)continue; const name=g.grupo_materias?.materias?.nombre||'Materia';(bySubject[sid]??={materia_id:sid,materia:name,docente:null,periods:[]}).periods.push({nombre:g.periodos_escolares?.nombre||'Periodo',ciclo:g.periodos_escolares?.ciclo_escolar||'',calificacion:g.calificacion}); if(!bySubject[sid].docente&&g.docente_id){const {data:d}=await admin.from('docentes').select('id,nombre_completo').eq('id',g.docente_id).maybeSingle();bySubject[sid].docente=d?.nombre_completo||null;}}
    const teachers=[...new Set((x.schedules||[]).map(r=>r.docente?.nombre_completo).filter(Boolean))];
    return {student:x.student,subjects:Object.values(bySubject).sort((a,b)=>String(a.materia).localeCompare(String(b.materia),'es',{sensitivity:'base'})),teachers};
  }

  /* -------------------------
     PERFIL PROPIO
     ------------------------- */

  if (key === 'me') {
    if (profile.rol === 'alumno') {
      const student = await studentId(
        admin,
        user.id
      );

      if (!student) {
        return null;
      }

      const {
        data: alumno
      } = await admin
        .from('alumnos')
        .select(
          '*,grupos(id,clave,grado,letra,turno)'
        )
        .eq('id', student.id)
        .maybeSingle();

      if (!alumno) {
        return null;
      }

      const [
        gradesQuery,
        schedulesQuery,
        workshopsQuery,
        requestsQuery
      ] = await Promise.all([
        admin
          .from('calificaciones')
          .select('calificacion')
          .eq('alumno_id', alumno.id),

        admin
          .from('horarios')
          .select(
            'id,grupo_materia_id,grupo_materias!inner(grupo_id)'
          )
          .eq(
            'grupo_materias.grupo_id',
            alumno.grupo_id
          ),

        admin
          .from('inscripciones_talleres')
          .select(
            'id,taller_id,ciclo_escolar,estado,fecha_inscripcion,talleres(id,nombre,descripcion)'
          )
          .eq('alumno_id', alumno.id)
          .order('id', {
            ascending: false
          }),

        admin
          .from('solicitudes_estudiantiles')
          .select('*')
          .eq('alumno_id', alumno.id)
          .order('id', {
            ascending: false
          })
          .limit(10)
      ]);

      for (
        const query of [
          gradesQuery,
          schedulesQuery,
          workshopsQuery,
          requestsQuery
        ]
      ) {
        if (query.error) {
          throw query.error;
        }
      }

      const values = (gradesQuery.data || [])
        .map(x => Number(x.calificacion))
        .filter(Number.isFinite);

      alumno.promedio_calculado = values.length
        ? values.reduce((x, y) => x + y, 0) /
          values.length
        : null;

      alumno.horas_clase_semana =
        (schedulesQuery.data || []).length;

      alumno.suspendido = Boolean(
        alumno.suspension_fecha ||
        alumno.suspension_motivo
      );

      alumno.talleres =
        workshopsQuery.data || [];

      alumno.solicitudes_estudiantiles =
        requestsQuery.data || [];

      return alumno;
    }

    if (profile.rol === 'docente') {
      return (
        await admin
          .from('docentes')
          .select('*')
          .eq('auth_user_id', user.id)
          .maybeSingle()
      ).data || profile;
    }

    return profile;
  }

  /* -------------------------
     FICHA 360 ALUMNO
     ------------------------- */

  if (key === 'student360') {
    if (
      ![
        ...allAdmin,
        'servicios_estudiantiles',
        'prefectura',
        'coordinacion_academica',
        'servicios_docentes','archivo_escolar'
      ].includes(profile.rol)
    ) {
      throw Object.assign(
        new Error('No autorizado.'),
        { status: 403 }
      );
    }

    const sid = Number(
      req.query?.id || 0
    );

    if (!sid) {
      throw Object.assign(
        new Error('Alumno no válido.'),
        { status: 400 }
      );
    }

    const {
      data: student,
      error: studentError
    } = await admin
      .from('alumnos')
      .select(
        '*,grupos(id,clave,grado,letra,turno)'
      )
      .eq('id', sid)
      .maybeSingle();

    if (studentError || !student) {
      throw Object.assign(
        new Error(
          studentError?.message ||
          'Alumno no encontrado.'
        ),
        { status: 404 }
      );
    }

    const [
      grades,
      attendance,
      workshops,
      movements
    ] = await Promise.all([
      admin
        .from('calificaciones')
        .select(
          'id,calificacion,observaciones,periodo_id,grupo_materia_id,docente_id,periodos_escolares(id,nombre,ciclo_escolar),grupo_materias(id,materia_id,materias(id,nombre,clave))'
        )
        .eq('alumno_id', sid)
        .order('id', {
          ascending: false
        }),

      admin
        .from('asistencias')
        .select(
          'id,fecha,estado,observaciones,grupo_materia_id,docente_id,grupo_materias(id,materia_id,materias(id,nombre,clave))'
        )
        .eq('alumno_id', sid)
        .order('fecha', {
          ascending: false
        })
        .limit(100),

      admin
        .from('inscripciones_talleres')
        .select(
          'id,ciclo_escolar,estado,fecha_inscripcion,talleres(id,nombre,descripcion)'
        )
        .eq('alumno_id', sid)
        .order('id', {
          ascending: false
        }),

      admin
        .from('movimientos_alumnos')
        .select(
          'id,folio,tipo,motivo,escuela_destino,fecha_movimiento,observaciones,created_at'
        )
        .eq('alumno_id', sid)
        .order('id', {
          ascending: false
        })
        .limit(20)
    ]);

    for (
      const query of [
        grades,
        attendance,
        workshops,
        movements
      ]
    ) {
      if (query.error) {
        throw query.error;
      }
    }

    const enrichedStudent = (await enrichStudentsWithAccounts(admin, [student]))[0];
    return {
      student: enrichedStudent,
      grades: grades.data || [],
      attendance: attendance.data || [],
      workshops: workshops.data || [],
      movements: movements.data || []
    };
  }

  /* -------------------------
     USUARIOS
     ------------------------- */

  if (key === 'users') {
    if (!allAdmin.includes(profile.rol)) {
      throw Object.assign(
        new Error(
          'Solo Dirección Escolar o Control Escolar puede consultar usuarios.'
        ),
        { status: 403 }
      );
    }

    const {
      data,
      error
    } = await admin
      .from('perfiles')
      .select(
        'id,nombre_completo,correo,correo_recuperacion,rol,activo'
      )
      .order('rol')
      .order('nombre_completo');

    if (error) {
      throw error;
    }
    const ids=(data||[]).map(x=>x.id).filter(Boolean);
    if(ids.length){
      const {data:links,error:le}=await admin.from('responsables_departamento').select('usuario_id,cargo,es_director,activo,departamentos(id,clave,nombre)').in('usuario_id',ids).eq('activo',true);
      if(le && !/responsables_departamento|schema cache|does not exist/i.test(le.message||''))throw le;
      const {data:signProfiles,error:spe}=await admin.from('perfiles').select('id,firma_path').in('id',ids);
      if(spe)throw spe;
      const sigMap=new Map((signProfiles||[]).map(x=>[String(x.id),!!x.firma_path]));
      const map=new Map((links||[]).map(x=>[String(x.usuario_id),{...x,firma_registrada:!!sigMap.get(String(x.usuario_id))}]));
      return (data||[]).map(x=>({...x,responsabilidad:map.get(String(x.id))||null}));
    }
    return data || [];
  }

  /* -------------------------
     INCIDENCIAS
     ------------------------- */

  if (key === 'incidencias') {
    if (
      ![
        'prefectura',
        ...allAdmin
      ].includes(profile.rol)
    ) {
      throw Object.assign(
        new Error('No autorizado.'),
        { status: 403 }
      );
    }

    const {
      data,
      error
    } = await admin
      .from('incidencias_prefectura')
      .select(
        '*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))'
      )
      .order('id', {
        ascending: false
      })
      .limit(500);

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     SOLICITUDES
     ------------------------- */

  if (key === 'tallerRequests') {
    key = 'studentRequests';
  }

  if (key === 'notifications') {
    const {data,error}=await admin.from('notificaciones').select('*').eq('usuario_id',user.id).order('id',{ascending:false}).limit(100);
    if(error)throw error;
    return data||[];
  }

  if (key === 'studentAvailableGroups') {
    if(profile.rol!=='alumno')throw Object.assign(new Error('Solo los alumnos pueden consultar sus grupos disponibles.'),{status:403});
    const student=await studentId(admin,user.id); if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
    const {data:alumno,error:ae}=await admin.from('alumnos').select('id,grupo_id,grupos(id,clave,grado,letra,turno,activo)').eq('id',student.id).maybeSingle();
    if(ae)throw ae;if(!alumno?.grupos)throw Object.assign(new Error('El alumno no tiene un grupo asignado.'),{status:409});
    const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('activo',true).eq('grado',Number(alumno.grupos.grado)).order('letra');
    if(ge)throw ge;
    const candidates=(groups||[]).filter(g=>Number(g.id)!==Number(alumno.grupo_id)); const cap=await groupCapacity(admin,candidates.map(g=>g.id)); return {actual:alumno.grupos,grupos:candidates.map(g=>({...g,...(cap[String(g.id)]||{ocupados:0,cupo:40,lleno:false})}))};
  }

  if (key === 'teacherScheduleAcceptance') {
    return getTeacherScheduleAcceptance(admin,user);
  }

  if (key === 'groupCapacity') {
    const ids=String(req.query?.grupo_ids||'').split(',').map(Number).filter(Boolean);
    return await groupCapacity(admin,ids);
  }

  if (key === 'groupExchangeCandidates') {
    if(profile.rol!=='alumno') throw Object.assign(new Error('Solo alumnos pueden consultar candidatos de intercambio.'),{status:403});
    const student=await studentId(admin,user.id); if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
    const gid=Number(req.query?.grupo_id||0); if(!gid)throw Object.assign(new Error('Grupo no válido.'),{status:400});
    const {data:me,error:meErr}=await admin.from('alumnos').select('grupo_id,grupos(grado)').eq('id',student.id).maybeSingle(); if(meErr)throw meErr;
    const {data:g,error:ge}=await admin.from('grupos').select('id,grado,activo').eq('id',gid).maybeSingle(); if(ge)throw ge; if(!g||g.activo===false||Number(g.grado)!==Number(me?.grupos?.grado))throw Object.assign(new Error('Grupo no válido para intercambio.'),{status:409});
    const {data,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,sexo,grupos(clave,grado,turno)').eq('grupo_id',gid).eq('activo',true).order('nombre_completo'); if(error)throw error; return data||[];
  }

  if (key === 'groupExchangeRequests') {
    if(profile.rol!=='alumno') throw Object.assign(new Error('Solo alumnos pueden consultar intercambios.'),{status:403});
    const student=await studentId(admin,user.id); if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
    const {data,error}=await admin.from('solicitudes_intercambio_grupo').select('*,alumno_solicitante:alumnos!solicitudes_intercambio_grupo_alumno_solicitante_id_fkey(id,nombre_completo,matricula,grupo_id,grupos(clave)),alumno_destino:alumnos!solicitudes_intercambio_grupo_alumno_destino_id_fkey(id,nombre_completo,matricula,grupo_id,grupos(clave))').or(`alumno_solicitante_id.eq.${student.id},alumno_destino_id.eq.${student.id}`).order('id',{ascending:false}).limit(50); if(error)throw error; return data||[];
  }

  if (key === 'specialGradeRequests') {
    if(!ITHLA_DEPARTMENTS.includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
    const {data,error}=await admin.from('solicitudes_cambio_grado').select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra,turno)),aprobaciones_cambio_grado(id,departamento,estado,observaciones,atendida_at)').order('id',{ascending:false}).limit(300);
    if(error)throw error;
    return (data||[]).filter(r=>profile.rol==='direccion_escolar'||(r.aprobaciones_cambio_grado||[]).some(a=>a.departamento===profile.rol)).map(r=>({...r,mis_aprobaciones:(r.aprobaciones_cambio_grado||[]).filter(a=>a.departamento===profile.rol)}));
  }

  if (key === 'studentRequests') {
    if (profile.rol === 'alumno') {
      const student = await studentId(
        admin,
        user.id
      );

      const {
        data,
        error
      } = await admin
        .from('solicitudes_estudiantiles')
        .select(
          '*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))'
        )
        .eq(
          'alumno_id',
          student?.id || -1
        )
        .order('id', {
          ascending: false
        });

      if (error) {
        throw error;
      }

      const {
        data: workshops
      } = await admin
        .from('talleres')
        .select('id,nombre');

      const workshopMap =
        Object.fromEntries(
          (workshops || []).map(
            x => [String(x.id), x]
          )
        );

      return (data || []).map(
        row =>
          row.tipo === 'taller'
            ? {
                ...row,
                taller_solicitado:
                  workshopMap[
                    String(row.valor_solicitado)
                  ] || null
              }
            : row
      );
    }

    if (
      !studentServices.includes(profile.rol)
    ) {
      throw Object.assign(
        new Error('No autorizado.'),
        { status: 403 }
      );
    }

    const {
      data,
      error
    } = await admin
      .from('solicitudes_estudiantiles')
      .select(
        '*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))'
      )
      .order('id', {
        ascending: false
      });

    if (error) {
      throw error;
    }

    const {
      data: workshops
    } = await admin
      .from('talleres')
      .select('id,nombre');

    const workshopMap =
      Object.fromEntries(
        (workshops || []).map(
          x => [String(x.id), x]
        )
      );

    const visible=(data||[]).filter(row=>{
      if(profile.rol==='direccion_escolar') return true;
      if(profile.rol==='servicios_estudiantiles') return !row.departamento_destino || row.departamento_destino==='servicios_estudiantiles';
      if(profile.rol==='servicios_docentes') return row.departamento_destino==='servicios_docentes';
      if(profile.rol==='prefectura') return row.departamento_destino==='prefectura';
      if(profile.rol==='coordinacion_academica') return row.departamento_destino==='coordinacion_academica';
      if(profile.rol==='control_escolar'||profile.rol==='control') return row.tipo==='grupo' || !row.departamento_destino || row.departamento_destino==='control_escolar';
      return false;
    });
    return visible.map(
      row =>
        row.tipo === 'taller'
          ? {
              ...row,
              taller_solicitado:
                workshopMap[
                  String(row.valor_solicitado)
                ] || null
            }
          : row
    );
  }


  /* -------------------------
     RESUMEN / ESTADÍSTICAS
     ------------------------- */

  if (key === 'stats') {
    if (!['direccion_escolar','control_escolar','control'].includes(profile.rol)) {
      throw Object.assign(new Error('No autorizado.'), { status: 403 });
    }
    const [studentsQ, teachersQ, groupsQ, subjectsQ, requestsQ, incidentsQ, byGradeQ] = await Promise.all([
      admin.from('alumnos').select('id,grado_ingreso', { count: 'exact' }),
      admin.from('docentes').select('id', { count: 'exact' }),
      admin.from('grupos').select('id', { count: 'exact' }).eq('activo', true),
      admin.from('materias').select('id', { count: 'exact' }).eq('activa', true),
      admin.from('solicitudes_estudiantiles').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
      admin.from('incidencias_prefectura').select('id', { count: 'exact', head: true }),
      admin.from('alumnos').select('grado_ingreso')
    ]);
    for (const q of [studentsQ,teachersQ,groupsQ,subjectsQ,requestsQ,incidentsQ,byGradeQ]) if (q.error) throw q.error;
    const alumnosPorGrado = {1:0,2:0,3:0};
    for (const row of byGradeQ.data || []) { const g=Number(row.grado_ingreso); if (g in alumnosPorGrado) alumnosPorGrado[g]++; }
    return { alumnos: studentsQ.count || 0, docentes: teachersQ.count || 0, grupos: groupsQ.count || 0, materias: subjectsQ.count || 0, solicitudesPendientes: requestsQ.count || 0, incidencias: incidentsQ.count || 0, alumnosPorGrado };
  }

  /* -------------------------
     DEPARTAMENTOS
     ------------------------- */

  if (key === 'departments') {
    if (!['direccion_escolar','control_escolar','control'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'), { status: 403 });
    const { data, error } = await admin.from('departamentos').select('*').order('id');
    if (error) throw error;
    return data || [];
  }

  /* -------------------------
     ASISTENCIA ADMINISTRATIVA
     ------------------------- */

  if (key === 'adminAttendance') {
    if (!['direccion_escolar','control_escolar','control','servicios_estudiantiles','prefectura','coordinacion_academica','servicios_docentes'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'), { status: 403 });
    const { data, error } = await admin.from('asistencias').select('id,fecha,estado,observaciones,alumno_id,grupo_materia_id,docente_id,alumno:alumnos(id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra)),grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave),grupos(id,clave,grado,letra))').order('fecha', { ascending:false }).order('id', { ascending:false }).limit(5000);
    if (error) throw error;
    return data || [];
  }

  /* -------------------------
     CALIFICACIONES ADMINISTRATIVAS
     ------------------------- */

  if (key === 'adminGrades') {
    if (!['direccion_escolar','control_escolar','control','servicios_estudiantiles','coordinacion_academica','servicios_docentes'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'), { status: 403 });
    const { data, error } = await admin.from('calificaciones').select('id,alumno_id,calificacion,observaciones,periodo_id,grupo_materia_id,docente_id,alumno:alumnos(id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra)),periodos_escolares(id,nombre,ciclo_escolar),grupo_materias(id,grupo_id,materia_id,horas_semana,materias(id,nombre,clave),grupos(id,clave,grado,letra))').order('id', { ascending:false }).limit(5000);
    if (error) throw error;
    return data || [];
  }

  /* -------------------------
     ASISTENCIA / CALIFICACIONES DEL DOCENTE
     ------------------------- */

  if (key === 'teacherSubjectColors') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo docentes pueden consultar sus colores.'), {status:403});
    const tid = await teacherId(admin, user.id);
    if (!tid) throw Object.assign(new Error('Docente no vinculado.'), {status:404});
    const cycle=await activeCycle(admin);
    let {data:assignments,error}=await admin.from('asignaciones_docentes')
      .select('grupo_materia_id,activo,ciclo_escolar,grupo_materias(materia_id,materias(id,nombre,clave))')
      .eq('docente_id',tid).eq('activo',true).eq('ciclo_escolar',cycle);
    if(error) throw error;
    if(!assignments?.length){ const fb=await admin.from('asignaciones_docentes').select('grupo_materia_id,activo,ciclo_escolar,grupo_materias(materia_id,materias(id,nombre,clave))').eq('docente_id',tid).eq('activo',true); if(fb.error)throw fb.error; assignments=fb.data||[]; }
    const colors=await getTeacherSubjectColors(admin,tid);
    const cmap=new Map(colors.map(x=>[String(x.materia_id),x.color_hex]));
    const seen=new Set();
    return (assignments||[]).map(a=>({materia_id:a.grupo_materias?.materia_id,materia:a.grupo_materias?.materias,color_hex:cmap.get(String(a.grupo_materias?.materia_id))||'#4EA72E'})).filter(x=>{const k=String(x.materia_id);if(!x.materia_id||seen.has(k))return false;seen.add(k);return true;});
  }

  if (key === 'groupSubjectColors') {
    const allowed=['direccion_escolar','control_escolar','control','servicios_docentes','servicios_estudiantiles','coordinacion_academica','docente'];
    if(!allowed.includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
    const groupId=Number(req.query?.grupo_id||0);
    if(!groupId) throw Object.assign(new Error('Grupo no válido.'),{status:400});
    return getGroupSubjectColors(admin,groupId);
  }

  if (key === 'teacherRoster') {
    return getTeacherRoster(admin, user, req.query?.grupo_materia_id);
  }

  if (key === 'teacherExport') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo el docente puede exportar sus listas.'), { status: 403 });
    const tid = await teacherId(admin, user.id);
    const gmId = Number(req.query?.grupo_materia_id || 0);
    if (!tid || !gmId) throw Object.assign(new Error('Grupo-materia no válido.'), { status: 400 });
    const cycle = await activeCycle(admin);
    const { data: assignment, error: ae } = await admin.from('asignaciones_docentes')
      .select('id,docente_id,grupo_materia_id,horas_asignadas,ciclo_escolar,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))')
      .eq('docente_id', tid).eq('grupo_materia_id', gmId).eq('activo', true).eq('ciclo_escolar', cycle).maybeSingle();
    if (ae) throw ae;
    if (!assignment) throw Object.assign(new Error('No tienes asignado este grupo-materia.'), { status: 403 });
    const groupId = assignment.grupo_materias?.grupo_id;
    const [studentsQ, attendanceQ, gradesQ, periodsQ, teacherQ] = await Promise.all([
      admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,activo,grupos(id,clave,grado,letra,turno)').eq('grupo_id', groupId).order('nombre_completo'),
      admin.from('asistencias').select('id,alumno_id,fecha,estado,observaciones').eq('grupo_materia_id', gmId).eq('docente_id', tid).order('fecha').order('alumno_id').limit(10000),
      admin.from('calificaciones').select('id,alumno_id,calificacion,periodo_id,observaciones,periodos_escolares(id,nombre,ciclo_escolar)').eq('grupo_materia_id', gmId).order('periodo_id'),
      admin.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').eq('ciclo_escolar', cycle).order('id'),
      admin.from('docentes').select('id,nombre_completo,numero_empleado,especialidad,correo').eq('id', tid).maybeSingle()
    ]);
    for (const q of [studentsQ,attendanceQ,gradesQ,periodsQ,teacherQ]) if(q.error) throw q.error;
    const students=await enrichStudentsWithAccounts(admin, studentsQ.data||[]), attendance=attendanceQ.data||[], grades=gradesQ.data||[];
    const byStudent=new Map(students.map(s=>[String(s.id),{...s,attendance:{},grades:{}}]));
    for(const a of attendance){const x=byStudent.get(String(a.alumno_id));if(x)x.attendance[a.fecha]=a.estado||'';}
    for(const g of grades){const x=byStudent.get(String(g.alumno_id));if(x)x.grades[String(g.periodo_id)]={calificacion:g.calificacion,observaciones:g.observaciones||'',periodo:g.periodos_escolares?.nombre||''};}
    const periods=(periodsQ.data||[]).sort((a,b)=>Number(a.numero_periodo||0)-Number(b.numero_periodo||0)||Number(a.id)-Number(b.id)).map((p,i)=>({id:p.id,label:`P${Number(p.numero_periodo||i+1)}`,nombre:p.nombre}));
    return {assignment,teacher:teacherQ.data||{},students:[...byStudent.values()],attendanceDates:[...new Set(attendance.map(a=>a.fecha))].sort(),periods,cycle};
  }

  if (key === 'teacherGrades') {
    return getTeacherRoster(admin, user, req.query?.grupo_materia_id, { periodo_id: req.query?.periodo_id });
  }

  if (key === 'teacherAttendance') {
    return getTeacherRoster(admin, user, req.query?.grupo_materia_id, { fecha: req.query?.fecha });
  }

  /* -------------------------
     ASISTENCIA / CALIFICACIONES DEL ALUMNO
     ------------------------- */

  if (key === 'studentOverview') {
    if (profile.rol !== 'alumno') throw Object.assign(new Error('Solo el alumno puede consultar este recurso.'), { status: 403 });
    return getStudentOverview(admin, user.id);
  }

  /* -------------------------
     PREFECTURA: alias compatible
     ------------------------- */

  if (key === 'prefectureRecords') {
    key = 'incidencias';
  }

  /* -------------------------
     ACLARACIONES DE CALIFICACIÓN
     ------------------------- */

  if (key === 'clarifications') {
    let query = admin.from('solicitudes_estudiantiles')
      .select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(id,clave,grado,letra)),grupo_materias(id,grupo_id,materia_id,materias(id,nombre,clave)),calificaciones(id,calificacion,observaciones,periodo_id),docente_destino:docentes(id,nombre_completo)')
      .eq('tipo', 'aclaracion_calificacion')
      .order('id', { ascending:false });
    if (profile.rol === 'alumno') {
      const student = await studentId(admin, user.id);
      query = query.eq('alumno_id', student?.id || -1);
    } else if (profile.rol === 'docente') {
      const tid = await teacherId(admin, user.id);
      query = query.eq('docente_destino_id', tid || -1);
    } else if (!['direccion_escolar','control_escolar','control','coordinacion_academica'].includes(profile.rol)) {
      throw Object.assign(new Error('No autorizado.'), { status:403 });
    }
    const { data, error } = await query.limit(500);
    if (error) throw error;
    return data || [];
  }

  /* -------------------------
     BITÁCORA DIARIA DE EXCEL
     ------------------------- */
  if (key === 'teacherDailyGradebook') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo el docente puede consultar su bitácora.'),{status:403});
    return await getTeacherDailyGradebook(admin,user,Number(req.query?.grupo_materia_id||0),Number(req.query?.periodo_id||0),req.query?.fecha);
  }
  if (key === 'dailyGradebooks') return await listDailyGradebooks(admin,profile,req.query||{});
  if (key === 'dailyGradebookSnapshot') return await getDailyGradebookSnapshot(admin,user,profile,Number(req.query?.id||0));

  /* -------------------------
     EVALUACIÓN DOCENTE
     ------------------------- */

  if (key === 'teacherEvaluationOverview') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo el docente puede consultar su evaluación.'), {status:403});
    return await getTeacherEvaluationOverview(admin,user);
  }

  if (key === 'teacherEvaluation') {
    if (profile.rol !== 'docente') throw Object.assign(new Error('Solo el docente puede consultar su evaluación.'), {status:403});
    return await getTeacherEvaluation(admin,user,Number(req.query?.grupo_materia_id||0),Number(req.query?.periodo_id||0));
  }

  /* -------------------------
     CONFIGURACIÓN DOCENTE
     ------------------------- */

  if (key === 'teacherConfig') {
    const {
      data,
      error
    } = await admin
      .from('docentes')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  }

  /* -------------------------
     USUARIOS DE DEPARTAMENTO
     ------------------------- */

  if (key === 'departmentUsers') {
    if (!allAdmin.includes(profile.rol)) {
      throw Object.assign(
        new Error('No autorizado.'),
        { status: 403 }
      );
    }

    const {
      data,
      error
    } = await admin
      .from('perfiles')
      .select(
        'id,nombre_completo,correo,rol,activo,correo_recuperacion'
      )
      .in(
        'rol',
        [
          'direccion_escolar',
          'control_escolar',
          'servicios_docentes',
          'servicios_estudiantiles',
          'prefectura',
          'coordinacion_academica'
        ]
      )
      .order('rol')
      .order('nombre_completo');

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     GRUPO-MATERIAS
     ------------------------- */

  if (key === 'groupSubjects') {
    const {
      data,
      error
    } = await admin
      .from('grupo_materias')
      .select(
        '*,grupos(id,clave,grado,letra,turno,hora_inicio,hora_fin,activo),materias(id,nombre,clave,grado,grados,horas_semana,activa)'
      )
      .order('id');

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     DOCENTES POR MATERIA
     ------------------------- */

  if (key === 'subjectTeachers') {
    const {
      data,
      error
    } = await admin
      .from('asignaciones_docentes')
      .select(
        '*,docentes(id,nombre_completo,especialidad,horas_solicitadas,horas_asignadas,activo),grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave,grado,grados,horas_semana))'
      )
      .eq('activo', true)
      .order('id');

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     HORARIO ADMINISTRATIVO
     ------------------------- */

  if (key === 'adminSchedules') {
    if (
      ![
        'direccion_escolar',
        'control_escolar',
        'control',
        'coordinacion_academica',
        'servicios_estudiantiles',
        'servicios_docentes'
      ].includes(profile.rol)
    ) {
      throw Object.assign(
        new Error('No autorizado.'),
        { status: 403 }
      );
    }

    const {
      data,
      error
    } = await admin
      .from('horarios')
      .select(
        '*,grupo_materias(id,grupo_id,materia_id,grupos(id,clave,grado,letra,turno,hora_inicio,hora_fin),materias(id,nombre,clave,grado,grados,horas_semana)),docente:docentes(id,nombre_completo,especialidad)'
      )
      .eq('ciclo_escolar', await activeCycle(admin))
      .order('dia_semana')
      .order('hora_inicio');

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     GRUPOS DEL DOCENTE
     ------------------------- */

  if (key === 'teacherGroups') {
    const tid = await teacherId(
      admin,
      user.id
    );
    const cycle=await activeCycle(admin);

    let {
      data,
      error
    } = await admin
      .from('asignaciones_docentes')
      .select(
        '*,grupo_materia_id,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave,grado,grados,horas_semana))'
      )
      .eq('docente_id', tid || -1)
      .eq('activo', true)
      .eq('ciclo_escolar', cycle);

    if (error) throw error;
    if (!data?.length) {
      const fallback=await admin.from('asignaciones_docentes')
        .select('*,grupo_materia_id,grupo_materias(id,grupo_id,materia_id,horas_semana,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave,grado,grados,horas_semana))')
        .eq('docente_id', tid || -1).eq('activo', true);
      if(fallback.error) throw fallback.error;
      data=fallback.data||[];
    }
    return data || [];
  }

  /* -------------------------
     HORARIO DEL DOCENTE
     ------------------------- */

  if (key === 'teacherSchedule') {
    const tid = await teacherId(
      admin,
      user.id
    );

    const {
      data,
      error
    } = await admin
      .from('horarios')
      .select(
        '*,grupo_materias(id,grupo_id,materia_id,grupos(id,clave,grado,letra,turno),materias(id,nombre,clave))'
      )
      .eq('docente_id', tid || -1)
      .eq('ciclo_escolar', await activeCycle(admin))
      .order('dia_semana')
      .order('hora_inicio');

    if (error) {
      throw error;
    }

    return data || [];
  }

  /* -------------------------
     SOLICITUDES ACADÉMICAS
     ------------------------- */
  if (key === 'academicRequests') {
    if (!['control_escolar','coordinacion_academica','direccion_escolar'].includes(profile.rol)) {
      throw Object.assign(new Error('No autorizado.'), {status:403});
    }
    let query=admin.from('solicitudes_academicas').select('*').order('id',{ascending:false}).limit(500);
    if(profile.rol==='control_escolar') query=query.eq('solicitado_por',user.id);
    const {data,error}=await query;
    if(error)throw error;
    return data||[];
  }

  /* -------------------------
     AUDITORÍA DEL SISTEMA
     ------------------------- */
  if(key==='auditLog'){
    if(!['direccion_escolar','control_escolar','control'].includes(profile.rol)) throw Object.assign(new Error('No autorizado.'),{status:403});
    const {data,error}=await admin.from('auditoria_sistema').select('*').order('created_at',{ascending:false}).limit(1000);
    if(error) throw error;
    return data||[];
  }

  /* -------------------------
     ARCHIVO ESCOLAR · CONSOLIDADO
     ------------------------- */
  if(key==='archiveSchoolRecords'){if(!isArchiveManager(profile)) throw Object.assign(new Error('El historial escolar consolidado es exclusivo de Archivo Escolar.'),{status:403}); return await archiveSchoolRecords(admin,req);}
  if(key==='archiveDashboard') {
    if(!isArchiveManager(profile)) throw Object.assign(new Error('No autorizado.'),{status:403});
    return await archiveDashboard(admin);
  }
  if(key==='archiveDocuments') return await getArchiveDocuments(admin,user,profile,req);
  if(key==='officialDocumentTypes') return await getOfficialDocumentTypes(admin,profile);
  if(key==='officialDocuments') return await getOfficialDocuments(admin,user,profile,req);
  if(key==='officialDocumentApprovals') return await getOfficialDocumentApprovals(admin,user,profile);
  if(key==='officialDocumentRequests') return await getOfficialDocumentRequests(admin,user,profile);
  if(key==='archiveAccessRequests') return await getArchiveAccessRequests(admin,user,profile);
  if(key==='archiveTransparencyRequests') return await getArchiveTransparencyRequests(admin,user,profile);
  if(key==='archiveGradeClaims') return await getArchiveGradeClaims(admin,user,profile);
  if(key==='teacherPlans') return await getTeacherPlans(admin,user,profile);

  /* -------------------------
     ARCHIVO ESCOLAR · RETENCIÓN DOCUMENTAL
     ------------------------- */
  if(key==='retentionCatalog') {
    if(profile.rol!=='archivo_escolar') throw Object.assign(new Error('El catálogo de retención documental es exclusivo de Archivo Escolar.'),{status:403});
    const {data,error}=await admin.from('catalogo_retencion_documental').select('*').eq('activo',true).order('categoria').order('codigo');
    if(error) throw error;
    return data||[];
  }

  /* -------------------------
     RECURSOS GENERALES
     ------------------------- */

  const table = resources[key];

  if (!table) {
    throw Object.assign(
      new Error('Recurso no soportado.'),
      { status: 400 }
    );
  }

  let query =
    key === 'students'
      ? admin
          .from(table)
          .select(
            '*,grupos(id,clave,grado,letra,turno)'
          )
      : admin
          .from(table)
          .select('*');

  if (profile.rol === 'docente') {
    const tid = await teacherId(
      admin,
      user.id
    );

    if (key === 'teachers') {
      query = query.eq(
        'auth_user_id',
        user.id
      );
    } else if (key === 'assignments') {
      query = query.eq(
        'docente_id',
        tid || -1
      );
    } else if (
      key === 'grades' ||
      key === 'attendance'
    ) {
      query = query.eq(
        'docente_id',
        tid || -1
      );
    } else if (key === 'students') {
      const {
        data: assignments
      } = await admin
        .from('asignaciones_docentes')
        .select('grupo_materia_id')
        .eq('docente_id', tid || -1)
        .eq('activo', true);

      const ids =
        (assignments || []).map(
          x => x.grupo_materia_id
        );

      if (ids.length) {
        const {
          data: groupSubjects
        } = await admin
          .from('grupo_materias')
          .select('grupo_id')
          .in('id', ids);

        query = query.in(
          'grupo_id',
          (groupSubjects || []).map(
            x => x.grupo_id
          )
        );
      } else {
        query = query.eq(
          'id',
          -1
        );
      }
    } else if (key === 'schedules') {
      const {
        data: assignments
      } = await admin
        .from('asignaciones_docentes')
        .select('grupo_materia_id')
        .eq('docente_id', tid || -1)
        .eq('activo', true);

      const ids =
        (assignments || []).map(
          x => x.grupo_materia_id
        );

      query = query.in(
        'grupo_materia_id',
        ids.length ? ids : [-1]
      );
    }
  } else if (profile.rol === 'alumno') {
    const student = await studentId(
      admin,
      user.id
    );

    if (key === 'periods') {
    const cycle = await activeCycle(admin);
    const currentId = Number(body?.id||0);
    const nombre = String(clean.nombre||'').trim();
    const inicio = clean.fecha_inicio || null;
    const fin = clean.fecha_fin || null;
    if(!nombre) throw Object.assign(new Error('El nombre del periodo es obligatorio.'),{status:400});
    if(inicio && fin && String(inicio)>String(fin)) throw Object.assign(new Error('La fecha de inicio no puede ser posterior a la fecha final.'),{status:400});
    let numero = Number(clean.numero_periodo||0);
    if(!currentId){
      if(!Number.isInteger(numero)||numero<1){
        const {data:last,error:le}=await admin.from('periodos_escolares').select('numero_periodo').eq('ciclo_escolar',cycle).order('numero_periodo',{ascending:false}).limit(1).maybeSingle();
        if(le) throw le;
        numero=Number(last?.numero_periodo||0)+1;
      }
      clean.ciclo_escolar=cycle;
      clean.numero_periodo=numero;
      clean.activo=true;
      clean.es_periodo_actual=false;
    }else{
      const {data:existing,error:ee}=await admin.from('periodos_escolares').select('id,ciclo_escolar,numero_periodo,es_periodo_actual').eq('id',currentId).maybeSingle();
      if(ee) throw ee;
      if(!existing) throw Object.assign(new Error('Periodo no encontrado.'),{status:404});
      if(existing.ciclo_escolar!==cycle && profile.rol!=='control') throw Object.assign(new Error('Los periodos de ciclos anteriores son históricos y no se editan desde el ciclo actual.'),{status:409});
      clean.ciclo_escolar=existing.ciclo_escolar;
      clean.numero_periodo=Number.isInteger(numero)&&numero>0?numero:existing.numero_periodo;
      delete clean.es_periodo_actual;
      delete clean.activo;
    }
  }

  if (key === 'students') {
      query = query.eq(
        'id',
        student?.id || -1
      );
    } else if (
      key === 'grades' ||
      key === 'attendance'
    ) {
      query = query.eq(
        'alumno_id',
        student?.id || -1
      );
    } else if (
      key === 'workshopEnrollments'
    ) {
      query = query.eq(
        'alumno_id',
        student?.id || -1
      );
    } else if (key === 'schedules') {
      query = query.in(
        'grupo_materia_id',
        await groupSubjectIds(
          admin,
          student?.grupo_id
        )
      );
    }
  } else if (
    profile.rol === 'servicios_docentes' ||
    profile.rol === 'coordinacion_academica'
  ) {
    if (key === 'students') {
      // Consulta completa permitida.
    }
  }

  if (key === 'notices') {
    query = query.eq(
      'activo',
      true
    );
  }

  const {
    data,
    error
  } = await query
    .order('id', {
      ascending: false
    })
    .limit(1000);

  if (error) {
    throw Object.assign(
      new Error(error.message),
      { status: 500 }
    );
  }

  if (key === 'students') {
    return await enrichStudentsWithAccounts(admin, data || []);
  }

  if (key === 'notices') {
    const noticeRows=(data||[]);
    const respIds=[...new Set(noticeRows.map(n=>n.responsable_id).filter(Boolean))];
    let respMap=new Map();
    if(respIds.length){
      const {data:rp,error:re}=await admin.from('perfiles').select('id,nombre_completo,correo').in('id',respIds);if(re)throw re;
      const {data:rr,error:rre}=await admin.from('responsables_departamento').select('usuario_id,nombre_responsable,cargo,activo').in('usuario_id',respIds);
      if(rre && !/responsables_departamento|schema cache|does not exist/i.test(rre.message||''))throw rre;
      const names=new Map((rr||[]).filter(x=>x.activo).map(x=>[String(x.usuario_id),x]));
      respMap=new Map((rp||[]).map(x=>{const r=names.get(String(x.id));return [String(x.id),{...x,nombre_completo:r?.nombre_responsable||x.nombre_completo,cargo:r?.cargo||null}]}));
    }
    return noticeRows.filter(
      notice =>
        !Array.isArray(notice.audiencia) ||
        notice.audiencia.length === 0 ||
        notice.audiencia.includes(profile.rol) ||
        notice.audiencia.includes(
          profile.rol === 'control'
            ? 'control_escolar'
            : profile.rol
        )
    ).map(notice=>({...notice,responsable:respMap.get(String(notice.responsable_id))||null}));
  }

  return data || [];
}

/* =========================================================
   PERMISOS
   ========================================================= */

function canDelete(profile, key) {
  if (key === 'notices') return noticeWriters.includes(profile.rol);
  if (key === 'periods') return false;
  if (key === 'incidencias') return ['prefectura', ...allAdmin].includes(profile.rol);
  return false;
}

function canWrite(profile, key) {
  if (key === 'notices') {
    return noticeWriters.includes(
      profile.rol
    );
  }

  if (key === 'incidencias') {
    return [
      'prefectura',
      ...allAdmin
    ].includes(profile.rol);
  }

  if (key === 'periods') return ['control_escolar','control'].includes(profile.rol);

  if (
    key === 'grades' ||
    key === 'attendance'
  ) {
    return [
      'docente',
      ...allAdmin
    ].includes(profile.rol);
  }

  if (key === 'teachers') {
    return [
      'servicios_docentes',
      'coordinacion_academica',
      ...allAdmin
    ].includes(profile.rol);
  }

  if (
    key === 'students' ||
    key === 'groups' ||
    key === 'assignments' ||
    key === 'schedules'
  ) {
    return academic.includes(profile.rol);
  }

  if (key === 'subjects' || key === 'groupSubjects') {
    return ['direccion_escolar','coordinacion_academica'].includes(profile.rol);
  }

  if (key === 'workshops') {
    return ['coordinacion_academica'].includes(profile.rol);
  }

  if (key === 'workshopEnrollments') {
    return ['servicios_estudiantiles'].includes(profile.rol);
  }

  return allAdmin.includes(
    profile.rol
  );
}

/* =========================================================
   CRUD
   ========================================================= */

async function writeResource(
  admin,
  key,
  body,
  user,
  profile
) {
  if (!canWrite(profile, key)) {
    throw Object.assign(
      new Error(
        'No tienes permisos para modificar este módulo.'
      ),
      { status: 403 }
    );
  }

  const table = resources[key];

  const clean = {
    ...body
  };

  delete clean.id;
  delete clean.created_at;
  delete clean.updated_at;

  if (key === 'notices') {
    const noticeDept=profile.rol==='docente'?'SD':departmentKeyForRole(profile.rol);
    const responsible=await validateResponsible(admin,clean.responsable_id,user?.role||profile.rol,noticeDept);
    clean.responsable_id=responsible.usuario_id;
    clean.responsable_nombre=responsible.nombre_responsable||responsible.perfil?.nombre_completo||null;
    clean.activo = true;
    clean.fecha_publicacion = new Date().toISOString();
    clean.publicado_por = user.id;
    clean.creado_por = user.id;
    clean.publicado = true;
  }

  if (key === 'incidencias') {
    clean.creado_por = user.id;
  }

  if (key === 'students') {
    const mat=String(clean.matricula||'').replace(/\s+/g,'').toLowerCase();
    if(!mat) throw Object.assign(new Error('La matrícula es obligatoria para el alumno.'),{status:400});
    clean.matricula=mat;
      }

  if (key === 'schedules') {
    const gmId = Number(clean.grupo_materia_id || 0);
    const teacherIdValue = clean.docente_id == null || clean.docente_id === '' ? null : Number(clean.docente_id);
    const day = Number(clean.dia_semana || 0);
    const start = String(clean.hora_inicio || '').slice(0,5);
    const end = String(clean.hora_fin || '').slice(0,5);
    const cycle = await activeCycle(admin);
    if (!gmId || day < 1 || day > 5 || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) throw Object.assign(new Error('Horario manual inválido.'), {status:400});
    const {data:gm,error:gmError}=await admin.from('grupo_materias').select('id,grupo_id,grupos(id,clave,turno)').eq('id',gmId).maybeSingle();
    if(gmError) throw gmError;
    if(!gm) throw Object.assign(new Error('Grupo-materia no encontrado.'), {status:404});
    const validStarts = String(gm.grupos?.turno||'').toUpperCase()==='VESPERTINO' ? ['15:00','16:00','17:00','18:30','19:30','20:30'] : ['07:00','08:00','09:00','10:30','11:30','12:30'];
    const validEnds = String(gm.grupos?.turno||'').toUpperCase()==='VESPERTINO' ? ['16:00','17:00','18:00','19:30','20:30','21:30'] : ['08:00','09:00','10:00','11:30','12:30','13:30'];
    const slotIndex=validStarts.indexOf(start);
    if(slotIndex<0 || validEnds[slotIndex]!==end) throw Object.assign(new Error(`El horario no corresponde al turno del grupo ${gm.grupos?.clave||''}.`), {status:400});
    const {data:groupConflict,error:gcError}=await admin.from('horarios').select('id').eq('ciclo_escolar',cycle).eq('dia_semana',day).eq('hora_inicio',start).in('grupo_materia_id',await groupSubjectIds(admin,gm.grupo_id)).limit(1);
    if(gcError) throw gcError;
    if(groupConflict?.length) throw Object.assign(new Error('El grupo ya tiene una materia en ese día y hora.'), {status:409});
    if(teacherIdValue){
      const {data:teacherConflict,error:tcError}=await admin.from('horarios').select('id').eq('ciclo_escolar',cycle).eq('dia_semana',day).eq('hora_inicio',start).eq('docente_id',teacherIdValue).limit(1);
      if(tcError) throw tcError;
      if(teacherConflict?.length) throw Object.assign(new Error('El docente ya tiene una clase en ese día y hora.'), {status:409});
    }
    clean.ciclo_escolar=cycle;
    clean.dia_semana=day;
    clean.hora_inicio=start;
    clean.hora_fin=end;
    clean.docente_id=teacherIdValue;
  }

  if (key === 'workshopEnrollments') {
    const alumnoId = Number(clean.alumno_id || 0);
    const tallerId = Number(clean.taller_id || 0);
    if (!alumnoId || !tallerId) throw Object.assign(new Error('Alumno y taller son obligatorios.'), {status:400});
    const {data:alumno,error:ae}=await admin.from('alumnos').select('id,nombre_completo,activo').eq('id',alumnoId).maybeSingle();
    if(ae) throw ae;
    if(!alumno || alumno.activo===false) throw Object.assign(new Error('El alumno no está disponible.'),{status:400});
    const {data:taller,error:te}=await admin.from('talleres').select('id,nombre,activo').eq('id',tallerId).maybeSingle();
    if(te) throw te;
    if(!taller || taller.activo===false) throw Object.assign(new Error('El taller no está disponible.'),{status:400});
    const ciclo=await activeCycle(admin);
    const {data:actual,error:ae2}=await admin.from('inscripciones_talleres').select('id,taller_id').eq('alumno_id',alumnoId).eq('ciclo_escolar',ciclo).eq('estado','inscrito').order('id',{ascending:false}).limit(1).maybeSingle();
    if(ae2) throw ae2;
    if(actual?.id) await admin.from('inscripciones_talleres').update({estado:'cambio'}).eq('id',actual.id);
    clean.ciclo_escolar=ciclo;
    clean.estado='inscrito';
    clean.fecha_inscripcion=clean.fecha_inscripcion||new Date().toISOString().slice(0,10);
  }

  let {data,error}=await admin.from(table).insert(clean).select('*').single();
  if (error) throw Object.assign(new Error(error.message),{status:400});

  if (
    key === 'assignments' &&
    clean.docente_id
  ) {
    await admin.rpc(
      'recalcular_horas_docente',
      {
        p_docente_id:
          clean.docente_id
      }
    );
  }

  return data;
}

async function updateResource(
  admin,
  key,
  id,
  body,
  user,
  profile
) {
  if (!canWrite(profile, key)) {
    throw Object.assign(
      new Error(
        'No tienes permisos para modificar este módulo.'
      ),
      { status: 403 }
    );
  }

  const table = resources[key];

  const clean = {
    ...body
  };

  delete clean.id;
  delete clean.created_at;
  delete clean.updated_at;

  if (key === 'periods') {
    const {data:existing,error:ee}=await admin.from('periodos_escolares').select('id,ciclo_escolar,es_periodo_actual,numero_periodo').eq('id',id).maybeSingle();
    if(ee) throw ee; if(!existing) throw Object.assign(new Error('Periodo no encontrado.'),{status:404});
    if(existing.ciclo_escolar!==await activeCycle(admin)) throw Object.assign(new Error('Los periodos de ciclos anteriores son históricos y no se modifican desde esta pantalla.'),{status:409});
    const nombre=String(clean.nombre||'').trim(); if(!nombre) throw Object.assign(new Error('El nombre del periodo es obligatorio.'),{status:400});
    if(clean.fecha_inicio && clean.fecha_fin && String(clean.fecha_inicio)>String(clean.fecha_fin)) throw Object.assign(new Error('La fecha de inicio no puede ser posterior a la fecha final.'),{status:400});
    clean.ciclo_escolar=existing.ciclo_escolar;
    clean.numero_periodo=Number(clean.numero_periodo||existing.numero_periodo||0);
    if(!Number.isInteger(clean.numero_periodo)||clean.numero_periodo<1) throw Object.assign(new Error('El número de periodo no es válido.'),{status:400});
    delete clean.es_periodo_actual;
    delete clean.activo;
  }

  if (key === 'students') {
    const {data:currentStudent,error:studentError}=await admin.from('alumnos').select('id,matricula,auth_user_id,grupo_id,grado_ingreso').eq('id',id).maybeSingle();
    if(studentError) throw studentError;
    if(!currentStudent) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
    if(profile.rol==='control_escolar' && clean.grupo_id!==undefined && String(clean.grupo_id||'')!==String(currentStudent.grupo_id||'')) throw Object.assign(new Error('El cambio directo de grupo se realiza desde Más acciones > Cambiar grupo, para dejarlo registrado correctamente.'),{status:403});
    if(profile.rol==='control_escolar' && clean.grado_ingreso!==undefined && Number(clean.grado_ingreso)!==Number(currentStudent.grado_ingreso||0)) throw Object.assign(new Error('Los cambios de grado solo pueden ejecutarse mediante un cambio especial autorizado por todos los departamentos.'),{status:403});
    const nextMat=clean.matricula===undefined?String(currentStudent.matricula||'').replace(/\s+/g,'').toLowerCase():String(clean.matricula||'').replace(/\s+/g,'').toLowerCase();
    if(!nextMat) throw Object.assign(new Error('La matrícula es obligatoria para el alumno.'),{status:400});
    if(currentStudent.auth_user_id && nextMat!==String(currentStudent.matricula||'').replace(/\s+/g,'').toLowerCase()) throw Object.assign(new Error('No se puede cambiar la matrícula de un alumno que ya tiene una cuenta institucional.'),{status:409});
    clean.matricula=nextMat;
      }

  if (key === 'incidencias') {
    clean.creado_por = user.id;
  }

  const {
    data,
    error
  } = await admin
    .from(table)
    .update(clean)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw Object.assign(
      new Error(error.message),
      { status: 400 }
    );
  }

  if (
    key === 'assignments' &&
    clean.docente_id
  ) {
    await admin.rpc(
      'recalcular_horas_docente',
      {
        p_docente_id:
          clean.docente_id
      }
    );
  }

  return data;
}

async function deleteResource(
  admin,
  key,
  id,
  user,
  profile,
  req
) {
  if (!canDelete(profile, key)) {
    throw Object.assign(
      new Error('Los registros académicos y de expediente no se eliminan de forma genérica. Usa la operación de archivo, cierre o baja correspondiente.'),
      { status: 403 }
    );
  }

  const {data:before,error:be}=await admin
    .from(resources[key])
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (be) throw be;
  if (!before) throw Object.assign(new Error('Registro no encontrado.'),{status:404});
  if(key==='notices' && String(before.creado_por||before.publicado_por||'')!==String(user.id)) throw Object.assign(new Error('Solo puedes borrar un aviso que tú publicaste.'),{status:403});
  if(key==='periods') throw Object.assign(new Error('Los periodos no se eliminan. Se conservan para el historial escolar.'),{status:403});

  const {error} = await admin
    .from(resources[key])
    .delete()
    .eq('id', id);

  if (error) {
    throw Object.assign(
      new Error(error.message),
      { status: 400 }
    );
  }

  await audit(admin,{userId:user.id,role:profile.rol,action:'delete_resource',module:key,entity:resources[key],entityId:id,description:`Eliminación controlada de ${resources[key]} #${id}.`,before,req});

  return {id};
}

/* =========================================================
   HANDLER PRINCIPAL
   ========================================================= */


async function lateStudentCredentialsPdf({nombre_completo,matricula,email,temporary_password}){
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('ITHLA — DATOS DE ACCESO',{x:48,y:735,size:20,font:bold});
  page.drawText('ITHLA · Alta directa de alumno',{x:48,y:712,size:10,font:regular});
  let y=660;
  for(const [k,v] of [['Nombre completo',nombre_completo],['Matrícula',matricula],['Usuario',email],['Contraseña temporal',temporary_password]]){
    page.drawText(k,{x:48,y,size:11,font:bold});
    page.drawText(String(v||'—'),{x:190,y,size:11,font:regular});
    y-=30;
  }
  page.drawText('El alumno debe cambiar la contraseña en su primer acceso.',{x:48,y:y-12,size:9,font:regular});
  return Buffer.from(await pdf.save()).toString('base64');
}
function lateTempPassword(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out='ITHLA-';
  for(let i=0;i<10;i++)out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}
async function findAuthUserByEmail(admin,email){
  const target=String(email||'').trim().toLowerCase();
  for(let page=1;page<=10;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
    if(error)throw error;
    const found=(data?.users||[]).find(u=>String(u.email||'').toLowerCase()===target);
    if(found)return found;
    if((data?.users||[]).length<1000)break;
  }
  return null;
}
function normalizeNameParts(nombre){
  const clean=String(nombre||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z\s]/g,' ').trim().toUpperCase();
  const parts=clean.split(/\s+/).filter(Boolean);
  if(!parts.length)return {prefix:'ALUXXX',parts:[]};
  // Nombre + apellido paterno + apellido materno: 3 + 2 + 1 = 6 caracteres.
  const first=parts[0]||'ALU';
  const paterno=parts.length>=2?parts[parts.length-2]:'';
  const materno=parts.length>=3?parts[parts.length-1]:'';
  const prefix=(first.slice(0,3)+paterno.slice(0,2)+materno.slice(0,1)).padEnd(6,'X').slice(0,6);
  return {prefix,parts};
}
function randomDistinctDigits(){
  const a=Math.floor(Math.random()*10);
  let b=Math.floor(Math.random()*10);
  while(b===a)b=Math.floor(Math.random()*10);
  return `${a}${b}`;
}
function randomUpperLetter(){return String.fromCharCode(65+Math.floor(Math.random()*26));}
async function generateJaguarMatricula(admin,{nombre,sexo,grupo,turno}){
  const {prefix}=normalizeNameParts(nombre);
  const sexCode=String(sexo||'').toLowerCase().startsWith('muj')?'M':String(sexo||'').toLowerCase().startsWith('hom')?'H':String(sexo||'').toUpperCase()==='M'?'M':'H';
  const groupLetter=String(grupo?.letra||String(grupo?.clave||'').match(/[A-Z]$/i)?.[0]||'').toUpperCase();
  const shift=String(turno||grupo?.turno||'').toUpperCase().startsWith('V')?'V':'M';
  if(!/^[A-Z]$/.test(groupLetter))throw Object.assign(new Error('El grupo seleccionado no tiene una letra válida.'),{status:400});
  for(let attempt=0;attempt<100;attempt++){
    const numero=randomDistinctDigits();
    const randomLetter=randomUpperLetter();
    const controlLetter=randomUpperLetter();
    const controlDigit=Math.floor(Math.random()*10);
    const matricula=`${prefix}-${sexCode}${numero}${groupLetter}${shift}${randomLetter}${controlLetter}${controlDigit}`;
    const {data:alumno,error:ae}=await admin.from('alumnos').select('id').eq('matricula',matricula).maybeSingle();
    if(ae)throw ae;
    if(alumno)continue;
    const {data:mat,error:me}=await admin.from('matricula_alumnos').select('id').eq('numero_matricula',matricula).maybeSingle();
    if(me && !String(me.message||'').toLowerCase().includes('does not exist'))throw me;
    if(mat)continue;
    return matricula;
  }
  throw Object.assign(new Error('No se pudo generar una matrícula única. Intenta nuevamente.'),{status:409});
}
async function renewActiveMatriculas(admin,user,profile,{dryRun=true}={}){
  if(!['control_escolar','direccion_escolar','control'].includes(profile.rol)) throw Object.assign(new Error('Solo Control Escolar o Dirección Escolar pueden renovar matrículas.'),{status:403});
  const cycle=await activeCycle(admin);
  const {data:students,error}=await admin.from('alumnos').select('id,nombre_completo,matricula,sexo,curp,auth_user_id,grupo_id,grado_ingreso,turno,activo,grupos(id,clave,grado,letra,turno,activo)').eq('activo',true).not('grupo_id','is',null).order('id');
  if(error)throw error;
  const used=new Set((students||[]).map(x=>String(x.matricula||'').toUpperCase()).filter(Boolean));
  const rows=[],pending=[];
  for(const st of students||[]){
    const g=st.grupos;
    if(!g?.id){pending.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:st.matricula||'—',motivo:'Sin grupo activo.'});continue;}
    let sexo=String(st.sexo||'').trim();
    if(!['Hombre','Mujer'].includes(sexo)){
      const old=String(st.matricula||'').toUpperCase();
      const m=old.match(/^[A-Z]{6}-([HM])/);
      const c=String(st.curp||'').toUpperCase().charAt(10);
      if(m?.[1]==='H'||c==='H')sexo='Hombre'; else if(m?.[1]==='M'||c==='M')sexo='Mujer';
    }
    if(!['Hombre','Mujer'].includes(sexo)){pending.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:st.matricula||'—',motivo:'Falta sexo registrado y no se pudo identificar de forma segura.'});continue;}
    let nuevo=null;
    for(let tries=0;tries<20;tries++){
      const candidate=await generateJaguarMatricula(admin,{nombre:st.nombre_completo,sexo,grupo:g,turno:g.turno||st.turno});
      if(!used.has(candidate.toUpperCase())){nuevo=candidate;break;}
    }
    if(!nuevo){pending.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:st.matricula||'—',motivo:'No se pudo generar una matrícula única.'});continue;}
    used.add(nuevo.toUpperCase());
    rows.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:st.matricula||'—',matricula_nueva:nuevo,grupo:g.clave||'—',sexo});
    if(!dryRun){
      const old=String(st.matricula||'').trim();
      const oldEmail=st.auth_user_id?await institutionalEmail(admin,old):null;
      const newEmail=st.auth_user_id?await institutionalEmail(admin,nuevo):null;
      const {error:ue}=await admin.from('alumnos').update({matricula:nuevo}).eq('id',st.id);
      if(ue)throw ue;
      try{
        if(old && st.auth_user_id){const {error:ae}=await admin.auth.admin.updateUserById(st.auth_user_id,{email:newEmail,email_confirm:true,user_metadata:{...(st.user_metadata||{}),matricula:nuevo,login_email:newEmail}});if(ae)throw ae;const {error:pe}=await admin.from('perfiles').update({matricula:nuevo,correo:newEmail,correo_auth:newEmail}).eq('id',st.auth_user_id);if(pe)throw pe;}
        if(old){
          const {data:mr,error:me}=await admin.from('matricula_alumnos').select('id').eq('numero_matricula',old).maybeSingle();
          if(!me&&mr){
            let mu=await admin.from('matricula_alumnos').update({numero_matricula:nuevo,matricula_anterior:old}).eq('id',mr.id);
            if(mu.error&&/matricula_anterior.*does not exist|schema cache/i.test(mu.error.message||'')) mu=await admin.from('matricula_alumnos').update({numero_matricula:nuevo}).eq('id',mr.id);
            if(mu.error&&!/does not exist|schema cache/i.test(mu.error.message||''))throw mu.error;
          }
        }
        const {error:le}=await admin.from('matricula_migraciones').insert({alumno_id:st.id,matricula_anterior:old||null,matricula_nueva:nuevo,sexo_fuente:sexo,ciclo_escolar:cycle,ejecutado_por:user.id});
        if(le)throw le;
      }catch(e){
        await admin.from('alumnos').update({matricula:old}).eq('id',st.id);
        if(st.auth_user_id&&oldEmail){try{await admin.auth.admin.updateUserById(st.auth_user_id,{email:oldEmail,email_confirm:true,user_metadata:{matricula:old,login_email:oldEmail}});}catch(_){}}
        throw e;
      }
    }
  }
  return {dry_run:dryRun,cycle,total:(students||[]).length,preview:rows,pending,actualizados:dryRun?0:rows.length,pendientes:pending.length};
}

function jaguarTempPassword(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out='JG';
  for(let i=0;i<12;i++) out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}

async function provisionNewStudentAccount(admin, {alumnoId,nombre_completo,matricula}){
  const email=await institutionalEmail(admin,matricula);
  const password=jaguarTempPassword();
  const {data:created,error:ae}=await admin.auth.admin.createUser({
    email,
    password,
    email_confirm:true,
    user_metadata:{rol:'alumno',matricula,login_email:email,must_change_password:true}
  });
  if(ae) throw Object.assign(new Error(`No se pudo crear el acceso institucional: ${ae.message}`),{status:400});
  const uid=created.user.id;
  try{
    const {error:pe}=await admin.from('perfiles').insert({
      id:uid,
      nombre_completo,
      correo:email,
      correo_auth:email,
      correo_recuperacion:null,
      rol:'alumno',
      activo:true,
      matricula
    });
    if(pe) throw pe;
    const {error:al}=await admin.from('alumnos').update({auth_user_id:uid}).eq('id',alumnoId);
    if(al) throw al;
    return {created:true,user_id:uid,email,temporary_password:password};
  }catch(error){
    try{await admin.from('perfiles').delete().eq('id',uid);}catch{}
    try{await admin.auth.admin.deleteUser(uid);}catch{}
    throw Object.assign(new Error(error.message||'No se pudo vincular el acceso del alumno.'),{status:400});
  }
}

async function createLateStudent(admin,user,profile,body){
  if(profile.rol!=='control_escolar')throw Object.assign(new Error('Solo Control Escolar puede registrar alumnos nuevos.'),{status:403});
  const b=body||{};
  const nombre=String(b.nombre_completo||'').trim();
  if(!nombre)throw Object.assign(new Error('El nombre completo es obligatorio.'),{status:400});
  const grado=Number(b.grado||0);
  if(!Number.isInteger(grado)||grado<1||grado>3)throw Object.assign(new Error('Selecciona un grado válido: 1°, 2° o 3°.'),{status:400});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.correo_personal||'').trim()))throw Object.assign(new Error('El correo personal no es válido.'),{status:400});
  const curp=String(b.curp||'').trim().toUpperCase(); if(!/^[A-Z0-9]{18}$/.test(curp))throw Object.assign(new Error('La CURP debe tener 18 caracteres alfanuméricos.'),{status:400});
  const sexo=String(b.sexo||'').trim(); if(!['Hombre','Mujer'].includes(sexo))throw Object.assign(new Error('Selecciona el sexo del alumno.'),{status:400});
  const telefono=String(b.telefono||'').replace(/\s+/g,''); const telefonoTutor=String(b.telefono_tutor||'').replace(/\s+/g,''); if(!/^\d{10}$/.test(telefono)||!/^\d{10}$/.test(telefonoTutor))throw Object.assign(new Error('Los teléfonos deben tener 10 dígitos.'),{status:400});
  const cp=String(b.codigo_postal||'').replace(/\s+/g,''); if(!/^\d{5}$/.test(cp))throw Object.assign(new Error('El código postal debe tener 5 dígitos.'),{status:400});
  const birth=String(b.fecha_nacimiento||'').trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(Date.parse(birth)))throw Object.assign(new Error('La fecha de nacimiento no es válida.'),{status:400});
  const avg=Number(b.promedio);if(!Number.isFinite(avg)||avg<0||avg>10)throw Object.assign(new Error('El promedio debe estar entre 0 y 10.'),{status:400});

  const {data:existingCurp,error:curpError}=await admin.from('alumnos').select('id,nombre_completo,matricula').eq('curp',curp).maybeSingle();
  if(curpError)throw curpError;
  if(existingCurp)throw Object.assign(new Error(`Ya existe un alumno con esa CURP (${existingCurp.matricula||'sin matrícula'}). Si se trata del mismo alumno, no vuelvas a registrarlo.`),{status:409});

  const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno').eq('activo',true);
  if(ge)throw ge;
  const gradeGroups=(groups||[]).filter(g=>Number(g.grado)===grado);
  if(!gradeGroups.length)throw Object.assign(new Error(`No hay grupos activos disponibles para ${grado}°.`),{status:400});
  const cap=await groupCapacity(admin,gradeGroups.map(g=>g.id));
  const available=gradeGroups.filter(g=>!cap[String(g.id)]?.lleno);
  if(!available.length)throw Object.assign(new Error(`No hay grupos con cupo disponible para ${grado}°. Todos tienen 40 alumnos activos.`),{status:409});
  const group=available[Math.floor(Math.random()*available.length)];
  const turno=String(group.turno||'').trim();
  const ficha=`ALT-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  const municipality=`${String(b.colonia||'').trim()}, ${String(b.municipio||'').trim()}, ${String(b.estado||'').trim()}`.replace(/^,\s*|,\s*$/g,'');
  const base={numero_ficha:ficha,nombre_completo:nombre,curp,fecha_nacimiento:birth,escuela_origen:String(b.escuela_origen||'').trim(),promedio:avg,taller:'Sin taller extracurricular',turno,correo:String(b.correo_personal||'').trim().toLowerCase(),telefono,calle_numero:String(b.calle_numero||'').trim(),codigo_postal:cp,municipio:municipality,modalidad_ingreso:String(b.modalidad_ingreso||'').trim()||'Otro',nombre_tutor:String(b.nombre_tutor||'').trim(),telefono_tutor:telefonoTutor,estado:'activo',grupo_id:group.id};
  let alumnoId=null,matriculaId=null,cleanMat=null;
  try{
    // La matrícula se intenta en la misma operación lógica que el alta. Si hay una colisión
    // (por ejemplo dos clics simultáneos), se genera otra antes de reintentar el alumno.
    let created=null,lastError=null;
    for(let attempt=0;attempt<20;attempt++){
      cleanMat=await generateJaguarMatricula(admin,{nombre,sexo,grupo:group,turno});
      const ins=await admin.from('alumnos').insert({matricula:cleanMat,nombre_completo:nombre,curp:base.curp,fecha_nacimiento:base.fecha_nacimiento,grupo_id:group.id,grado_ingreso:grado,turno,sexo,activo:true}).select('*').single();
      if(!ins.error){created=ins.data;break;}
      lastError=ins.error;
      if(!/duplicate key value violates unique constraint.*alumnos_matricula_key/i.test(ins.error.message||''))break;
    }
    if(!created)throw Object.assign(new Error(`No se pudo crear el registro del alumno: ${lastError?.message||'error desconocido'}`),{status:400});
    alumnoId=created.id;

    // La tabla histórica se registra DESPUÉS del alumno principal. Así una colisión
    // en alumnos_matricula_key nunca deja una matrícula huérfana ni obliga a duplicar clics.
    const legacy={...base,numero_matricula:cleanMat};
    let mm=await admin.from('matricula_alumnos').insert([legacy]).select('id').single();
    if(mm.error){
      // Instalaciones antiguas pueden tener menos columnas. Intentamos un formato mínimo.
      const minimal={numero_matricula:cleanMat,nombre_completo:nombre,curp,fecha_nacimiento:birth,grupo_id:group.id,estado:'activo'};
      const retry=await admin.from('matricula_alumnos').insert([minimal]).select('id').single();
      if(!retry.error)mm=retry;
    }
    if(mm.error){
      if(/duplicate key|schema cache|does not exist/i.test(mm.error.message||'')){
        console.warn('No se pudo registrar matricula_alumnos; se conserva el alta principal:',mm.error.message);
      }else throw Object.assign(new Error(`No se pudo guardar el historial de matrícula: ${mm.error.message}`),{status:400});
    }else matriculaId=mm.data?.id||null;

    const account=await provisionNewStudentAccount(admin,{alumnoId,nombre_completo:nombre,matricula:cleanMat});
    let pdf_base64=null;
    try{pdf_base64=await lateStudentCredentialsPdf({nombre_completo:nombre,matricula:cleanMat,email:account.email,temporary_password:account.temporary_password});}catch(e){console.warn('No se pudo generar PDF de credenciales:',e.message)}
    return {alumno:{...created,auth_user_id:account.user_id},grupo:group,matricula:cleanMat,account:{...account,pdf_base64},ficha,bienvenida:true};
  }catch(e){
    if(alumnoId)await admin.from('alumnos').delete().eq('id',alumnoId);
    if(matriculaId)await admin.from('matricula_alumnos').delete().eq('id',matriculaId);
    throw e;
  }
}


async function createLateStudentsBulk(admin,user,profile,rows){
  if(profile.rol!=='control_escolar')throw Object.assign(new Error('Solo Control Escolar puede registrar alumnos nuevos.'),{status:403});
  if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error('No se recibieron alumnos para importar.'),{status:400});
  if(rows.length>500)throw Object.assign(new Error('La importación masiva permite hasta 500 alumnos por archivo.'),{status:400});

  const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno').eq('activo',true).order('grado').order('letra');
  if(ge)throw ge;
  const activeGroups=groups||[];
  const cap=await groupCapacity(admin,activeGroups.map(g=>g.id));
  const counts=Object.fromEntries(activeGroups.map(g=>[String(g.id),cap[String(g.id)]?.ocupados||0]));
  const initialCapacityByGrade={};
  for(const g of activeGroups){const free=Math.max(0,40-(counts[String(g.id)]||0));initialCapacityByGrade[g.grado]=(initialCapacityByGrade[g.grado]||0)+free;}
  const rejectedCupo=[],errors=[],accepted=[];
  const seenCurps=new Set();

  const normalize=(r,k)=>String(r?.[k]??'').trim();
  for(let index=0;index<rows.length;index++){
    const b=rows[index]||{};
    const original={...b};
    const line=index+2;
    const nombre=normalize(b,'nombre_completo');
    const grado=Number(b.grado||0);
    const curp=normalize(b,'curp').toUpperCase();
    const sexoRaw=normalize(b,'sexo');
    const sexo=({
      hombre:'Hombre',
      masculino:'Hombre',
      h:'Hombre',
      mujer:'Mujer',
      femenino:'Mujer',
      m:'Mujer'
    })[sexoRaw.toLowerCase()]||sexoRaw;
    const correo=normalize(b,'correo_personal').toLowerCase();
    const telefono=normalize(b,'telefono').replace(/\s+/g,'');
    const telefonoTutor=normalize(b,'telefono_tutor').replace(/\s+/g,'');
    const cp=normalize(b,'codigo_postal').replace(/\s+/g,'');
    const birth=normalize(b,'fecha_nacimiento');
    const avg=Number(b.promedio);
    const required=[nombre,curp,birth,sexo,normalize(b,'escuela_origen'),correo,telefono,normalize(b,'calle_numero'),cp,normalize(b,'colonia'),normalize(b,'municipio'),normalize(b,'estado'),normalize(b,'nombre_tutor'),telefonoTutor];
    if(!required.every(Boolean)||!grado||!Number.isInteger(grado)||grado<1||grado>3){errors.push({...original,numero_fila:line,motivo:'Datos obligatorios incompletos o grado inválido.'});continue;}
    if(!/^[A-Z0-9]{18}$/.test(curp)){errors.push({...original,numero_fila:line,motivo:'CURP inválida: debe tener 18 caracteres alfanuméricos.'});continue;}
    if(seenCurps.has(curp)){errors.push({...original,numero_fila:line,motivo:'CURP duplicada dentro del archivo.'});continue;}
    seenCurps.add(curp);
    if(!['Hombre','Mujer'].includes(sexo)){errors.push({...original,numero_fila:line,motivo:'Sexo inválido.'});continue;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)){errors.push({...original,numero_fila:line,motivo:'Correo personal inválido.'});continue;}
    if(!/^\d{10}$/.test(telefono)||!/^\d{10}$/.test(telefonoTutor)){errors.push({...original,numero_fila:line,motivo:'Los teléfonos deben tener 10 dígitos.'});continue;}
    if(!/^\d{5}$/.test(cp)){errors.push({...original,numero_fila:line,motivo:'Código postal inválido.'});continue;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(Date.parse(birth))){errors.push({...original,numero_fila:line,motivo:'Fecha de nacimiento inválida. Usa AAAA-MM-DD.'});continue;}
    if(!Number.isFinite(avg)||avg<0||avg>10){errors.push({...original,numero_fila:line,motivo:'Promedio inválido: debe estar entre 0 y 10.'});continue;}

    const {data:existingCurp,error:curpError}=await admin.from('alumnos').select('id,nombre_completo,matricula').eq('curp',curp).maybeSingle();
    if(curpError)throw curpError;
    if(existingCurp){errors.push({...original,numero_fila:line,motivo:`La CURP ya está registrada (${existingCurp.matricula||'sin matrícula'}).`});continue;}

    const gradeGroups=activeGroups.filter(g=>Number(g.grado)===grado);
    const available=gradeGroups.filter(g=>(counts[String(g.id)]||0)<40);
    if(!available.length){rejectedCupo.push({...original,numero_fila:line,motivo:`Sin cupo en ${grado}°: todos sus grupos tienen 40 alumnos activos.`});continue;}

    // Elegir aleatoriamente entre los grupos con mayor disponibilidad para repartir la carga sin sesgo fijo.
    const maxFree=Math.max(...available.map(g=>40-(counts[String(g.id)]||0)));
    const balanced=available.filter(g=>40-(counts[String(g.id)]||0)===maxFree);
    const group=balanced[Math.floor(Math.random()*balanced.length)];
    let alumnoId=null,matriculaId=null;
    try{
      const turno=String(group.turno||'').trim();
      let cleanMat=null,created=null,lastError=null;
      for(let attempt=0;attempt<20;attempt++){
        cleanMat=await generateJaguarMatricula(admin,{nombre,sexo,grupo:group,turno});
        const ins=await admin.from('alumnos').insert({matricula:cleanMat,nombre_completo:nombre,curp,fecha_nacimiento:birth,grupo_id:group.id,grado_ingreso:grado,turno,sexo,activo:true}).select('*').single();
        if(!ins.error){created=ins.data;break;}
        lastError=ins.error;
        if(!/duplicate key value violates unique constraint.*alumnos_matricula_key/i.test(ins.error.message||''))break;
      }
      if(!created)throw Object.assign(new Error(lastError?.message||'No se pudo crear el alumno.'),{status:400});
      alumnoId=created.id;
      const municipality=`${normalize(b,'colonia')}, ${normalize(b,'municipio')}, ${normalize(b,'estado')}`.replace(/^,\s*|,\s*$/g,'');
      const legacy={numero_ficha:`ALT-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`,nombre_completo:nombre,curp,fecha_nacimiento:birth,escuela_origen:normalize(b,'escuela_origen'),promedio:avg,taller:'Sin taller extracurricular',turno,correo,telefono,calle_numero:normalize(b,'calle_numero'),codigo_postal:cp,municipio:municipality,modalidad_ingreso:normalize(b,'modalidad_ingreso')||'Otro',nombre_tutor:normalize(b,'nombre_tutor'),telefono_tutor:telefonoTutor,estado:'activo',grupo_id:group.id,numero_matricula:cleanMat};
      let mm=await admin.from('matricula_alumnos').insert([legacy]).select('id').single();
      if(mm.error){const minimal={numero_matricula:cleanMat,nombre_completo:nombre,curp,fecha_nacimiento:birth,grupo_id:group.id,estado:'activo'};const retry=await admin.from('matricula_alumnos').insert([minimal]).select('id').single();if(!retry.error)mm=retry;}
      if(mm.error && !/duplicate key|schema cache|does not exist/i.test(mm.error.message||''))throw Object.assign(new Error(mm.error.message),{status:400});
      matriculaId=mm.data?.id||null;
      const account=await provisionNewStudentAccount(admin,{alumnoId,nombre_completo:nombre,matricula:cleanMat});
      counts[String(group.id)]=(counts[String(group.id)]||0)+1;
      accepted.push({linea:line,nombre_completo:nombre,matricula:cleanMat,grupo:group.clave,grado,turno,correo_institucional:account.email,temporary_password:account.temporary_password});
    }catch(e){
      if(alumnoId)await admin.from('alumnos').delete().eq('id',alumnoId);
      if(matriculaId)await admin.from('matricula_alumnos').delete().eq('id',matriculaId);
      errors.push({...original,numero_fila:line,motivo:e.message||'No se pudo registrar.'});
    }
  }
  const resumen_grados=Object.fromEntries([1,2,3].map(g=>{const requested=rows.filter(r=>Number(r?.grado||0)===g).length;const inscritos=accepted.filter(r=>Number(r.grado)===g).length;const sin_cupo=rejectedCupo.filter(r=>Number(r.grado)===g).length;return [String(g),{solicitados:requested,cupo_inicial:initialCapacityByGrade[g]||0,inscritos,sin_cupo}];}));
  return {recibidos:rows.length,inscritos:accepted.length,sin_cupo:rejectedCupo.length,con_error:errors.length,resumen_grados,aceptados:accepted,rechazados_cupo:rejectedCupo,errores:errors};
}

async function assignRandomWorkshops(admin,user,profile){
  if(profile.rol!=='servicios_estudiantiles')throw Object.assign(new Error('Solo Servicios Estudiantiles puede asignar talleres automáticamente.'),{status:403});
  const cycle=await activeCycle(admin);
  const [{data:students,error:se},{data:workshops,error:we},{data:ins,error:ie}]=await Promise.all([
    admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id').eq('activo',true),
    admin.from('talleres').select('id,nombre,cupo').eq('activo',true),
    admin.from('inscripciones_talleres').select('id,alumno_id,taller_id,estado,ciclo_escolar').eq('ciclo_escolar',cycle)
  ]);
  if(se)throw se;if(we)throw we;if(ie)throw ie;
  const current=new Set((ins||[]).filter(x=>x.estado==='inscrito').map(x=>Number(x.alumno_id)));
  const pending=(students||[]).filter(s=>!current.has(Number(s.id)));
  if(!pending.length)return {ciclo:cycle,total_sin_taller:0,asignados:0,sin_cupo:0,detalles:[]};
  const counts=Object.fromEntries((workshops||[]).map(w=>[String(w.id),0]));
  for(const x of (ins||[]).filter(x=>x.estado==='inscrito'))counts[String(x.taller_id)]=(counts[String(x.taller_id)]||0)+1;
  const priorByPair=new Map((ins||[]).map(x=>[`${x.alumno_id}|${x.taller_id}`,x]));
  const pool=(workshops||[]).filter(w=>Number(w.cupo||0)>0);
  const detalles=[],sinCupo=[];
  for(const student of pending.sort(()=>Math.random()-.5)){
    const available=pool.filter(w=>(counts[String(w.id)]||0)<Number(w.cupo));
    if(!available.length){sinCupo.push({id:student.id,nombre_completo:student.nombre_completo,matricula:student.matricula});continue;}
    // Aleatorio entre talleres que todavía tienen cupo; se favorece a los de mayor espacio para evitar saturación prematura.
    const maxFree=Math.max(...available.map(w=>Number(w.cupo)-(counts[String(w.id)]||0)));
    const candidates=available.filter(w=>Number(w.cupo)-(counts[String(w.id)]||0)>=Math.max(1,maxFree-1));
    const workshop=candidates[Math.floor(Math.random()*candidates.length)];
    const existing=priorByPair.get(`${student.id}|${workshop.id}`);
    let error=null;
    if(existing){
      const {error:e}=await admin.from('inscripciones_talleres').update({estado:'inscrito',fecha_inscripcion:new Date().toISOString().slice(0,10)}).eq('id',existing.id);
      error=e;
    }else{
      const {error:e}=await admin.from('inscripciones_talleres').insert({alumno_id:student.id,taller_id:workshop.id,ciclo_escolar:cycle,estado:'inscrito',fecha_inscripcion:new Date().toISOString().slice(0,10)});
      error=e;
    }
    if(error){sinCupo.push({id:student.id,nombre_completo:student.nombre_completo,matricula:student.matricula,motivo:error.message});continue;}
    priorByPair.set(`${student.id}|${workshop.id}`,{id:existing?.id||null,alumno_id:student.id,taller_id:workshop.id,estado:'inscrito'});
    counts[String(workshop.id)]=(counts[String(workshop.id)]||0)+1;
    detalles.push({alumno_id:student.id,nombre_completo:student.nombre_completo,matricula:student.matricula,taller:workshop.nombre});
  }
  return {ciclo:cycle,total_sin_taller:pending.length,asignados:detalles.length,sin_cupo:sinCupo.length,detalles,sin_asignar:sinCupo};
}

function validHexColor(value, fallback='#4EA72E') {
  const v=String(value||'').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : fallback;
}

async function getTeacherSubjectColors(admin, docenteId) {
  const {data, error} = await admin
    .from('docente_materia_colores')
    .select('id,docente_id,materia_id,color_hex,updated_at')
    .eq('docente_id', docenteId);
  if (error) throw error;
  return data || [];
}

async function getGroupSubjectColors(admin, groupId) {
  const {data:gms,error:gmError}=await admin
    .from('grupo_materias')
    .select('id,materia_id,materias(id,nombre,clave)')
    .eq('grupo_id', Number(groupId));
  if(gmError) throw gmError;
  const ids=(gms||[]).map(x=>x.id);
  if(!ids.length) return [];
  const cycle=await activeCycle(admin);
  let {data:as,error:aError}=await admin
    .from('asignaciones_docentes')
    .select('grupo_materia_id,docente_id,activo,ciclo_escolar,docentes(id,nombre_completo),grupo_materias(materia_id,materias(id,nombre,clave))')
    .in('grupo_materia_id',ids)
    .eq('activo',true).eq('ciclo_escolar',cycle);
  if(aError) throw aError;
  if(!as?.length){const fb=await admin.from('asignaciones_docentes').select('grupo_materia_id,docente_id,activo,ciclo_escolar,docentes(id,nombre_completo),grupo_materias(materia_id,materias(id,nombre,clave))').in('grupo_materia_id',ids).eq('activo',true);if(fb.error)throw fb.error;as=fb.data||[];}
  const docentes=[...new Set((as||[]).map(x=>x.docente_id).filter(Boolean))];
  let colors=[];
  if(docentes.length){
    const {data:c,error:cError}=await admin.from('docente_materia_colores').select('docente_id,materia_id,color_hex').in('docente_id',docentes);
    if(cError) throw cError; colors=c||[];
  }
  const cmap=new Map(colors.map(x=>[`${x.docente_id}|${x.materia_id}`,x.color_hex]));
  return (gms||[]).map(gm=>{
    const a=(as||[]).find(x=>Number(x.grupo_materia_id)===Number(gm.id) && x.activo!==false);
    const materiaId=gm.materia_id;
    return {grupo_materia_id:gm.id,materia_id:materiaId,materia:gm.materias||null,docente_id:a?.docente_id||null,docente:a?.docentes||null,color_hex:cmap.get(`${a?.docente_id}|${materiaId}`)||'#D8B45A'};
  });
}


async function groupCapacity(admin, groupIds){
  const ids=[...new Set((groupIds||[]).map(Number).filter(Boolean))];
  if(!ids.length) return {};
  const {data,error}=await admin.from('alumnos').select('grupo_id').in('grupo_id',ids).eq('activo',true);
  if(error) throw error;
  const counts=Object.fromEntries(ids.map(id=>[String(id),0]));
  for(const a of data||[]) counts[String(a.grupo_id)]=(counts[String(a.grupo_id)]||0)+1;
  return Object.fromEntries(ids.map(id=>[String(id),{ocupados:counts[String(id)]||0,cupo:Math.max(0,40-(counts[String(id)]||0)),lleno:(counts[String(id)]||0)>=40}]));
}

async function getTeacherScheduleAcceptance(admin,user){
  const tid=await teacherId(admin,user.id); if(!tid) throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const cycle=await activeCycle(admin);
  const {data,error}=await admin.from('aceptaciones_horario_docente').select('*').eq('docente_id',tid).eq('ciclo_escolar',cycle).maybeSingle();
  if(error) throw error;
  const {data:teacher,error:te}=await admin.from('docentes').select('id,nombre_completo,auth_user_id').eq('id',tid).maybeSingle(); if(te)throw te;
  const {data:profile,error:pe}=await admin.from('perfiles').select('firma_path,firma_sha256').eq('id',user.id).maybeSingle(); if(pe)throw pe;
  return {cycle,teacher,acceptance:data||null,hasSignature:Boolean(profile?.firma_path)};
}

async function acceptTeacherSchedule(admin,user,profile){
  if(profile.rol!=='docente') throw Object.assign(new Error('Solo el docente puede aceptar su horario.'),{status:403});
  const tid=await teacherId(admin,user.id); if(!tid) throw Object.assign(new Error('Docente no encontrado.'),{status:404});
  const cycle=await activeCycle(admin);
  const {data:rows,error:he}=await admin.from('horarios').select('id').eq('docente_id',tid).eq('ciclo_escolar',cycle).limit(1); if(he)throw he;
  if(!(rows||[]).length) throw Object.assign(new Error('No puedes aceptar un horario que todavía no ha sido asignado.'),{status:409});
  const {data:pf,error:pe}=await admin.from('perfiles').select('firma_path,firma_sha256').eq('id',user.id).maybeSingle(); if(pe)throw pe;
  if(!pf?.firma_path) throw Object.assign(new Error('Primero registra tu firma institucional en Perfil.'),{status:409});
  const {data:storedSig,error:sigErr}=await admin.storage.from('firmas-institucionales').download(pf.firma_path);
  if(sigErr||!storedSig) throw Object.assign(new Error('Tu firma está registrada, pero el archivo privado no puede verificarse. Vuelve a registrar tu firma en Perfil antes de aceptar el horario.'),{status:409});
  const sigBytes=Buffer.from(await storedSig.arrayBuffer());
  const cryptoMod=await import('node:crypto');
  const actualSha=cryptoMod.createHash('sha256').update(sigBytes).digest('hex');
  if(pf.firma_sha256 && actualSha!==String(pf.firma_sha256).toLowerCase()) throw Object.assign(new Error('La firma registrada no coincide con el archivo almacenado. Vuelve a registrarla antes de aceptar el horario.'),{status:409});
  const {data:assigned,error:ae}=await admin.from('asignaciones_docentes').select('grupo_materias(materia_id,materias(nombre))').eq('docente_id',tid).eq('activo',true).eq('ciclo_escolar',cycle); if(ae)throw ae;
  const {data:colors,error:ce}=await admin.from('docente_materia_colores').select('materia_id,color_hex').eq('docente_id',tid); if(ce)throw ce;
  const configured=new Map((colors||[]).map(c=>[String(c.materia_id),c.color_hex]));
  const missing=[...new Map((assigned||[]).map(a=>[String(a.grupo_materias?.materia_id),a.grupo_materias?.materias?.nombre||'Materia'])).entries()].filter(([id])=>!configured.has(id));
  if(missing.length) throw Object.assign(new Error(`Antes de aceptar tu horario debes elegir un color para cada materia asignada. Pendientes: ${missing.map(x=>x[1]).join(', ')}.`),{status:409});
  const payload={docente_id:tid,ciclo_escolar:cycle,estado:'aceptado',firma_path:pf.firma_path,firma_sha256:pf.firma_sha256||null,aceptado_at:new Date().toISOString()};
  const {data,error}=await admin.from('aceptaciones_horario_docente').upsert(payload,{onConflict:'docente_id,ciclo_escolar'}).select('*').single(); if(error)throw error;
  const departments=['servicios_docentes','coordinacion_academica','direccion_escolar'];
  for(const role of departments){try{await notifyJaguarRole(admin,role,{titulo:'Horario docente aceptado',contenido:`${profile.nombre_completo||user.email||'Un docente'} aceptó formalmente su horario del ciclo ${cycle}.`,tipo:'aceptacion_horario',docenteId:tid});}catch(e){console.warn('No se pudo notificar aceptación de horario:',e.message)}}
  return {acceptance:data,cycle};
}

async function createGroupExchangeRequest(admin,user,body){
  if((await authContextForRole(admin,user))!=='alumno') throw Object.assign(new Error('Solo alumnos pueden solicitar intercambios.'),{status:403});
  const student=await studentId(admin,user.id); if(!student) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const targetId=Number(body.alumno_destino_id||0), targetGroupId=Number(body.grupo_destino_id||0); if(!targetId||!targetGroupId) throw Object.assign(new Error('Selecciona al alumno con quien deseas intercambiar y el grupo destino.'),{status:400});
  const {data:me,error:meErr}=await admin.from('alumnos').select('id,nombre_completo,grupo_id,activo,auth_user_id,matricula,sexo,curp,grado_ingreso,turno,grupos(id,clave,grado,turno,activo)').eq('id',student.id).maybeSingle(); if(meErr)throw meErr;
  const {data:other,error:oe}=await admin.from('alumnos').select('id,nombre_completo,grupo_id,activo,auth_user_id,matricula,sexo,curp,grado_ingreso,turno,grupos(id,clave,grado,turno,activo)').eq('id',targetId).maybeSingle(); if(oe)throw oe;
  if(!me||!other||me.activo===false||other.activo===false)throw Object.assign(new Error('Uno de los alumnos no está activo.'),{status:409});
  if(Number(other.grupo_id)!==targetGroupId)throw Object.assign(new Error('El alumno seleccionado ya no pertenece al grupo elegido.'),{status:409});
  if(Number(me.grupos?.grado)!==Number(other.grupos?.grado))throw Object.assign(new Error('El intercambio solo puede hacerse dentro del mismo grado.'),{status:409});
  if(Number(me.grupo_id)===Number(other.grupo_id))throw Object.assign(new Error('Los alumnos ya pertenecen al mismo grupo.'),{status:409});
  const {data:pending,error:pe}=await admin.from('solicitudes_intercambio_grupo').select('id').eq('alumno_solicitante_id',me.id).eq('estado','pendiente').limit(1); if(pe)throw pe; if((pending||[]).length)throw Object.assign(new Error('Ya tienes un intercambio pendiente.'),{status:409});
  const {data:created,error:ce}=await admin.from('solicitudes_intercambio_grupo').insert({alumno_solicitante_id:me.id,alumno_destino_id:other.id,grupo_solicitante_id:me.grupo_id,grupo_destino_id:other.grupo_id,motivo:String(body.motivo||'').trim()||null,solicitado_por:user.id}).select('*').single(); if(ce)throw ce;
  try{await createJaguarNotification(admin,other.auth_user_id,{titulo:'Solicitud de intercambio de grupo',contenido:`${me.nombre_completo} solicita intercambiar su grupo ${me.grupos?.clave||''} contigo para ocupar tu lugar en ${other.grupos?.clave||''}. Puedes aceptar o rechazar la solicitud.`,tipo:'intercambio_grupo',solicitudId:created.id});}catch(e){console.warn('No se pudo notificar intercambio:',e.message)}
  return created;
}

async function respondGroupExchangeRequest(admin,user,body){
  const student=await studentId(admin,user.id); if(!student) throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const id=Number(body.id||0); const decision=body.decision==='aceptada'?'aceptada':body.decision==='rechazada'?'rechazada':null; if(!id||!decision)throw Object.assign(new Error('Respuesta inválida.'),{status:400});
  const {data:reqRow,error:re}=await admin.from('solicitudes_intercambio_grupo').select('*,alumno_solicitante:alumnos!solicitudes_intercambio_grupo_alumno_solicitante_id_fkey(id,nombre_completo,auth_user_id,matricula,curp,grupo_id,grado_ingreso,turno,grupos(id,clave,grado,turno)),alumno_destino:alumnos!solicitudes_intercambio_grupo_alumno_destino_id_fkey(id,nombre_completo,auth_user_id,matricula,curp,grupo_id,grado_ingreso,turno,grupos(id,clave,grado,turno))').eq('id',id).maybeSingle(); if(re)throw re; if(!reqRow)throw Object.assign(new Error('Solicitud de intercambio no encontrada.'),{status:404});
  if(Number(reqRow.alumno_destino_id)!==Number(student.id))throw Object.assign(new Error('Esta solicitud no está dirigida a tu cuenta.'),{status:403});
  if(reqRow.estado!=='pendiente')throw Object.assign(new Error('La solicitud ya fue respondida.'),{status:409});
  if(decision==='rechazada'){
    const {data,error}=await admin.from('solicitudes_intercambio_grupo').update({estado:'rechazada',respuesta_motivo:String(body.motivo||'').trim()||null,respondido_at:new Date().toISOString(),resuelto_at:new Date().toISOString()}).eq('id',id).eq('estado','pendiente').select('*').single(); if(error)throw error;
    try{await createJaguarNotification(admin,reqRow.alumno_solicitante?.auth_user_id,{titulo:'Intercambio de grupo rechazado',contenido:`${student.nombre_completo} rechazó la solicitud de intercambio.`,tipo:'intercambio_grupo',solicitudId:id});}catch(e){console.warn(e.message)}
    return data;
  }
  const a=reqRow.alumno_solicitante,b=reqRow.alumno_destino;
  if(Number(a.grupos?.grado)!==Number(b.grupos?.grado))throw Object.assign(new Error('Los grupos ya no pertenecen al mismo grado.'),{status:409});
  // La función SQL mueve primero al alumno que sale del grupo lleno y luego al solicitante.
  const {error:swapErr}=await admin.rpc('inetch_intercambiar_grupos',{p_alumno_a:a.id,p_alumno_b:b.id}); if(swapErr)throw swapErr;
  // Actualizar matrículas/correos conforme a los nuevos grupos.
  const {data:newA,error:ae}=await admin.from('alumnos').select('*,grupos(id,clave,grado,letra,turno)').eq('id',a.id).single(); if(ae)throw ae;
  const {data:newB,error:be}=await admin.from('alumnos').select('*,grupos(id,clave,grado,letra,turno)').eq('id',b.id).single(); if(be)throw be;
  const newMatA=await buildNewGroupMatricula(admin,{...a,sexo:a.sexo},newA.grupos); const newMatB=await buildNewGroupMatricula(admin,{...b,sexo:b.sexo},newB.grupos);
  const {error:u1}=await admin.from('alumnos').update({matricula:newMatA}).eq('id',a.id); if(u1)throw u1;
  const {error:u2}=await admin.from('alumnos').update({matricula:newMatB}).eq('id',b.id); if(u2)throw u2;
  for(const row of [{id:a.auth_user_id,mat:newMatA},{id:b.auth_user_id,mat:newMatB}]) if(row.id){const email=await institutionalEmail(admin,row.mat);await admin.auth.admin.updateUserById(row.id,{email,email_confirm:true,user_metadata:{matricula:row.mat,login_email:email}});await admin.from('perfiles').update({correo:email,correo_auth:email,matricula:row.mat}).eq('id',row.id);}
  const {data,error}=await admin.from('solicitudes_intercambio_grupo').update({estado:'aceptada',respondido_at:new Date().toISOString(),resuelto_at:new Date().toISOString()}).eq('id',id).eq('estado','pendiente').select('*').single(); if(error)throw error;
  try{await createJaguarNotification(admin,a.auth_user_id,{titulo:'Intercambio de grupo aceptado',contenido:`${b.nombre_completo} aceptó el intercambio. Tu nuevo grupo es ${newA.grupos?.clave||'—'}.`,tipo:'intercambio_grupo',solicitudId:id});}catch(e){console.warn(e.message)}
  return {request:data,students:[newA,newB]};
}

async function authContextForRole(admin,user){
  const {data:p,error}=await admin.from('perfiles').select('rol').eq('id',user.id).maybeSingle(); if(error)throw error; return p?.rol||null;
}

async function getStudentRequestsDirect(admin,user,profile){
  if(profile.rol==='alumno'){
    const student=await studentId(admin,user.id);
    const {data,error}=await admin.from('solicitudes_estudiantiles')
      .select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))')
      .eq('alumno_id',student?.id||-1).order('id',{ascending:false});
    if(error)throw error;
    const {data:workshops,error:werror}=await admin.from('talleres').select('id,nombre');
    if(werror)throw werror;
    const map=Object.fromEntries((workshops||[]).map(x=>[String(x.id),x]));
    return (data||[]).map(row=>row.tipo==='taller'?({...row,taller_solicitado:map[String(row.valor_solicitado)]||null}):row);
  }
  if(!studentServices.includes(profile.rol))throw Object.assign(new Error('No autorizado.'),{status:403});
  const {data,error}=await admin.from('solicitudes_estudiantiles')
    .select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))')
    .order('id',{ascending:false});
  if(error)throw error;
  const {data:workshops,error:werror}=await admin.from('talleres').select('id,nombre');
  if(werror)throw werror;
  const map=Object.fromEntries((workshops||[]).map(x=>[String(x.id),x]));
  const visible=(data||[]).filter(row=>{
    if(row.tipo==='aclaracion_calificacion')return false;
    if(profile.rol==='direccion_escolar')return true;
    if(profile.rol==='servicios_estudiantiles')return !row.departamento_destino||row.departamento_destino==='servicios_estudiantiles';
    if(profile.rol==='servicios_docentes')return row.departamento_destino==='servicios_docentes';
    if(profile.rol==='prefectura')return row.departamento_destino==='prefectura';
    if(profile.rol==='coordinacion_academica')return row.departamento_destino==='coordinacion_academica';
    if(profile.rol==='control_escolar'||profile.rol==='control')return row.tipo==='grupo'||!row.departamento_destino||row.departamento_destino==='control_escolar';
    return false;
  });
  return visible.map(row=>row.tipo==='taller'?({...row,taller_solicitado:map[String(row.valor_solicitado)]||null}):row);
}

async function getDepartmentRequestsDirect(admin,profile){
  const roleMap={
    servicios_docentes:['servicios_docentes'],
    servicios_estudiantiles:['servicios_estudiantiles'],
    prefectura:['prefectura'],
    coordinacion_academica:['coordinacion_academica'],
    control_escolar:['control_escolar'],
    direccion_escolar:['direccion_escolar','control_escolar','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica']
  };
  if(profile.rol==='alumno')return [];
  if(!roleMap[profile.rol])throw Object.assign(new Error('Este departamento no administra solicitudes.'),{status:403});
  const {data,error}=await admin.from('solicitudes_estudiantiles')
    .select('*,alumnos(id,nombre_completo,matricula,grupo_id,grupos(clave,grado,letra))')
    .order('id',{ascending:false}).limit(500);
  if(error)throw error;
  return (data||[]).filter(r=>{
    if(r.tipo==='aclaracion_calificacion')return false;
    const destino=String(r.departamento_destino||r.destino_departamento||'');
    if(profile.rol==='direccion_escolar')return true;
    if(!destino)return true;
    if(roleMap[profile.rol]?.includes(destino))return true;
    return ({taller:'servicios_estudiantiles',grado:'servicios_estudiantiles',grupo:'servicios_estudiantiles',turno:'servicios_estudiantiles'}[r.tipo]===profile.rol);
  });
}

export default async function handler(
  req,
  res
) {
  try {
    const {
      user,
      profile,
      adminClient
    } = await authContext(req);

    if (profile?.rol === 'alumno') {
      const { data: suspendedStudent } = await adminClient.from('alumnos').select('suspension_fecha,suspension_motivo').eq('auth_user_id', user.id).maybeSingle();
      const isSuspended = !!(suspendedStudent?.suspension_fecha || suspendedStudent?.suspension_motivo);
      const blockedResources = new Set(['grades','attendance','schedules','studentBoleta','studentSchedule','workshopEnrollments','workshops','clarifications','studentRequests','teacherEvaluation','teacherGrades','teacherAttendance']);
      const requestedResource = String(req.query?.resource || req.body?.resource || '');
      if (isSuspended && blockedResources.has(requestedResource)) {
        return res.status(403).json({ ok:false, error:'Este modulo esta temporalmente bloqueado mientras tu suspension esta en revision.' });
      }
    }

    /* GET */
    if(req.method==='GET' && req.query?.resource==='studentRequests'){
      return res.status(200).json({ok:true,data:await getStudentRequestsDirect(adminClient,user,profile)});
    }
    if(req.method==='GET' && req.query?.resource==='departmentRequests'){
      return res.status(200).json({ok:true,data:await getDepartmentRequestsDirect(adminClient,profile)});
    }
    if (req.method === 'GET' && req.query?.resource !== 'accessReview') {
      const key =
        req.query?.resource ||
        'dashboard';

      return res
        .status(200)
        .json({
          ok: true,
          data: await getResource(
            adminClient,
            key,
            user,
            profile,
            req
          )
        });
    }


    if(req.method==='GET' && req.query?.resource==='accessReview'){
      const adminRoles=['direccion_escolar','control_escolar','control'];
      if(adminRoles.includes(profile.rol)){
        const {data:rows,error}=await adminClient.from('solicitudes_revision_acceso').select('*').eq('estado','pendiente').order('created_at',{ascending:false});
        if(error)throw error;
        const out=[];
        for(const row of rows||[]){
          const [pq,sq,tq]=await Promise.all([
            adminClient.from('perfiles').select('id,nombre_completo,correo,rol').eq('id',row.usuario_id).maybeSingle(),
            row.alumno_id?adminClient.from('alumnos').select('nombre_completo,matricula,suspension_motivo').eq('id',row.alumno_id).maybeSingle():Promise.resolve({data:null,error:null}),
            row.docente_id?adminClient.from('docentes').select('nombre_completo,numero_empleado,suspension_motivo').eq('id',row.docente_id).maybeSingle():Promise.resolve({data:null,error:null})
          ]);
          for(const q of [pq,sq,tq])if(q.error)throw q.error;
          out.push({...row,nombre_completo:pq.data?.nombre_completo||sq.data?.nombre_completo||tq.data?.nombre_completo||'—',correo:pq.data?.correo||'—',rol:pq.data?.rol||'—',suspension_motivo:sq.data?.suspension_motivo||tq.data?.suspension_motivo||'—'});
        }
        return res.status(200).json({ok:true,data:out});
      }
      if(!['alumno','docente'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado.'});
      const {data,error}=await adminClient.from('solicitudes_revision_acceso').select('*').eq('usuario_id',user.id).order('id',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return res.status(200).json({ok:true,data:data||null});
    }
    if(req.method==='POST' && req.body?.resource==='accessReview'){
      const body=req.body||{};
      if(body.action==='submit'){
        if(!['alumno','docente'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo alumnos y docentes suspendidos pueden solicitar revisión.'});
        const table=profile.rol==='alumno'?'alumnos':'docentes';
        const {data:person,error:pe}=await adminClient.from(table).select('id,suspension_fecha,suspension_motivo,revision_acceso_estado').eq('auth_user_id',user.id).maybeSingle();if(pe)throw pe;if(!person)return res.status(404).json({ok:false,error:'No se encontró tu registro escolar.'});
        if(!person.suspension_fecha&&!person.suspension_motivo)return res.status(409).json({ok:false,error:'Tu acceso no aparece suspendido.'});
        const {data:existing,error:ee}=await adminClient.from('solicitudes_revision_acceso').select('id,estado').eq('usuario_id',user.id).eq('estado','pendiente').maybeSingle();if(ee)throw ee;if(existing)return res.status(409).json({ok:false,error:'Ya tienes una solicitud de revisión pendiente.'});
        const {data:reqRow,error:ie}=await adminClient.from('solicitudes_revision_acceso').insert({usuario_id:user.id,alumno_id:profile.rol==='alumno'?person.id:null,docente_id:profile.rol==='docente'?person.id:null,motivo:String(body.motivo||'Solicitud de revisión de suspensión').trim().slice(0,1000)||'Solicitud de revisión de suspensión',estado:'pendiente'}).select('*').single();if(ie)throw ie;
        const {error:ue}=await adminClient.from(table).update({revision_acceso_estado:'pendiente'}).eq('id',person.id);if(ue)throw ue;
        const {data:admins,error:ae}=await adminClient.from('perfiles').select('id').in('rol',['direccion_escolar','control_escolar']).eq('activo',true);if(ae)throw ae;for(const p of admins||[]){try{await createJaguarNotification(adminClient,p.id,{titulo:'Solicitud de revisión de acceso',contenido:`${profile.nombre_completo||user.email} solicitó revisión de su suspensión.`,tipo:'revision_acceso'});}catch(e){console.warn(e.message)}}
        return res.status(200).json({ok:true,data:reqRow,message:'Solicitud de revisión enviada. Tu acceso pasó a revisión.'});
      }
      if(body.action==='resolve'){
        if(!['direccion_escolar','control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Dirección o Control Escolar pueden resolver revisiones de acceso.'});
        const id=Number(body.request_id||0),decision=String(body.decision||'').toLowerCase();if(!id||!['approve','reject'].includes(decision))return res.status(400).json({ok:false,error:'Solicitud o decisión no válida.'});
        const {data:r,error:re}=await adminClient.from('solicitudes_revision_acceso').select('*').eq('id',id).eq('estado','pendiente').maybeSingle();if(re)throw re;if(!r)return res.status(404).json({ok:false,error:'La solicitud ya fue resuelta o no existe.'});
        const estado=decision==='approve'?'aprobada':'rechazada';const now=new Date().toISOString();const {error:ru}=await adminClient.from('solicitudes_revision_acceso').update({estado,observaciones_resolucion:String(body.observaciones||'').trim()||null,resuelto_por:user.id,resuelto_at:now}).eq('id',id);if(ru)throw ru;
        const table=r.alumno_id?'alumnos':'docentes',pid=r.alumno_id||r.docente_id;const patch=decision==='approve'?{suspension_fecha:null,suspension_hasta:null,suspension_motivo:null,suspension_observaciones:null,revision_acceso_estado:'aprobada'}:{revision_acceso_estado:'rechazada'};const {error:pu}=await adminClient.from(table).update(patch).eq('id',pid);if(pu)throw pu;
        try{await createJaguarNotification(adminClient,r.usuario_id,{titulo:decision==='approve'?'Revisión de acceso aprobada':'Revisión de acceso rechazada',contenido:decision==='approve'?'Tu acceso fue reactivado después de la revisión.':'La revisión fue rechazada y la suspensión permanece activa.',tipo:'revision_acceso'});}catch(e){console.warn(e.message)}
        return res.status(200).json({ok:true,message:decision==='approve'?'Revisión aprobada. El acceso fue reactivado.':'Revisión rechazada. La suspensión permanece activa.'});
      }
    }

    if(req.method==='POST' && req.body?.resource==='advanceSchoolCycle'){
      if(!['control_escolar','control'].includes(profile.rol)) return res.status(403).json({ok:false,error:'Solo Control Escolar puede ejecutar el avance del ciclo escolar.'});
      const cycle=String(req.body?.ciclo_escolar||'').trim(); const result=await advanceSchoolCycle(adminClient,user,cycle,profile.rol);
      return res.status(200).json({ok:true,data:result,message:`Ciclo ${cycle} activado. Se promovieron ${result.promoted} alumnos y ${result.graduated} alumnos quedaron como egresados.`});
    }
    if(req.method==='POST' && req.body?.resource==='revertSchoolCycle'){
      if(!['control_escolar','control'].includes(profile.rol)) return res.status(403).json({ok:false,error:'Solo Control Escolar puede revertir el último avance de ciclo.'});
      const result=await revertSchoolCycle(adminClient,user,profile.rol);return res.status(200).json({ok:true,data:result,message:`Se revirtió el ciclo ${result.reverted} y se restauró ${result.restored_cycle}.`});
    }

    if(req.method==='POST' && req.body?.resource==='setCurrentPeriod'){
      if(!['control_escolar','control'].includes(profile.rol)) return res.status(403).json({ok:false,error:'Solo Control Escolar puede cambiar el periodo actual.'});
      const id=Number(req.body?.periodo_id||0); if(!id) return res.status(400).json({ok:false,error:'Periodo no válido.'});
      const cycle=await activeCycle(adminClient);
      const {data:period,error:pe}=await adminClient.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,numero_periodo,es_periodo_actual,fecha_inicio,fecha_fin').eq('id',id).maybeSingle();
      if(pe) throw pe; if(!period) return res.status(404).json({ok:false,error:'Periodo no encontrado.'});
      if(period.ciclo_escolar!==cycle) return res.status(409).json({ok:false,error:'Solo puedes activar un periodo del ciclo escolar actual.'});
      if(period.activo===false) return res.status(409).json({ok:false,error:'Ese periodo está inactivo. Actívalo antes de seleccionarlo como actual.'});
      if(period.es_periodo_actual) return res.status(200).json({ok:true,data:{period},message:'Ese periodo ya es el actual.'});
      const {error:clearError}=await adminClient.from('periodos_escolares').update({es_periodo_actual:false}).eq('es_periodo_actual',true);
      if(clearError) throw clearError;
      const {data:updated,error:upError}=await adminClient.from('periodos_escolares').update({es_periodo_actual:true}).eq('id',id).select('*').single();
      if(upError) throw upError;
      await audit(adminClient,{userId:user.id,role:profile.rol,action:'cambiar_periodo_actual',module:'periodos_escolares',entity:'periodos_escolares',entityId:id,description:`Periodo actual cambiado a ${updated.nombre||'Periodo'} del ciclo ${cycle}.`,before:{periodo_actual:period?.nombre||null},after:{periodo_actual:updated.nombre,numero_periodo:updated.numero_periodo,ciclo:updated.ciclo_escolar},req});
      return res.status(200).json({ok:true,data:{period:updated},message:`Periodo actual: ${updated.nombre||'Periodo'}. Los horarios del ciclo no cambiaron.`});
    }

    /* GENERADOR DE HORARIOS */
    if (
      req.method === 'POST' &&
      (
        req.body?.resource ===
          'generateSchedules' ||
        req.query?.resource ===
          'generateSchedules'
      )
    ) {
      if (
        profile.rol !==
        'coordinacion_academica'
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              'Solo Coordinación Académica puede generar horarios.'
          });
      }

      const ciclo = await activeCycle(adminClient);
      const {count:existingSchedules,error:scError}=await adminClient.from('horarios').select('id',{count:'exact',head:true}).eq('ciclo_escolar',ciclo);
      if(scError) throw scError;
      if(Number(existingSchedules||0)>0){
        return res.status(409).json({ok:false,error:`El ciclo ${ciclo} ya tiene horarios registrados. Cambiar de periodo no regenera ni reemplaza los horarios. Para generar un horario nuevo se necesita abrir un ciclo escolar nuevo.`});
      }

      const result =
        await generateAcademicSchedules(
          adminClient,
          ciclo
        );

      return res
        .status(200)
        .json({
          ok: true,
          data: result
        });
    }

    /* SOLICITUDES DE TALLER */
    if (
      req.method === 'POST' &&
      req.body?.resource ===
        'tallerRequests'
    ) {
      return await handleStudentRequest(
        req,
        res,
        user,
        profile,
        adminClient,
        true
      );
    }

    /* SOLICITUDES GENERALES */
    if (
      req.method === 'POST' &&
      req.body?.resource ===
        'studentRequests'
    ) {
      return await handleStudentRequest(
        req,
        res,
        user,
        profile,
        adminClient,
        false
      );
    }

    /* CORREO DE RECUPERACIÓN: solo el usuario autenticado puede modificar el suyo.
       Nunca se acepta un user_id externo para esta operación. */
    if (req.method === 'POST' && req.body?.resource === 'saveRecoveryEmail') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ ok:false, error:'Escribe un correo de recuperación válido.' });
      }
      const institutional = String(profile.correo || user.email || '').trim().toLowerCase();
      if (email === institutional) {
        return res.status(400).json({ ok:false, error:'El correo de recuperación debe ser distinto al correo institucional.' });
      }
      const previousAuthEmail = String(user.email || '').trim().toLowerCase();
      const metadata = { ...(user.user_metadata || {}), recovery_email: email, login_email: profile.correo };
      const { error: ae } = await adminClient.auth.admin.updateUserById(user.id, {
        email,
        email_confirm: true,
        user_metadata: metadata
      });
      if (ae) {
        return res.status(400).json({ ok:false, error:ae.message || 'No se pudo actualizar el correo de recuperación.' });
      }

      const { error: pe } = await adminClient
        .from('perfiles')
        .update({ correo_recuperacion: email, correo_auth: email })
        .eq('id', user.id);
      if (pe) {
        // Intento de rollback para evitar dejar Auth y perfiles desincronizados.
        if (previousAuthEmail && previousAuthEmail !== email) {
          await adminClient.auth.admin.updateUserById(user.id, {
            email: previousAuthEmail,
            email_confirm: true,
            user_metadata: user.user_metadata || {}
          }).catch(() => null);
        }
        throw pe;
      }

      return res.status(200).json({
        ok:true,
        correo_recuperacion: email,
        message:'Correo de recuperación actualizado.'
      });
    }

    if(req.method==='POST' && req.body?.resource==='directStudentGroupChange'){
      const result=await changeStudentGroupDirect(adminClient,user,profile,req.body||{});
      return res.status(200).json({ok:true,data:result,message:`Alumno cambiado de ${result.current.clave} a ${result.target.clave}.`});
    }
    if(req.method==='POST' && req.body?.resource==='createSpecialGradeRequest'){
      const result=await createSpecialGradeRequest(adminClient,user,profile,req.body||{});
      return res.status(200).json({ok:true,data:result,message:'Solicitud de cambio especial creada. Todos los departamentos deben autorizarla.'});
    }
    if(req.method==='POST' && req.body?.resource==='resolveSpecialGradeRequest'){
      const result=await resolveSpecialGradeApproval(adminClient,user,profile,req.body||{});
      return res.status(200).json({ok:true,data:result,message:result.message});
    }
    if(req.method==='POST' && req.body?.resource==='executeSpecialGradeRequest'){
      const result=await executeSpecialGradeChange(adminClient,user,profile,req.body||{});
      return res.status(200).json({ok:true,data:result,message:`Cambio especial ejecutado: ${result.current?.clave||'—'} → ${result.target?.clave||'—'}.`});
    }
    if(req.method==='POST' && req.body?.resource==='reopenSpecialGradeRequest'){
      const result=await reopenSpecialGradeRequest(adminClient,user,profile,req.body||{});return res.status(200).json({ok:true,data:result,message:result.message});
    }

    /* ACLARACIONES */
    if (req.method === 'POST' && req.body?.resource === 'createClarification') {
      if (profile.rol !== 'alumno') return res.status(403).json({ ok:false, error:'Solo los alumnos pueden crear aclaraciones.' });
      const body = req.body || {};
      const student = await studentId(adminClient, user.id);
      if (!student) return res.status(404).json({ ok:false, error:'Alumno no encontrado.' });
      const calificacionId = Number(body.calificacion_id || 0);
      const gmId = Number(body.grupo_materia_id || 0);
      const motivo = String(body.motivo || '').trim();
      if (!calificacionId || !gmId || !motivo) return res.status(400).json({ ok:false, error:'Faltan datos para crear la aclaración.' });
      const { data: grade, error: ge } = await adminClient.from('calificaciones').select('id,alumno_id,grupo_materia_id,docente_id,calificacion').eq('id', calificacionId).maybeSingle();
      if (ge) throw ge;
      if (!grade || Number(grade.alumno_id) !== Number(student.id) || Number(grade.grupo_materia_id) !== gmId) return res.status(404).json({ ok:false, error:'La calificación no pertenece al alumno.' });
      if (!grade.docente_id) return res.status(400).json({ ok:false, error:'La calificación no tiene docente responsable.' });
      const { data: created, error } = await adminClient.from('solicitudes_estudiantiles').insert({ alumno_id:student.id, tipo:'aclaracion_calificacion', motivo, estado:'pendiente', grupo_materia_id:gmId, calificacion_id:calificacionId, docente_destino_id:grade.docente_id, valor_actual:String(grade.calificacion ?? '') }).select('*').single();
      if (error) throw error;
      return res.status(200).json({ ok:true, data:created, message:'Aclaración enviada al docente.' });
    }

    /* EVALUACIÓN DOCENTE: RÚBRICA */
    if (req.method === 'POST' && req.body?.resource === 'saveTeacherSubjectColors') {
      if(profile.rol!=='docente') return res.status(403).json({ok:false,error:'Solo docentes pueden cambiar colores de sus materias.'});
      const tid=await teacherId(adminClient,user.id); if(!tid) return res.status(404).json({ok:false,error:'Docente no vinculado.'});
      const rows=Array.isArray(req.body.colors)?req.body.colors:[];
      const cycle=await activeCycle(adminClient);
      let {data:assignments,error:ae}=await adminClient.from('asignaciones_docentes').select('grupo_materia_id,activo,ciclo_escolar,grupo_materias(materia_id)').eq('docente_id',tid).eq('activo',true).eq('ciclo_escolar',cycle);
      if(ae) throw ae;
      if(!assignments?.length){ const fb=await adminClient.from('asignaciones_docentes').select('grupo_materia_id,activo,ciclo_escolar,grupo_materias(materia_id)').eq('docente_id',tid).eq('activo',true); if(fb.error) throw fb.error; assignments=fb.data||[]; }
      const allowedMateriaIds=new Set((assignments||[]).map(a=>String(a.grupo_materias?.materia_id)).filter(Boolean));
      const clean=[];
      for(const r of rows){const materiaId=Number(r.materia_id||0);if(!materiaId||!allowedMateriaIds.has(String(materiaId)))continue;clean.push({docente_id:tid,materia_id:materiaId,color_hex:validHexColor(r.color_hex),updated_at:new Date().toISOString()});}
      for(const row of clean){const {error}=await adminClient.from('docente_materia_colores').upsert(row,{onConflict:'docente_id,materia_id'});if(error)throw error;}
      return res.status(200).json({ok:true,message:'Colores de materias guardados.',data:await getTeacherSubjectColors(adminClient,tid)});
    }

    if (req.method === 'POST' && req.body?.resource === 'renewMatriculas') {
      const dryRun=req.body?.dry_run!==false;
      const result=await renewActiveMatriculas(adminClient,user,profile,{dryRun});
      return res.status(200).json({ok:true,data:result,message:dryRun?'Vista previa de renovación lista.':'Renovación de matrículas completada.'});
    }

    if (req.method === 'POST' && req.body?.resource === 'migrateLegacyMatriculas') {
      if(profile.rol!=='control_escolar' && profile.rol!=='direccion_escolar') return res.status(403).json({ok:false,error:'Solo Control Escolar o Dirección Escolar pueden migrar matrículas.'});
      const dryRun=req.body?.dry_run!==false;
      const cycle=await activeCycle(adminClient);
      const {data:students,error:se}=await adminClient.from('alumnos').select('id,nombre_completo,matricula,sexo,curp,auth_user_id,grupo_id,grado_ingreso,turno,activo,grupos(id,clave,grado,letra,turno)').eq('activo',true).not('grupo_id','is',null).order('id');
      if(se)throw se;
      const newFormat=/^[A-Z]{6}-[HM]\d{2}[A-Z][MV][A-Z]{2}\d$/i;
      const pending=[],preview=[],used=new Set((students||[]).map(x=>String(x.matricula||'').toUpperCase()).filter(Boolean));
      let updated=0,already=0,conflicts=0;
      for(const st of students||[]){
        const old=String(st.matricula||'').trim().toUpperCase();
        if(newFormat.test(old)){already++;continue;}
        let sexo=String(st.sexo||'').trim();
        if(!['Hombre','Mujer'].includes(sexo)){
          const curpSex=String(st.curp||'').trim().toUpperCase().charAt(10);
          const oldSex=old.match(/[-_]([HM])(?:\d|$)/i)?.[1]?.toUpperCase();
          if(curpSex==='H')sexo='Hombre'; else if(curpSex==='M')sexo='Mujer'; else if(oldSex==='H')sexo='Hombre'; else if(oldSex==='M')sexo='Mujer';
        }
        if(!['Hombre','Mujer'].includes(sexo)){pending.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:old||'—',motivo:'Falta sexo y no pudo inferirse de CURP/matrícula.'});continue;}
        let newMat=null;
        for(let attempt=0;attempt<100;attempt++){
          const candidate=await generateJaguarMatricula(adminClient,{nombre:st.nombre_completo,sexo,grupo:st.grupos,turno:st.grupos?.turno||st.turno});
          if(!used.has(candidate)){newMat=candidate;break;}
        }
        if(!newMat){conflicts++;pending.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:old||'—',motivo:'No se pudo obtener una matrícula única.'});continue;}
        used.add(newMat);preview.push({id:st.id,nombre:st.nombre_completo,matricula_anterior:old||'—',matricula_nueva:newMat,grupo:st.grupos?.clave||'—',sexo});
        if(!dryRun){
          const institution=await getInstitution(adminClient); const institutionDomain=String(institution.dominio_institucional||'ithla.edu.mx').replace(/^@/,'').toLowerCase();
          const newEmail=st.auth_user_id?`${newMat.toLowerCase()}@${institutionDomain}`:null;
          const {error:au}=await adminClient.from('alumnos').update({matricula:newMat}).eq('id',st.id); if(au)throw au;
          if(st.auth_user_id){
            const {error:ae}=await adminClient.auth.admin.updateUserById(st.auth_user_id,{email:newEmail,email_confirm:true,user_metadata:{matricula:newMat,login_email:newEmail}}); if(ae){await adminClient.from('alumnos').update({matricula:old}).eq('id',st.id);throw ae;}
            const {error:pe}=await adminClient.from('perfiles').update({matricula:newMat,correo:newEmail,correo_auth:newEmail}).eq('id',st.auth_user_id); if(pe)throw pe;
          }
          try{const {error:mh}=await adminClient.from('matricula_alumnos').update({numero_matricula:newMat}).eq('numero_matricula',old);if(mh && !/does not exist|schema cache/i.test(mh.message||''))throw mh;}catch(e){if(!/does not exist|schema cache/i.test(e.message||''))throw e;}
          const {error:logErr}=await adminClient.from('matricula_migraciones').insert({alumno_id:st.id,matricula_anterior:old||null,matricula_nueva:newMat,sexo_fuente:sexo==='Hombre'?'Hombre':'Mujer',ciclo_escolar:cycle,ejecutado_por:user.id});if(logErr)throw logErr;
          updated++;
        }
      }
      return res.status(200).json({ok:true,data:{dry_run:dryRun,cycle,total:(students||[]).length,actualizados:updated,ya_nuevas:already,pendientes:pending.length,conflictos,preview,pending},message:dryRun?'Vista previa lista. Ninguna matrícula fue modificada.':'Migración masiva completada.'});
    }

    if (req.method === 'POST' && req.body?.resource === 'prepareSignatureUpload') {
      const staffRoles=['docente','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','direccion_escolar','control_escolar','control','archivo_escolar','recursos_monetarios'];
      const deptRole=departmentKeyForRole(profile?.rol);
      if(!staffRoles.includes(profile?.rol) && !deptRole) return res.status(403).json({ok:false,error:'Esta cuenta no pertenece a un departamento institucional habilitado para firma.'});
      const filename=String(req.body.filename||'firma.png').replace(/[^a-zA-Z0-9._-]/g,'_');
      const ext=filename.toLowerCase().endsWith('.jpg')||filename.toLowerCase().endsWith('.jpeg')?'jpg':'png';
      const path=`${user.id}/firma-${Date.now()}.${ext}`;
      const bucket='firmas-institucionales';
      const {data:bucketInfo,error:bucketError}=await adminClient.storage.getBucket(bucket);
      if(bucketError && /not found|does not exist|not exist/i.test(bucketError.message||'')){
        const {error:createBucketError}=await adminClient.storage.createBucket(bucket,{public:false,fileSizeLimit:1048576,allowedMimeTypes:['image/png','image/jpeg','image/webp']});
        if(createBucketError && !/already exists/i.test(createBucketError.message||'')) throw createBucketError;
      } else if(bucketError) throw bucketError;
      const {data,error}=await adminClient.storage.from(bucket).createSignedUploadUrl(path);
      if(error) throw error;
      return res.status(200).json({ok:true,data:{bucket:'firmas-institucionales',path,token:data.token}});
    }

    if (req.method === 'POST' && req.body?.resource === 'saveProfileSignature') {
      const staffRoles=['docente','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','direccion_escolar','control_escolar','control','archivo_escolar','recursos_monetarios'];
      const deptRole=departmentKeyForRole(profile?.rol);
      if(!staffRoles.includes(profile?.rol) && !deptRole) return res.status(403).json({ok:false,error:'Esta cuenta no pertenece a un departamento institucional habilitado para firma.'});
      const path=String(req.body.path||'');
      if(!path || !path.startsWith(`${user.id}/`) || !/^[-a-zA-Z0-9_/.]+\.(png|jpg|jpeg|webp)$/i.test(path)) return res.status(400).json({ok:false,error:'Ruta de firma no válida.'});
      const clientSha=String(req.body.sha256||'').trim().toLowerCase();
      const {data:storedSignature,error:storedSignatureError}=await adminClient.storage.from('firmas-institucionales').download(path);
      if(storedSignatureError||!storedSignature) return res.status(409).json({ok:false,error:'La firma se cargó, pero no pudo verificarse en el almacenamiento privado. Intenta guardarla nuevamente.'});
      const sigBytes=Buffer.from(await storedSignature.arrayBuffer());
      const cryptoMod=await import('node:crypto');
      const serverSha=cryptoMod.createHash('sha256').update(sigBytes).digest('hex');
      if(clientSha && clientSha!==serverSha) return res.status(409).json({ok:false,error:'La firma cargada no coincide con la firma enviada. Intenta guardarla nuevamente.'});
      const {error}=await adminClient.from('perfiles').update({firma_path:path,firma_sha256:serverSha,firma_subida_at:new Date().toISOString()}).eq('id',user.id);
      if(error) throw error;
      return res.status(200).json({ok:true,message:'Firma institucional guardada de forma privada.'});
    }

    if(req.method==='POST' && req.body?.resource==='acceptTeacherSchedule'){
      const result=await acceptTeacherSchedule(adminClient,user,profile);
      return res.status(200).json({ok:true,data:result,message:'Horario aceptado y firmado. Se notificó a Servicios Docentes, Coordinación Académica y Dirección Escolar.'});
    }
    if(req.method==='POST' && req.body?.resource==='createGroupExchangeRequest'){
      const result=await createGroupExchangeRequest(adminClient,user,req.body||{});
      return res.status(200).json({ok:true,data:result,message:'Solicitud de intercambio enviada al alumno seleccionado.'});
    }
    if(req.method==='POST' && req.body?.resource==='respondGroupExchangeRequest'){
      const result=await respondGroupExchangeRequest(adminClient,user,req.body||{});
      return res.status(200).json({ok:true,data:result,message:req.body?.decision==='aceptada'?'Intercambio realizado correctamente.':'Solicitud rechazada.'});
    }

    if (req.method === 'POST' && req.body?.resource === 'prepareTeacherDailyUpload') {
      if(profile.rol!=='docente') return res.status(403).json({ok:false,error:'Solo el docente puede subir la bitácora.'});
      const data=await prepareTeacherDailyUpload(adminClient,user,Number(req.body?.grupo_materia_id||0),Number(req.body?.periodo_id||0),String(req.body?.fecha||''),req.body?.filename);
      return res.status(200).json({ok:true,data});
    }
    if (req.method === 'POST' && req.body?.resource === 'commitTeacherDailyUpload') {
      if(profile.rol!=='docente') return res.status(403).json({ok:false,error:'Solo el docente puede registrar la bitácora.'});
      const data=await commitTeacherDailyUpload(adminClient,user,req.body||{},profile);
      return res.status(200).json({ok:true,message:'Bitácora diaria respaldada. Las evidencias anteriores permanecen protegidas.',data});
    }

    if (req.method === 'POST' && req.body?.resource === 'saveEvaluationRubric') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede configurar su rúbrica.'});
      const gmId=Number(req.body?.grupo_materia_id||0), periodoId=Number(req.body?.periodo_id||0);
      if(!gmId||!periodoId) return res.status(400).json({ok:false,error:'Grupo-materia y periodo son obligatorios.'});
      const {tid}=await teacherOwnAssignment(adminClient,user,gmId,periodoId);
      const items=normalizeEvaluationItems(req.body?.componentes);
      if(!items.length) return res.status(400).json({ok:false,error:'Agrega al menos una actividad.'});
      const total=items.reduce((a,x)=>a+x.ponderacion,0);
      if(Math.abs(total-100)>0.001) return res.status(400).json({ok:false,error:`La ponderación debe sumar 100%. Actualmente suma ${total.toFixed(2)}%.`});
      const totalPoints=items.reduce((a,x)=>a+x.maximo,0);
      if(Math.abs(totalPoints-10)>0.001) return res.status(400).json({ok:false,error:`Los puntos máximos deben sumar 10. Actualmente suman ${totalPoints.toFixed(2)}. Ajusta las ponderaciones.`});
      const {data:existing,error:ee}=await adminClient.from('rubricas_evaluacion').select('*').eq('docente_id',tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).maybeSingle();
      if(ee) throw ee;
      if(existing?.estado==='cerrada') return res.status(409).json({ok:false,error:'Este periodo ya está cerrado.'});
      let rubric;
      if(existing){
        const {data,error}=await adminClient.from('rubricas_evaluacion').update({titulo:String(req.body?.titulo||'Evaluación del periodo').trim()||'Evaluación del periodo',descripcion:String(req.body?.descripcion||'').trim()||null,escala_maxima:10,version:Number(existing.version||1)+1,updated_at:new Date().toISOString()}).eq('id',existing.id).select('*').single(); if(error) throw error; rubric=data;
        const {error:de}=await adminClient.from('rubrica_componentes').delete().eq('rubrica_id',rubric.id); if(de) throw de;
        const {error:se}=await adminClient.from('evaluacion_notas').delete().eq('rubrica_id',rubric.id); if(se) throw se;
      } else {
        const {data,error}=await adminClient.from('rubricas_evaluacion').insert({docente_id:tid,grupo_materia_id:gmId,periodo_id:periodoId,titulo:String(req.body?.titulo||'Evaluación del periodo').trim()||'Evaluación del periodo',descripcion:String(req.body?.descripcion||'').trim()||null,escala_maxima:10,estado:'borrador',version:1}).select('*').single(); if(error) throw error; rubric=data;
      }
      const componentRows=items.map(x=>({...x,rubrica_id:rubric.id}));
      const {data:components,error:ce}=await adminClient.from('rubrica_componentes').insert(componentRows).select('*').order('orden'); if(ce) throw ce;
      return res.status(200).json({ok:true,message:'Rúbrica guardada.',data:{rubrica:rubric,componentes:components}});
    }

    if (req.method === 'POST' && req.body?.resource === 'saveEvaluationScores') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede capturar evaluaciones.'});
      const gmId=Number(req.body?.grupo_materia_id||0), periodoId=Number(req.body?.periodo_id||0), rows=Array.isArray(req.body?.rows)?req.body.rows:[];
      const {tid}=await teacherOwnAssignment(adminClient,user,gmId,periodoId);
      const {data:rubric,error:re}=await adminClient.from('rubricas_evaluacion').select('id,estado').eq('docente_id',tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).maybeSingle(); if(re) throw re;
      if(!rubric) return res.status(404).json({ok:false,error:'Primero registra la rúbrica.'});
      if(rubric.estado==='cerrada') return res.status(409).json({ok:false,error:'Este periodo ya fue cerrado.'});
      const {data:components,error:ce}=await adminClient.from('rubrica_componentes').select('id,maximo').eq('rubrica_id',rubric.id); if(ce) throw ce;
      const maxMap=new Map((components||[]).map(x=>[String(x.id),Number(x.maximo)]));
      const roster=await getTeacherRoster(adminClient,user,gmId,{periodo_id:periodoId}); const allowed=new Set((roster.students||[]).map(x=>String(x.id)));
      const payload=[];
      for(const row of rows){const alumnoId=Number(row.alumno_id||0),componentId=Number(row.componente_id||0);if(!allowed.has(String(alumnoId))||!maxMap.has(String(componentId)))continue;const value=row.valor===''||row.valor==null?null:Number(row.valor);if(value!==null&&(!Number.isFinite(value)||value<0||value>10))return res.status(400).json({ok:false,error:'Las calificaciones de actividades deben estar entre 0 y 10.'});payload.push({rubrica_id:rubric.id,componente_id:componentId,alumno_id:alumnoId,valor:value});}
      if(payload.length){const {error}=await adminClient.from('evaluacion_notas').upsert(payload,{onConflict:'rubrica_id,componente_id,alumno_id'});if(error)throw error;}
      return res.status(200).json({ok:true,message:`Se guardaron ${payload.length} calificaciones de actividades.`});
    }

    if (req.method === 'POST' && req.body?.resource === 'prepareEvaluationUpload') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede subir evidencia.'});
      const gmId=Number(req.body?.grupo_materia_id||0), periodoId=Number(req.body?.periodo_id||0);
      const {tid}=await teacherOwnAssignment(adminClient,user,gmId,periodoId);
      const {data:rubric,error}=await adminClient.from('rubricas_evaluacion').select('id,estado').eq('docente_id',tid).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).maybeSingle(); if(error) throw error;
      if(!rubric) return res.status(404).json({ok:false,error:'Primero registra la rúbrica.'});
      if(rubric.estado==='cerrada') return res.status(409).json({ok:false,error:'Este periodo ya fue cerrado.'});
      const raw=String(req.body?.filename||'evaluacion.xlsx').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120);
      const path=`${tid}/${new Date().getFullYear()}/${periodoId}/${gmId}/${rubric.id}-${Date.now()}-${raw}`;
      const {data,error:se}=await adminClient.storage.from('evaluaciones-docentes').createSignedUploadUrl(path,{upsert:false}); if(se) throw se;
      return res.status(200).json({ok:true,data:{bucket:'evaluaciones-docentes',path,token:data.token}});
    }

    if (req.method === 'POST' && req.body?.resource === 'submitEvaluationPeriod') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede cerrar su evaluación.'});
      const gmId=Number(req.body?.grupo_materia_id||0), periodoId=Number(req.body?.periodo_id||0);
      const closure=await buildEvaluationClosure(adminClient,user,gmId,periodoId);
      const adjustments=Array.isArray(req.body?.adjustments)?req.body.adjustments:[];
      const allowedAdjustments=new Map(closure.detail.map(x=>[String(x.alumno_id),x]));
      const normalizedAdjustments=[];
      for(const a of adjustments){
        const base=allowedAdjustments.get(String(Number(a?.alumno_id||0)));
        if(!base) continue;
        const reason=String(a?.motivo||'').trim().slice(0,500);
        const hasNew=a?.valor_nuevo!==''&&a?.valor_nuevo!=null;
        if(!hasNew) continue;
        const nuevo=Number(a.valor_nuevo);
        if(!Number.isFinite(nuevo)||nuevo<0||nuevo>10) throw Object.assign(new Error(`El ajuste de ${base.nombre_completo} debe estar entre 0 y 10.`),{status:400});
        if(Math.abs(nuevo-base.calificacion)>0.001 && !reason) throw Object.assign(new Error(`Debes indicar el motivo del ajuste de ${base.nombre_completo}.`),{status:400});
        if(Math.abs(nuevo-base.calificacion)>0.001) normalizedAdjustments.push({alumno_id:base.alumno_id,valor_calculado:base.calificacion,valor_anterior:base.calificacion,valor_nuevo:Number(nuevo.toFixed(2)),motivo:reason,tipo:nuevo>base.calificacion?'aumento':'disminucion'});
      }
      if(normalizedAdjustments.length){const {error:aq}=await adminClient.from('ajustes_calificacion').select('id').limit(1);if(aq) throw Object.assign(new Error('No se puede registrar el ajuste porque falta la migración sql/ITHLA_DB_COMPLETO_2026_2027.sql. No se cerró el periodo.'),{status:409});}
      const adjustmentMap=new Map(normalizedAdjustments.map(x=>[String(x.alumno_id),x]));
      for(const row of closure.gradeRows){const a=adjustmentMap.get(String(row.alumno_id));if(a){row.calificacion=a.valor_nuevo;row.observaciones=`Ajuste docente registrado: ${a.motivo}`;row.detalle_evaluacion={...(row.detalle_evaluacion||{}),ajuste:{valor_calculado:a.valor_calculado,valor_nuevo:a.valor_nuevo,tipo:a.tipo,motivo:a.motivo}};}}
      const filePath=String(req.body?.file_path||'');
      if(filePath && !filePath.startsWith(`${closure.ctx.tid}/`)) return res.status(403).json({ok:false,error:'Archivo de evidencia no autorizado.'});
      const closureRow={rubrica_id:closure.rubric.id,docente_id:closure.ctx.tid,grupo_materia_id:gmId,periodo_id:periodoId,archivo_path:filePath||null,archivo_nombre:String(req.body?.file_name||'').slice(0,180)||null,archivo_sha256:String(req.body?.file_sha256||'').slice(0,64)||null,registros:closure.detail.length,promedio_general:closure.detail.length?closure.detail.reduce((a,x)=>a+x.calificacion,0)/closure.detail.length:null,estado:'cerrado',resumen:closure.detail.map(x=>({alumno_id:x.alumno_id,matricula:x.matricula,calificacion:x.calificacion})),submitted_at:new Date().toISOString(),submitted_by:user.id};
      const {data:close,error:ce}=await adminClient.from('cierres_evaluacion').upsert(closureRow,{onConflict:'rubrica_id'}).select('*').single(); if(ce) throw ce;
      const gradeRows=closure.gradeRows.map(x=>({...x,cierre_evaluacion_id:close.id}));
      for(const row of gradeRows){
        const {data:existing,error:qe}=await adminClient.from('calificaciones').select('id').eq('alumno_id',row.alumno_id).eq('grupo_materia_id',row.grupo_materia_id).eq('periodo_id',row.periodo_id).maybeSingle();
        if(qe) throw qe;
        let gradeId=existing?.id||null;
        if(existing?.id){ const {data:updated,error}=await adminClient.from('calificaciones').update(row).eq('id',existing.id).select('id').single(); if(error) throw error; gradeId=updated.id; }
        else { const {data:created,error}=await adminClient.from('calificaciones').insert(row).select('id').single(); if(error) throw error; gradeId=created.id; }
        const adj=adjustmentMap.get(String(row.alumno_id));
        if(adj){ const {error:ae}=await adminClient.from('ajustes_calificacion').insert({calificacion_id:gradeId,alumno_id:row.alumno_id,grupo_materia_id:row.grupo_materia_id,periodo_id:row.periodo_id,docente_id:row.docente_id,valor_calculado:adj.valor_calculado,valor_anterior:adj.valor_anterior,valor_nuevo:adj.valor_nuevo,tipo:adj.tipo,motivo:adj.motivo,estado:'registrado',creado_por:user.id}); if(ae) throw ae; }
      }
      const {error:ue}=await adminClient.from('rubricas_evaluacion').update({estado:'cerrada',submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',closure.rubric.id); if(ue) throw ue;
            // La evidencia detallada queda compactada en calificaciones.detalle_evaluacion;
      // liberamos las filas temporales para no duplicar innecesariamente el histórico.
      const {error:cleanupError}=await adminClient.from('evaluacion_notas').delete().eq('rubrica_id',closure.rubric.id); if(cleanupError) console.warn('No se pudo compactar evaluacion_notas:',cleanupError.message);
      return res.status(200).json({ok:true,message:`Periodo cerrado. Se respaldaron ${gradeRows.length} calificaciones con su rúbrica${normalizedAdjustments.length?` y ${normalizedAdjustments.length} ajuste(s) justificado(s)`:''}.`,data:{cierre:close,calificaciones:gradeRows.length,ajustes:normalizedAdjustments.length}});
    }

    if (req.method === 'POST' && req.body?.resource === 'saveTeacherGrades') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede capturar calificaciones.'});
      const gmId=Number(req.body?.grupo_materia_id||0), periodoId=Number(req.body?.periodo_id||0), rows=Array.isArray(req.body?.rows)?req.body.rows:[];
      const roster=await getTeacherRoster(adminClient,user,gmId,{periodo_id:periodoId});
      const allowed=new Set((roster.students||[]).map(s=>String(s.id)));
      for(const row of rows){
        const alumnoId=Number(row.alumno_id||0); if(!allowed.has(String(alumnoId))) continue;
        const raw=row.calificacion; const hasValue=raw!==''&&raw!=null; const grade=hasValue?Number(raw):null;
        if(grade!==null && (!Number.isFinite(grade)||grade<0||grade>10)) throw Object.assign(new Error(`Calificación inválida para el alumno ${alumnoId}.`),{status:400});
        const {data:existing,error:ee}=await adminClient.from('calificaciones').select('id').eq('alumno_id',alumnoId).eq('grupo_materia_id',gmId).eq('periodo_id',periodoId).maybeSingle(); if(ee) throw ee;
        const payload={alumno_id:alumnoId,grupo_materia_id:gmId,periodo_id:periodoId,docente_id:await teacherId(adminClient,user.id),calificacion:grade,observaciones:String(row.observaciones||'').trim()||null};
        if(existing?.id){const {error}=await adminClient.from('calificaciones').update(payload).eq('id',existing.id);if(error)throw error;}
        else {const {error}=await adminClient.from('calificaciones').insert(payload);if(error)throw error;}
      }
      return res.status(200).json({ok:true,message:`Se guardaron ${rows.length} registros de calificación.`});
    }

    if (req.method === 'POST' && req.body?.resource === 'saveTeacherAttendance') {
      if (profile.rol !== 'docente') return res.status(403).json({ok:false,error:'Solo el docente puede capturar asistencia.'});
      const gmId=Number(req.body?.grupo_materia_id||0), fecha=String(req.body?.fecha||'').trim(), rows=Array.isArray(req.body?.rows)?req.body.rows:[];
      if(!gmId||!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ok:false,error:'Grupo-materia y fecha son obligatorios.'});
      const roster=await getTeacherRoster(adminClient,user,gmId,{fecha}); const allowed=new Set((roster.students||[]).map(s=>String(s.id))); const tid=await teacherId(adminClient,user.id);
      const validStates=new Set(['presente','retardo','falta','justificada']);
      for(const row of rows){const alumnoId=Number(row.alumno_id||0);if(!allowed.has(String(alumnoId)))continue;const estado=String(row.estado||'').toLowerCase();if(!validStates.has(estado))throw Object.assign(new Error('Estado de asistencia inválido.'),{status:400});const {data:existing,error:ee}=await adminClient.from('asistencias').select('id').eq('alumno_id',alumnoId).eq('grupo_materia_id',gmId).eq('fecha',fecha).eq('docente_id',tid).maybeSingle();if(ee)throw ee;const payload={alumno_id:alumnoId,grupo_materia_id:gmId,fecha,estado,docente_id:tid,observaciones:String(row.observaciones||'').trim()||null};if(existing?.id){const {error}=await adminClient.from('asistencias').update(payload).eq('id',existing.id);if(error)throw error;}else{const {error}=await adminClient.from('asistencias').insert(payload);if(error)throw error;}}
      return res.status(200).json({ok:true,message:`Se guardaron ${rows.length} registros de asistencia.`});
    }

    if (req.method === 'POST' && req.body?.resource === 'resolveClarification') {
      const allowed = ['docente','direccion_escolar','control_escolar','control','coordinacion_academica'];
      if (!allowed.includes(profile.rol)) return res.status(403).json({ ok:false, error:'No autorizado para resolver aclaraciones.' });
      const id = Number(req.body?.id || 0);
      const estado = req.body?.estado === 'aprobada' ? 'aprobada' : req.body?.estado === 'rechazada' ? 'rechazada' : null;
      if (!id || !estado) return res.status(400).json({ ok:false, error:'Aclaración inválida.' });
      const { data: request, error: re } = await adminClient.from('solicitudes_estudiantiles').select('*').eq('id', id).eq('tipo','aclaracion_calificacion').maybeSingle();
      if (re || !request) return res.status(404).json({ ok:false, error:'Aclaración no encontrada.' });
      if (profile.rol === 'docente') {
        const tid = await teacherId(adminClient, user.id);
        if (Number(request.docente_destino_id) !== Number(tid)) return res.status(403).json({ ok:false, error:'Esta aclaración no corresponde a tus grupos.' });
      }
      const nueva = req.body?.nueva_calificacion === '' || req.body?.nueva_calificacion == null ? null : Number(req.body.nueva_calificacion);
      if (nueva !== null && (!Number.isFinite(nueva) || nueva < 0 || nueva > 10)) return res.status(400).json({ ok:false, error:'La nueva calificación debe estar entre 0 y 10.' });
      if (estado === 'aprobada' && nueva !== null) {
        const { error: ue } = await adminClient.from('calificaciones').update({ calificacion:nueva, observaciones:req.body?.observaciones || null }).eq('id', request.calificacion_id);
        if (ue) throw ue;
      }
      const { error: ue } = await adminClient.from('solicitudes_estudiantiles').update({ estado, observaciones_resolucion:req.body?.observaciones || null, atendida_por:user.id, atendida_at:new Date().toISOString() }).eq('id', id);
      if (ue) throw ue;
      return res.status(200).json({ ok:true, message: estado === 'aprobada' ? 'Aclaración resuelta.' : 'Aclaración rechazada.' });
    }

    /* ARCHIVO ESCOLAR · DOCUMENTOS OFICIALES */
    if (req.method === 'POST' && req.body?.resource === 'generateOfficialDocument') {
      const data = await generateOfficialDocument(adminClient, user, profile, req.body || {}, req);
      return res.status(200).json({ok:true,data,message:`Documento oficial generado: ${data.folio}.`});
    }

    /* DEPARTAMENTOS */
    if (req.method === 'POST' && req.body?.resource === 'departments') {
      if (profile.rol !== 'direccion_escolar') return res.status(403).json({ok:false,error:'Solo Dirección Escolar puede administrar departamentos.'});
      const body = req.body?.data || {};
      const clean = { clave:String(body.clave||'').trim().toUpperCase(), nombre:String(body.nombre||'').trim(), descripcion:String(body.descripcion||'').trim() || null, activo:body.activo !== false };
      if (!clean.clave || !clean.nombre) return res.status(400).json({ok:false,error:'Clave y nombre son obligatorios.'});
      const {data,error}=await adminClient.from('departamentos').insert(clean).select('*').single();
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return res.status(200).json({ok:true,data});
    }

    /* INCIDENCIAS */
    if (
      req.method === 'POST' &&
      req.body?.resource ===
        'incidencias'
    ) {
      return res
        .status(200)
        .json({
          ok: true,
          data: await writeResource(
            adminClient,
            'incidencias',
            req.body?.data || {},
            user,
            profile
          )
        });
    }

    /* ALTA DIRECTA DE ALUMNO DESDE CONTROL ESCOLAR */
    if (req.method === 'POST' && req.body?.resource === 'lateStudent') {
      const result = await createLateStudent(adminClient, user, profile, req.body?.data || {});
      return res.status(200).json({ok:true,data:result});
    }
    /* ALTA MASIVA DE ALUMNOS DESDE CONTROL ESCOLAR */
    if (req.method === 'POST' && req.body?.resource === 'lateStudentsBulk') {
      const result = await createLateStudentsBulk(adminClient, user, profile, req.body?.rows || []);
      return res.status(200).json({ok:true,data:result});
    }

    /* ASIGNACIÓN ALEATORIA DE TALLERES PARA ALUMNOS SIN TALLER */
    if (req.method === 'POST' && req.body?.resource === 'assignRandomWorkshops') {
      const result = await assignRandomWorkshops(adminClient, user, profile);
      return res.status(200).json({ok:true,data:result});
    }

    /* NOTIFICACIONES DEL ALUMNO */
    if(req.method==='POST' && req.body?.resource==='notifications'){
      if(!user?.id)return res.status(401).json({ok:false,error:'Sesión inválida.'});
      const action=String(req.body?.action||'').trim();
      if(action==='mark_read'){
        const id=Number(req.body?.id||0);
        if(id){const {error}=await adminClient.from('notificaciones').update({leida:true}).eq('id',id).eq('usuario_id',user.id);if(error)throw error;}
        return res.status(200).json({ok:true});
      }
      if(action==='mark_all_read'){
        const {error}=await adminClient.from('notificaciones').update({leida:true}).eq('usuario_id',user.id).eq('leida',false);if(error)throw error;
        return res.status(200).json({ok:true});
      }
      return res.status(400).json({ok:false,error:'Acción de notificación no válida.'});
    }

    /* SOLICITUDES DE CREACIÓN ACADÉMICA */
    if (req.method === 'POST' && req.body?.resource === 'academicRequest') {
      if (profile.rol !== 'control_escolar') return res.status(403).json({ok:false,error:'Solo Control Escolar puede enviar solicitudes de creación a Coordinación Académica.'});
      const b=req.body?.data||{};
      const tipo=String(b.tipo||'').trim();
      if(!['materia','taller'].includes(tipo))return res.status(400).json({ok:false,error:'Tipo de solicitud no válido.'});
      const nombre=String(b.nombre||'').trim();
      if(!nombre)return res.status(400).json({ok:false,error:'El nombre es obligatorio.'});
      const payload={solicitado_por:user.id,tipo,nombre,clave:String(b.clave||'').trim().toUpperCase()||null,grado:Number(b.grado||0)||null,horas_semana:Number(b.horas_semana||0)||null,descripcion:String(b.descripcion||'').trim()||null,estado:'pendiente'};
      const {data,error}=await adminClient.from('solicitudes_academicas').insert(payload).select('*').single();
      if(error)throw Object.assign(new Error(error.message),{status:400});
      return res.status(200).json({ok:true,data,message:'Solicitud enviada a Coordinación Académica.'});
    }
    if (req.method === 'POST' && req.body?.resource === 'resolveAcademicRequest') {
      if (profile.rol !== 'coordinacion_academica') return res.status(403).json({ok:false,error:'Solo Coordinación Académica puede resolver estas solicitudes.'});
      const id=Number(req.body?.id||0), estado=req.body?.estado==='aprobada'?'aprobada':req.body?.estado==='rechazada'?'rechazada':null;
      if(!id||!estado)return res.status(400).json({ok:false,error:'Solicitud inválida.'});
      const {data:reqRow,error:re}=await adminClient.from('solicitudes_academicas').select('*').eq('id',id).maybeSingle();
      if(re||!reqRow)return res.status(404).json({ok:false,error:'Solicitud no encontrada.'});
      if(reqRow.estado!=='pendiente')return res.status(400).json({ok:false,error:'La solicitud ya fue atendida.'});
      if(estado==='aprobada'){
        if(reqRow.tipo==='materia'){
          const clean={nombre:reqRow.nombre,clave:reqRow.clave,grado:reqRow.grado,horas_semana:reqRow.horas_semana||3,activa:true};
          if(reqRow.grado)clean.grados=[Number(reqRow.grado)];
          const {error}=await adminClient.from('materias').insert(clean);
          if(error)throw Object.assign(new Error(`No se pudo crear la materia: ${error.message}`),{status:400});
        }else{
          const {error}=await adminClient.from('talleres').insert({nombre:reqRow.nombre,descripcion:reqRow.descripcion,cupo:30,activo:true});
          if(error)throw Object.assign(new Error(`No se pudo crear el taller: ${error.message}`),{status:400});
        }
      }
      const {error:ue}=await adminClient.from('solicitudes_academicas').update({estado,observaciones_resolucion:String(req.body?.observaciones||'').trim()||null,atendida_por:user.id,atendida_at:new Date().toISOString()}).eq('id',id);
      if(ue)throw ue;
      return res.status(200).json({ok:true,message:estado==='aprobada'?'Solicitud aprobada y recurso creado.':'Solicitud rechazada.'});
    }

    /* =====================================================
       ARCHIVO ESCOLAR · ESCRITURAS ESPECÍFICAS
       ===================================================== */
    if(req.method==='POST' && req.body?.resource==='prepareArchiveUpload'){
      const data=await prepareArchiveUpload(adminClient,user,profile,req.body||{});
      return res.status(200).json({ok:true,data});
    }
    if(req.method==='POST' && req.body?.resource==='saveArchiveDocument'){
      const data=await saveArchiveDocument(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Documento registrado en Archivo Escolar.'});
    }
    if(req.method==='POST' && req.body?.resource==='changeArchiveDocumentStatus'){
      const data=await changeArchiveDocumentStatus(adminClient,user,profile,req.body||{},req);return res.status(200).json({ok:true,data,message:'Estado documental actualizado.'});
    }
    if(req.method==='POST' && req.body?.resource==='updateRetentionCatalog'){
      if(profile.rol!=='archivo_escolar')return res.status(403).json({ok:false,error:'Solo Archivo Escolar puede modificar el catálogo de retención.'});
      const body=req.body?.data||req.body||{};const id=Number(body.id||0);if(!id)return res.status(400).json({ok:false,error:'Registro de retención no válido.'});
      const patch={nombre:String(body.nombre||'').trim().slice(0,180),categoria:String(body.categoria||'').trim(),alcance:String(body.alcance||'interno').trim(),confidencialidad:String(body.confidencialidad||'interno').trim(),editable:String(body.editable||'versionable').trim(),requiere_autorizacion:Boolean(body.requiere_autorizacion),retencion_tipo:String(body.retencion_tipo||'permanente').trim(),retencion_anios:body.retencion_tipo==='anios'?(Number(body.retencion_anios)||null):null,evento_cierre:String(body.evento_cierre||'').trim().slice(0,180)||null,departamento_responsable:String(body.departamento_responsable||'').trim().slice(0,120)||null,descripcion:String(body.descripcion||'').trim().slice(0,1000)||null,updated_at:new Date().toISOString()};
      if(!patch.nombre||!['alumno','docente','evaluacion','administrativo','institucional','financiero'].includes(patch.categoria))return res.status(400).json({ok:false,error:'Datos de retención incompletos o categoría no válida.'});
      const {data,error}=await adminClient.from('catalogo_retencion_documental').update(patch).eq('id',id).select('*').single();if(error)throw error;
      await audit(adminClient,{userId:user.id,role:profile.rol,action:'update_retention_catalog',module:'archivo_escolar',entity:'catalogo_retencion_documental',entityId:id,description:`Actualización de retención ${data.codigo}.`,after:data,req});
      return res.status(200).json({ok:true,data,message:'Registro de retención actualizado.'});
    }
    if(req.method==='POST' && req.body?.resource==='getArchiveDocumentUrl'){
      const data=await getArchiveDocumentUrl(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data});
    }
    if(req.method==='POST' && req.body?.resource==='getArchivePathUrl'){
      const data=await getArchivePathUrl(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data});
    }
    if(req.method==='POST' && req.body?.resource==='requestArchiveAccess'){
      const data=await requestArchiveAccess(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Solicitud de acceso enviada.'});
    }
    if(req.method==='POST' && req.body?.resource==='resolveArchiveAccess'){
      const data=await resolveArchiveAccess(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Solicitud de acceso actualizada.'});
    }
    if(req.method==='POST' && req.body?.resource==='createArchiveTransparencyRequest'){
      const data=await createArchiveTransparencyRequest(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Solicitud enviada a Archivo Escolar.'});
    }
    if(req.method==='POST' && req.body?.resource==='resolveArchiveTransparencyRequest'){
      const data=await resolveArchiveTransparencyRequest(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Solicitud de Archivo Escolar actualizada.'});
    }
    if(req.method==='POST' && req.body?.resource==='submitGradeClaim'){
      const data=await submitGradeClaim(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Reclamo registrado y enviado a revisión docente.'});
    }
    if(req.method==='POST' && req.body?.resource==='resolveGradeClaim'){
      const data=await resolveGradeClaim(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Reclamo actualizado.'});
    }
    if(req.method==='POST' && req.body?.resource==='saveTeacherPlanning'){
      const data=await saveTeacherPlanning(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Planeación guardada como nueva versión.'});
    }
    if(req.method==='POST' && req.body?.resource==='sendTeacherPlanning'){
      const data=await sendTeacherPlanning(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Planeación enviada a revisión.'});
    }
    if(req.method==='POST' && req.body?.resource==='reviewTeacherPlanning'){
      const data=await reviewTeacherPlanning(adminClient,user,profile,req.body||{},req);
      return res.status(200).json({ok:true,data,message:'Planeación actualizada.'});
    }

    /* RECURSOS MONETARIOS */
    if(req.method==='POST' && req.body?.resource==='resolveOfficialDocumentApproval'){const data=await resolveOfficialDocumentApproval(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Revisión de oficio registrada.'});}

    if(req.method==='POST' && req.body?.resource==='financeRequestCredentialPayment'){const data=await financeRequestCredentialPayment(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Solicitud de pago de credencial creada.'});}
    if(req.method==='POST' && req.body?.resource==='financeCreateCharge'){const data=await financeCreateCharge(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Cargo registrado.'});}
    if(req.method==='POST' && req.body?.resource==='financeRegisterPayment'){const data=await financeRegisterPayment(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Pago registrado y comprobante generado.'});}
    if(req.method==='POST' && req.body?.resource==='financeReceiptUrl'){const data=await financeReceiptUrl(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data});}
    if(req.method==='POST' && req.body?.resource==='financeVoidPayment'){const data=await financeVoidPayment(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Pago anulado.'});}
    if(req.method==='POST' && req.body?.resource==='financeCreateExpense'){const data=await financeCreateExpense(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Egreso registrado.'});}
    if(req.method==='POST' && req.body?.resource==='financeApproveExpense'){const data=await financeApproveExpense(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Egreso aprobado.'});}
    if(req.method==='POST' && req.body?.resource==='financePayExpense'){const data=await financePayExpense(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Egreso pagado.'});}
    if(req.method==='POST' && req.body?.resource==='financeCreateBudget'){const data=await financeCreateBudget(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Presupuesto guardado como borrador.'});}
    if(req.method==='POST' && req.body?.resource==='financeApproveBudget'){const data=await financeApproveBudget(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Presupuesto aprobado.'});}
    if(req.method==='POST' && req.body?.resource==='financeSaveConfig'){const data=await financeSaveConfig(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Parámetro financiero actualizado.'});}
    if(req.method==='POST' && req.body?.resource==='financeTransfer'){const data=await financeTransfer(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Transferencia registrada.'});}
    if(req.method==='POST' && req.body?.resource==='financeCashClose'){const data=await financeCashClose(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Corte de caja registrado.'});}
    if(req.method==='POST' && req.body?.resource==='financeVoidTransfer'){const data=await financeVoidTransfer(adminClient,user,profile,req.body?.data||req.body||{},req);return res.status(200).json({ok:true,data,message:'Transferencia anulada.'});}

    /* POST GENERAL */
    if (req.method === 'POST') {
      return res
        .status(200)
        .json({
          ok: true,
          data: await writeResource(
            adminClient,
            req.body?.resource,
            req.body?.data || {},
            user,
            profile
          )
        });
    }

    /* PUT DEPARTAMENTO */
    if (req.method === 'PUT' && req.query?.resource === 'departments') {
      if (profile.rol !== 'direccion_escolar') return res.status(403).json({ok:false,error:'Solo Dirección Escolar puede administrar departamentos.'});
      const id = Number(req.query?.id || 0);
      if (!id) return res.status(400).json({ok:false,error:'Departamento no válido.'});
      const body = req.body || {};
      const patch = {};
      if (body.nombre !== undefined) patch.nombre=String(body.nombre).trim();
      if (body.descripcion !== undefined) patch.descripcion=String(body.descripcion||'').trim() || null;
      if (body.activo !== undefined) patch.activo=body.activo === true;
      const {data,error}=await adminClient.from('departamentos').update(patch).eq('id',id).select('*').single();
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return res.status(200).json({ok:true,data});
    }

    /* PUT */
    if (req.method === 'PUT') {
      return res
        .status(200)
        .json({
          ok: true,
          data: await updateResource(
            adminClient,
            req.query?.resource,
            req.query?.id,
            req.body || {},
            user,
            profile
          )
        });
    }

    /* DELETE */
    if (req.method === 'DELETE') {
      return res
        .status(200)
        .json({
          ok: true,
          data: await deleteResource(
            adminClient,
            req.query?.resource,
            req.query?.id,
            user,
            profile,
            req
          )
        });
    }

    return res
      .status(405)
      .json({
        ok: false,
        error:
          'Método no permitido.'
      });

  } catch (error) {
    return res
      .status(
        error.status || 500
      )
      .json({
        ok: false,
        error:
          error.message ||
          'Error interno.'
      });
  }
}

/* =========================================================
   UTILIDADES DEL GENERADOR DE HORARIOS
   ========================================================= */

function shuffleArray(array) {
  const result = [
    ...array
  ];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      );

    [
      result[i],
      result[j]
    ] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

/* =========================================================
   BLOQUES DE CADA TURNO
   ========================================================= */

/*
   MATUTINO
   07:00-08:00
   08:00-09:00
   09:00-10:00
   10:00-10:30 RECESO
   10:30-11:30
   11:30-12:30
   12:30-13:30

   VESPERTINO
   15:00-16:00
   16:00-17:00
   17:00-18:00
   18:00-18:30 RECESO
   18:30-19:30
   19:30-20:30
   20:30-21:30

   Por lo tanto:
   6 clases por día × 5 días = 30 horas.
*/

function inferredSlots(group) {
  const letter =
    String(
      group.letra ||
      group.clave ||
      ''
    )
      .toUpperCase()
      .slice(-1);

  const turno =
    String(
      group.turno || ''
    ).toUpperCase();

  const matutino =
    turno === 'MATUTINO' ||
    (
      !turno &&
      ['A', 'B', 'C'].includes(
        letter
      )
    );

  const starts = matutino
    ? [
        '07:00',
        '08:00',
        '09:00',
        '10:30',
        '11:30',
        '12:30'
      ]
    : [
        '15:00',
        '16:00',
        '17:00',
        '18:30',
        '19:30',
        '20:30'
      ];

  const ends = matutino
    ? [
        '08:00',
        '09:00',
        '10:00',
        '11:30',
        '12:30',
        '13:30'
      ]
    : [
        '16:00',
        '17:00',
        '18:00',
        '19:30',
        '20:30',
        '21:30'
      ];

  return starts.map(
    (start, index) => ({
      start,
      end: ends[index]
    })
  );
}

/* =========================================================
   GENERADOR ACADÉMICO PRINCIPAL
   ========================================================= */

async function generateAcademicSchedules(
  admin,
  ciclo
) {
  /*
    CARGA DE DATOS

    El generador usa:

    grupos
      ↓
    grupo_materias
      ↓
    asignaciones_docentes
      ↓
    horarios

    No genera horarios para materias que no tengan
    docente asignado.
  */

  const [
    groupsQuery,
    groupSubjectsQuery,
    assignmentsQuery
  ] = await Promise.all([
    admin
      .from('grupos')
      .select(
        'id,clave,grado,letra,turno,hora_inicio,hora_fin,activo'
      )
      .eq('activo', true)
      .order('grado')
      .order('letra'),

    admin
      .from('grupo_materias')
      .select(
        'id,grupo_id,materia_id,horas_semana,activo,grupos(id,clave,grado,letra,turno,hora_inicio,hora_fin,activo),materias(id,nombre,clave,grado,grados,horas_semana,activa)'
      )
      .eq('activo', true),

    admin
      .from('asignaciones_docentes')
      .select(
        'id,docente_id,grupo_materia_id,horas_asignadas,ciclo_escolar,activo,docentes(id,nombre_completo,especialidad,activo)'
      )
      .eq('activo', true)
      .eq(
        'ciclo_escolar',
        ciclo
      )
  ]);

  for (
    const query of [
      groupsQuery,
      groupSubjectsQuery,
      assignmentsQuery
    ]
  ) {
    if (query.error) {
      throw Object.assign(
        new Error(
          query.error.message
        ),
        { status: 500 }
      );
    }
  }

  const groups =
    groupsQuery.data || [];

  const groupSubjects =
    groupSubjectsQuery.data || [];

  const assignments =
    assignmentsQuery.data || [];

  /* =======================================================
     VALIDACIÓN DE LOS 18 GRUPOS
     ======================================================= */

  if (!groups.length) {
    throw Object.assign(
      new Error(
        'No hay grupos activos.'
      ),
      { status: 400 }
    );
  }

  if (groups.length !== 18) {
    throw Object.assign(
      new Error(
        `Se esperaban 18 grupos activos, pero hay ${groups.length}. Activa/corrige los 18 grupos antes de generar los horarios.`
      ),
      { status: 400 }
    );
  }

  if (!groupSubjects.length) {
    throw Object.assign(
      new Error(
        'No hay materias asignadas a los grupos.'
      ),
      { status: 400 }
    );
  }

  /* =======================================================
     INDEXAR ASIGNACIONES
     ======================================================= */

  const assignmentsByGroupSubject =
    new Map();

  for (
    const assignment of assignments
  ) {
    if (
      !assignmentsByGroupSubject.has(
        assignment.grupo_materia_id
      )
    ) {
      assignmentsByGroupSubject.set(
        assignment.grupo_materia_id,
        []
      );
    }

    assignmentsByGroupSubject
      .get(
        assignment.grupo_materia_id
      )
      .push(assignment);
  }

  const missingErrors = [];

  const groupLoads =
    new Map();

  const teacherLoads =
    new Map();

  /* =======================================================
     VALIDAR HORAS POR GRUPO-MATERIA
     ======================================================= */

  for (
    const groupSubject of groupSubjects
  ) {
    const group =
      groupSubject.grupos;

    const subject =
      groupSubject.materias;

    if (
      !group ||
      group.activo === false ||
      !subject ||
      subject.activa === false
    ) {
      continue;
    }

    const required =
      Number(
        groupSubject.horas_semana ??
        subject.horas_semana ??
        0
      );

    const list =
      assignmentsByGroupSubject.get(
        groupSubject.id
      ) || [];

    const assigned =
      list.reduce(
        (total, assignment) =>
          total +
          Number(
            assignment.horas_asignadas ||
            0
          ),
        0
      );

    if (
      !Number.isInteger(required) ||
      required <= 0
    ) {
      missingErrors.push(
        `${group.clave} · ${subject.nombre}: horas requeridas inválidas.`
      );
    }

    if (
      assigned !== required
    ) {
      missingErrors.push(
        `${group.clave} · ${subject.nombre}: requiere ${required} h y tiene ${assigned} h asignadas.`
      );
    }

    /*
      Registrar carga de docentes.
      IMPORTANTE:
      el docente NO tiene turno.
    */

    for (
      const assignment of list
    ) {
      if (
        !assignment.docentes ||
        assignment.docentes.activo === false
      ) {
        missingErrors.push(
          `${group.clave} · ${subject.nombre}: docente inactivo o inexistente.`
        );
      }

      const hours =
        Number(
          assignment.horas_asignadas ||
          0
        );

      if (hours > 0) {
        teacherLoads.set(
          assignment.docente_id,
          (
            teacherLoads.get(
              assignment.docente_id
            ) || 0
          ) + hours
        );
      }
    }

    /*
      Carga académica total del grupo.
    */

    groupLoads.set(
      group.id,
      (
        groupLoads.get(
          group.id
        ) || 0
      ) + required
    );
  }

  /* =======================================================
     REGLA CENTRAL: 30 HORAS EXACTAS POR GRUPO
     ======================================================= */

  const loadErrors = [];

  for (
    const group of groups
  ) {
    const total =
      groupLoads.get(
        group.id
      ) || 0;

    if (total !== 30) {
      loadErrors.push(
        `${group.clave}: ${total}/30 horas académicas. ${
          total < 30
            ? `Faltan ${30 - total} horas.`
            : `Sobran ${total - 30} horas.`
        }`
      );
    }
  }

  if (loadErrors.length) {
    throw Object.assign(
      new Error(
        [
          'No se pueden generar los horarios porque la carga académica no completa exactamente 30 horas semanales por grupo.',
          '',
          ...loadErrors,
          '',
          'Corrige Materias y Asignaciones antes de volver a generar.'
        ].join('\n')
      ),
      { status: 400 }
    );
  }

  /* =======================================================
     VALIDAR ASIGNACIONES
     ======================================================= */

  if (missingErrors.length) {
    const sample =
      missingErrors
        .slice(0, 30)
        .join('\n');

    throw Object.assign(
      new Error(
        [
          'No se pueden generar los horarios todavía.',
          'Primero completa correctamente las asignaciones de horas.',
          '',
          sample,
          missingErrors.length > 30
            ? '\n…'
            : ''
        ].join('\n')
      ),
      { status: 400 }
    );
  }

  /* =======================================================
     VALIDAR CARGA MÁXIMA DE DOCENTES
     =======================================================

     Como NO existe turno docente:

     6 bloques matutinos × 5 días = 30
     6 bloques vespertinos × 5 días = 30

     Máximo teórico = 60.
  */

  for (
    const [
      teacherIdValue,
      load
    ] of teacherLoads
  ) {
    if (load > 60) {
      const assignment =
        assignments.find(
          x =>
            x.docente_id ===
            teacherIdValue
        );

      throw Object.assign(
        new Error(
          `El docente ${
            assignment?.docentes
              ?.nombre_completo ||
            teacherIdValue
          } tiene ${load} horas asignadas. Un docente sin turno puede tener como máximo 60 bloques semanales.`
        ),
        { status: 400 }
      );
    }
  }

  /* =======================================================
     CONSTRUIR BLOQUES DISPONIBLES POR GRUPO
     ======================================================= */

  const groupSlots =
    new Map();

  for (
    const group of groups
  ) {
    const dailySlots =
      inferredSlots(group);

    const weeklySlots = [];

    for (
      let day = 1;
      day <= 5;
      day++
    ) {
      for (
        const slot of dailySlots
      ) {
        weeklySlots.push({
          day,
          start: slot.start,
          end: slot.end
        });
      }
    }

    /*
      Debe haber exactamente 30 bloques:
      6 por día × 5 días.
    */

    if (
      weeklySlots.length !== 30
    ) {
      throw Object.assign(
        new Error(
          `El grupo ${group.clave} no tiene exactamente 30 bloques disponibles en su turno.`
        ),
        { status: 500 }
      );
    }

    groupSlots.set(
      group.id,
      weeklySlots
    );
  }

  /* =======================================================
     CREAR TAREAS DE HORARIO
     ======================================================= */

  const tasks = [];

  for (
    const groupSubject of groupSubjects
  ) {
    const group =
      groupSubject.grupos;

    if (
      !group ||
      group.activo === false
    ) {
      continue;
    }

    const list =
      assignmentsByGroupSubject.get(
        groupSubject.id
      ) || [];

    for (
      const assignment of list
    ) {
      const hours =
        Number(
          assignment.horas_asignadas ||
          0
        );

      for (
        let index = 0;
        index < hours;
        index++
      ) {
        tasks.push({
          id:
            `${groupSubject.id}-${assignment.id}-${index}`,

          groupSubject,

          group,

          assignment,

          teacherId:
            assignment.docente_id,

          subject:
            groupSubject.materias
        });
      }
    }
  }

  /*
    18 grupos × 30 horas = 540 clases.
  */

  const expectedTotal =
    groups.length * 30;

  if (
    tasks.length !==
    expectedTotal
  ) {
    throw Object.assign(
      new Error(
        `La carga de tareas resultó en ${tasks.length} bloques, pero deberían existir exactamente ${expectedTotal}.`
      ),
      { status: 400 }
    );
  }

  /* =======================================================
     SOLVER ALEATORIO
     ======================================================= */

  const maxRestarts = 35;
  const maxNodes = 350000;

  let solution = null;
  let bestFailure = '';

  for (
    let restart = 0;
    restart < maxRestarts &&
    !solution;
    restart++
  ) {
    /*
      Ocupación del grupo:
      grupo + día + hora

      Ocupación docente:
      docente + día + hora

      IMPORTANTE:
      teacherBusy es GLOBAL.

      Así un docente puede:
      - dar 2B por la mañana
      - dar 2D por la tarde

      pero nunca:
      - dar dos grupos al mismo tiempo.
    */

    const groupBusy =
      new Set();

    const teacherBusy =
      new Set();

    /*
      Control de distribución de la misma
      materia por día.
    */

    const groupSubjectDayCount =
      new Map();

    const placements =
      new Array(
        tasks.length
      );

    const taskPositions =
      new Map();

    let nodes = 0;

    const shuffledTasks =
      shuffleArray(tasks);

    shuffledTasks.forEach(
      (task, index) => {
        taskPositions.set(
          task.id,
          index
        );
      }
    );

    const candidatesByTask =
      new Map();

    for (
      const task of shuffledTasks
    ) {
      candidatesByTask.set(
        task.id,
        shuffleArray(
          groupSlots.get(
            task.group.id
          ) || []
        )
      );
    }

    /* -------------------------------------
       CANDIDATOS DISPONIBLES
       ------------------------------------- */

    function available(task) {
      const result = [];

      for (
        const slot of
          candidatesByTask.get(
            task.id
          ) || []
      ) {
        const groupKey =
          `${task.group.id}|${slot.day}|${slot.start}`;

        const teacherKey =
          `${task.teacherId}|${slot.day}|${slot.start}`;

        /*
          No dos clases del mismo grupo
          en el mismo bloque.
        */

        if (
          groupBusy.has(
            groupKey
          )
        ) {
          continue;
        }

        /*
          No dos clases del mismo docente
          en el mismo bloque.
        */

        if (
          teacherBusy.has(
            teacherKey
          )
        ) {
          continue;
        }

        const subjectDayKey =
          `${task.groupSubject.id}|${slot.day}`;

        const repeats =
          groupSubjectDayCount.get(
            subjectDayKey
          ) || 0;

        /*
          Penalizamos poner muchas horas
          de la misma materia el mismo día.

          Esto NO rompe la solución.
          Solo ayuda a distribuirla mejor.
        */

        const score =
          repeats * 100 +
          Math.random() * 10;

        result.push({
          slot,
          repeats,
          score
        });
      }

      result.sort(
        (a, b) =>
          a.score -
          b.score
      );

      return result;
    }

    /* -------------------------------------
       BÚSQUEDA BACKTRACKING
       ------------------------------------- */

    function search(completed) {
      nodes++;

      if (
        nodes >
        maxNodes
      ) {
        return false;
      }

      if (
        completed ===
        shuffledTasks.length
      ) {
        return true;
      }

      let chosenTask = null;
      let chosenOptions = null;

      /*
        MRV:
        elegimos primero la tarea con
        menos opciones disponibles.
      */

      for (
        const task of shuffledTasks
      ) {
        const index =
          taskPositions.get(
            task.id
          );

        if (
          placements[index]
        ) {
          continue;
        }

        const options =
          available(task);

        if (!options.length) {
          return false;
        }

        if (
          !chosenOptions ||
          options.length <
            chosenOptions.length
        ) {
          chosenTask =
            task;

          chosenOptions =
            options;

          if (
            options.length ===
            1
          ) {
            break;
          }
        }
      }

      const index =
        taskPositions.get(
          chosenTask.id
        );

      for (
        const option of
          chosenOptions
      ) {
        const slot =
          option.slot;

        const groupKey =
          `${chosenTask.group.id}|${slot.day}|${slot.start}`;

        const teacherKey =
          `${chosenTask.teacherId}|${slot.day}|${slot.start}`;

        const subjectDayKey =
          `${chosenTask.groupSubject.id}|${slot.day}`;

        groupBusy.add(
          groupKey
        );

        teacherBusy.add(
          teacherKey
        );

        groupSubjectDayCount.set(
          subjectDayKey,
          (
            groupSubjectDayCount.get(
              subjectDayKey
            ) || 0
          ) + 1
        );

        placements[index] = {
          grupo_materia_id:
            chosenTask
              .groupSubject
              .id,

          docente_id:
            chosenTask
              .teacherId,

          dia_semana:
            slot.day,

          hora_inicio:
            slot.start,

          hora_fin:
            slot.end,

          aula: null,

          ciclo_escolar:
            ciclo
        };

        if (
          search(
            completed + 1
          )
        ) {
          return true;
        }

        delete placements[
          index
        ];

        groupBusy.delete(
          groupKey
        );

        teacherBusy.delete(
          teacherKey
        );

        const newCount =
          (
            groupSubjectDayCount.get(
              subjectDayKey
            ) || 1
          ) - 1;

        if (
          newCount <= 0
        ) {
          groupSubjectDayCount.delete(
            subjectDayKey
          );
        } else {
          groupSubjectDayCount.set(
            subjectDayKey,
            newCount
          );
        }
      }

      return false;
    }

    if (
      search(0)
    ) {
      solution =
        placements.filter(
          Boolean
        );
    } else {
      bestFailure =
        `No fue posible acomodar todas las horas en el intento ${restart + 1}.`;
    }
  }

  /* =======================================================
     NO HAY SOLUCIÓN
     ======================================================= */

  if (!solution) {
    throw Object.assign(
      new Error(
        [
          `No se pudo construir un horario sin conflictos después de ${maxRestarts} búsquedas.`,
          bestFailure,
          '',
          'Reglas aplicadas:',
          '• El turno pertenece al grupo.',
          '• Los docentes no tienen turno.',
          '• Un docente puede trabajar mañana y tarde.',
          '• Un docente no puede estar en dos grupos al mismo día y hora.',
          '• Un grupo no puede tener dos materias al mismo día y hora.',
          '• Cada grupo debe tener exactamente 30 bloques.'
        ].join('\n')
      ),
      { status: 400 }
    );
  }

  /* =======================================================
     VALIDACIÓN FINAL DE CONFLICTOS
     ======================================================= */

  const seenGroup =
    new Set();

  const seenTeacher =
    new Set();

  const generatedByGroup =
    new Map();

  for (
    const placement of solution
  ) {
    const groupKey =
      `${placement.grupo_materia_id}|${placement.dia_semana}|${placement.hora_inicio}`;

    const teacherKey =
      `${placement.docente_id}|${placement.dia_semana}|${placement.hora_inicio}`;

    /*
      Conflicto grupo.
    */

    if (
      seenGroup.has(
        groupKey
      )
    ) {
      throw Object.assign(
        new Error(
          'La validación final detectó un conflicto dentro de un grupo. No se modificó la tabla de horarios.'
        ),
        { status: 500 }
      );
    }

    /*
      Conflicto docente.
    */

    if (
      seenTeacher.has(
        teacherKey
      )
    ) {
      throw Object.assign(
        new Error(
          'La validación final detectó que un docente está asignado a dos grupos al mismo día y hora. No se modificó la tabla de horarios.'
        ),
        { status: 500 }
      );
    }

    seenGroup.add(
      groupKey
    );

    seenTeacher.add(
      teacherKey
    );

    /*
      Contabilizar bloques por grupo.
    */

    const groupSubject =
      groupSubjects.find(
        x =>
          x.id ===
          placement.grupo_materia_id
      );

    const groupId =
      groupSubject?.grupo_id;

    if (groupId) {
      generatedByGroup.set(
        groupId,
        (
          generatedByGroup.get(
            groupId
          ) || 0
        ) + 1
      );
    }
  }

  /* =======================================================
     VALIDACIÓN 30/30 POR GRUPO
     ======================================================= */

  const finalLoadErrors =
    [];

  for (
    const group of groups
  ) {
    const total =
      generatedByGroup.get(
        group.id
      ) || 0;

    if (
      total !== 30
    ) {
      finalLoadErrors.push(
        `${group.clave}: ${total}/30 bloques generados.`
      );
    }
  }

  if (
    finalLoadErrors.length
  ) {
    throw Object.assign(
      new Error(
        [
          'La validación final detectó que no todos los grupos tienen exactamente 30 bloques.',
          'No se modificó la tabla de horarios.',
          '',
          ...finalLoadErrors
        ].join('\n')
      ),
      { status: 500 }
    );
  }

  /* =======================================================
     VALIDACIÓN TOTAL
     ======================================================= */

  if (
    solution.length !==
    expectedTotal
  ) {
    throw Object.assign(
      new Error(
        `La validación final esperaba ${expectedTotal} bloques y obtuvo ${solution.length}. No se modificó la tabla de horarios.`
      ),
      { status: 500 }
    );
  }

  /* =======================================================
     VALIDACIÓN DE HORARIOS POR GRUPO
     ======================================================= */

  const groupBlockCounts =
    new Map();

  for (
    const placement of solution
  ) {
    const groupSubject =
      groupSubjects.find(
        x =>
          x.id ===
          placement.grupo_materia_id
      );

    const group =
      groups.find(
        x =>
          x.id ===
          groupSubject?.grupo_id
      );

    if (!group) {
      throw Object.assign(
        new Error(
          'Se encontró un bloque sin grupo válido. No se modificó la tabla de horarios.'
        ),
        { status: 500 }
      );
    }

    const groupKey =
      `${group.id}|${placement.dia_semana}|${placement.hora_inicio}`;

    if (
      !groupBlockCounts.has(
        group.id
      )
    ) {
      groupBlockCounts.set(
        group.id,
        new Set()
      );
    }

    groupBlockCounts
      .get(group.id)
      .add(groupKey);
  }

  for (
    const group of groups
  ) {
    const blocks =
      groupBlockCounts.get(
        group.id
      );

    if (
      !blocks ||
      blocks.size !== 30
    ) {
      throw Object.assign(
        new Error(
          `El grupo ${group.clave} no tiene exactamente 30 bloques únicos. No se modificó la tabla de horarios.`
        ),
        { status: 500 }
      );
    }
  }

  /* =======================================================
     BORRAR HORARIO ANTERIOR
     =======================================================

     IMPORTANTE:

     Esto ocurre DESPUÉS de todas las validaciones.

     Si el generador falla antes de aquí,
     el horario anterior permanece intacto.
  */

  const deleteResult =
    await admin
      .from('horarios')
      .delete()
      .eq(
        'ciclo_escolar',
        ciclo
      );

  if (
    deleteResult.error
  ) {
    throw Object.assign(
      new Error(
        deleteResult.error.message
      ),
      { status: 500 }
    );
  }

  /* =======================================================
     INSERTAR EN LOTES
     ======================================================= */

  const batchSize = 500;

  let inserted = 0;

  for (
    let index = 0;
    index < solution.length;
    index += batchSize
  ) {
    const chunk =
      solution.slice(
        index,
        index + batchSize
      );

    const {
      error
    } = await admin
      .from('horarios')
      .insert(chunk);

    if (error) {
      throw Object.assign(
        new Error(
          error.message
        ),
        { status: 500 }
      );
    }

    inserted +=
      chunk.length;
  }

  try { await admin.from('aceptaciones_horario_docente').update({estado:'revocado'}).eq('ciclo_escolar',ciclo).eq('estado','aceptado'); } catch(e) { console.warn('No se pudieron invalidar aceptaciones previas de horario:', e.message); }

  /* =======================================================
     RESULTADO
     ======================================================= */

  return {
    message:
      `Se generaron ${inserted} bloques de horario para ${groups.length} grupos: 30/30 por grupo.`,

    horarios_generados:
      inserted,

    grupos:
      groups.length,

    bloques_por_grupo:
      30,

    horas_totales_requeridas:
      groups.length * 30,

    ciclo_escolar:
      ciclo,

    reglas: {
      treinta_horas_por_grupo:
        true,

      turno_por_grupo:
        true,

      turno_docente:
        false,

      conflicto_docente_global:
        true,

      conflicto_grupo:
        true,

      receso_excluido:
        true
    }
  };
}

/* =========================================================
   NOTIFICACIONES Y CAMBIO DE GRUPO
   ========================================================= */
async function createJaguarNotification(admin, usuarioId, {titulo,contenido,tipo='solicitud',solicitudId=null}){
  if(!usuarioId)return;
  const {error}=await admin.from('notificaciones').insert({usuario_id:usuarioId,titulo,contenido,tipo,solicitud_id:solicitudId,leida:false});
  if(error)throw error;
}

async function notifyJaguarRole(admin, role, payload){
  const {data,error}=await admin.from('perfiles').select('id').eq('rol',role).eq('activo',true);
  if(error)throw error;
  for(const p of data||[]) await createJaguarNotification(admin,p.id,payload);
}

async function buildNewGroupMatricula(admin, alumno, newGroup){
  const old=String(alumno.matricula||'').trim().toUpperCase();
  const m=old.match(/^(.{6})-([HM])(\d{2})[A-Z][MV]([A-Z])([A-Z]\d)$/);
  if(m){
    const groupLetter=String(newGroup.letra||'').toUpperCase();
    const shift=String(newGroup.turno||'').toUpperCase().startsWith('V')?'V':'M';
    const candidateBase=`${m[1]}-${m[2]}${m[3]}${groupLetter}${shift}${m[4]}${m[5]}`;
    const {data:dup}=await admin.from('alumnos').select('id').eq('matricula',candidateBase).neq('id',alumno.id).maybeSingle();
    if(!dup)return candidateBase;
  }
  let sexo=String(alumno.sexo||'').trim();
  if(!['Hombre','Mujer'].includes(sexo)){
    const oldSex=old.match(/[-_]([HM])(?:\d|$)/i)?.[1]?.toUpperCase();
    const curpSex=String(alumno.curp||'').trim().toUpperCase().charAt(10);
    if(oldSex==='H') sexo='Hombre'; else if(oldSex==='M') sexo='Mujer'; else if(curpSex==='H') sexo='Hombre'; else if(curpSex==='M') sexo='Mujer';
  }
  if(!['Hombre','Mujer'].includes(sexo)){
    throw Object.assign(new Error('No se puede actualizar la matrícula de este alumno automáticamente: falta sexo y tampoco se pudo identificar de forma segura desde su matrícula o CURP. Registra el sexo en su expediente y vuelve a aceptar el cambio.'),{status:409});
  }
  return generateJaguarMatricula(admin,{nombre:alumno.nombre_completo,sexo,grupo:newGroup,turno:newGroup.turno});
}

async function changeStudentGroup(admin, user, profile, request, mode){
  if(profile.rol!=='control_escolar') throw Object.assign(new Error('Solo Control Escolar puede resolver cambios de grupo.'),{status:403});
  const {data:student,error:se}=await admin.from('alumnos').select('id,auth_user_id,nombre_completo,matricula,sexo,grupo_id,grado_ingreso,turno').eq('id',request.alumno_id).maybeSingle();
  if(se)throw se;if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const {data:current,error:ce}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',student.grupo_id).maybeSingle();
  if(ce)throw ce;if(!current)throw Object.assign(new Error('El grupo actual del alumno no existe.'),{status:409});
  let target=null;
  if(mode==='solicitado'){
    const targetId=Number(request.valor_solicitado||0);
    const {data:g,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',targetId).maybeSingle();
    if(ge)throw ge; target=g;
  }else{
    const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('activo',true).eq('grado',Number(current.grado));
    if(ge)throw ge;
    const caps=await groupCapacity(admin,(groups||[]).map(g=>g.id));
    const pool=(groups||[]).filter(g=>Number(g.id)!==Number(current.id) && !caps[String(g.id)]?.lleno);
    if(!pool.length)throw Object.assign(new Error(`No existe otro grupo activo de ${current.grado}° para realizar la reasignación aleatoria.`),{status:409});
    target=pool[Math.floor(Math.random()*pool.length)];
  }
  if(!target||target.activo===false)throw Object.assign(new Error('El grupo destino no está activo.'),{status:400});
  if(Number(target.grado)!==Number(current.grado))throw Object.assign(new Error('El cambio de grupo solo puede hacerse dentro del mismo grado. Un alumno no puede pasar de 1° a 3° mediante una solicitud normal.'),{status:409});
  if(Number(target.id)===Number(current.id))throw Object.assign(new Error('El grupo destino es el mismo grupo actual.'),{status:400});
  const targetCap=await groupCapacity(admin,[target.id]);
  if(targetCap[String(target.id)]?.lleno) throw Object.assign(new Error(`El grupo ${target.clave||''} ya tiene 40 alumnos y no tiene cupo. Para entrar a ese grupo se requiere un intercambio aceptado por otro alumno.`),{status:409});
  const oldMat=String(student.matricula||'').trim();
  const newMat=await buildNewGroupMatricula(admin,student,target);
  const oldEmail=student.auth_user_id?await institutionalEmail(admin,oldMat):null;
  const newEmail=student.auth_user_id?await institutionalEmail(admin,newMat):null;

  const {data:updated,error:ue}=await admin.from('alumnos').update({grupo_id:target.id,grado_ingreso:Number(target.grado),turno:target.turno||null,matricula:newMat}).eq('id',student.id).select('*,grupos(id,clave,grado,letra,turno)').single();
  if(ue)throw ue;

  // Mantiene el historial de matrícula si la tabla existe en la instalación.
  if(oldMat){
    const {data:mr,error:me}=await admin.from('matricula_alumnos').select('id').eq('numero_matricula',oldMat).maybeSingle();
    if(!me && mr){
      const {error:mu}=await admin.from('matricula_alumnos').update({numero_matricula:newMat,matricula_anterior:oldMat}).eq('id',mr.id);
      if(mu && !/column .*matricula_anterior.*does not exist/i.test(mu.message||'')) throw mu;
      if(mu && /column .*matricula_anterior.*does not exist/i.test(mu.message||'')) await admin.from('matricula_alumnos').update({numero_matricula:newMat}).eq('id',mr.id);
    }
  }

  if(student.auth_user_id){
    const {error:ae}=await admin.auth.admin.updateUserById(student.auth_user_id,{email:newEmail,email_confirm:true,user_metadata:{login_email:newEmail,matricula:newMat}});
    if(ae)throw ae;
    const {error:pe}=await admin.from('perfiles').update({correo:newEmail,correo_auth:newEmail,matricula:newMat}).eq('id',student.auth_user_id);
    if(pe)throw pe;
  }
  return {student:updated,current,target,oldMat,newMat,oldEmail,newEmail};
}

/* =========================================================
   CAMBIOS DIRECTOS Y CAMBIOS ESPECIALES DE GRADO
   ========================================================= */
const ITHLA_DEPARTMENTS=['direccion_escolar','control_escolar','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica'];

async function changeStudentGroupDirect(admin,user,profile,body){
  if(profile.rol!=='control_escolar') throw Object.assign(new Error('Solo Control Escolar puede realizar cambios directos de grupo.'),{status:403});
  const alumnoId=Number(body.alumno_id||0), targetId=Number(body.grupo_id||0);
  if(!alumnoId||!targetId) throw Object.assign(new Error('Alumno y grupo destino son obligatorios.'),{status:400});
  const {data:student,error:se}=await admin.from('alumnos').select('id,auth_user_id,nombre_completo,matricula,sexo,grupo_id,grado_ingreso,turno').eq('id',alumnoId).maybeSingle();
  if(se)throw se;if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const {data:current,error:ce}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',student.grupo_id).maybeSingle();
  if(ce)throw ce;if(!current)throw Object.assign(new Error('El grupo actual del alumno no existe.'),{status:409});
  const {data:target,error:te}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',targetId).maybeSingle();
  if(te)throw te;if(!target||target.activo===false)throw Object.assign(new Error('El grupo destino no está activo.'),{status:400});
  if(Number(target.grado)!==Number(current.grado))throw Object.assign(new Error('El cambio directo solo permite mover al alumno dentro de su mismo grado. Para cambiar de grado usa Cambio especial de grado.'),{status:409});
  if(Number(target.id)===Number(current.id))throw Object.assign(new Error('El alumno ya pertenece a ese grupo.'),{status:400});
  const suppliedSex=String(body.sexo||'').trim();
  if(suppliedSex && !['Hombre','Mujer'].includes(suppliedSex)) throw Object.assign(new Error('El sexo indicado no es válido.'),{status:400});
  if(suppliedSex) student.sexo=suppliedSex;
  const newMat=await buildNewGroupMatricula(admin,student,target), oldMat=String(student.matricula||'').trim();
  const newEmail=student.auth_user_id?await institutionalEmail(admin,newMat):null;
  const updatePayload={grupo_id:target.id,grado_ingreso:Number(target.grado),turno:target.turno||null,matricula:newMat};
  if(suppliedSex) updatePayload.sexo=suppliedSex;
  const {data:updated,error:ue}=await admin.from('alumnos').update(updatePayload).eq('id',student.id).select('*,grupos(id,clave,grado,letra,turno)').single();
  if(ue)throw ue;
  if(oldMat){const {data:mr,error:me}=await admin.from('matricula_alumnos').select('id').eq('numero_matricula',oldMat).maybeSingle();if(!me&&mr){const {error:mu}=await admin.from('matricula_alumnos').update({numero_matricula:newMat,matricula_anterior:oldMat}).eq('id',mr.id);if(mu&&/column .*matricula_anterior.*does not exist/i.test(mu.message||''))await admin.from('matricula_alumnos').update({numero_matricula:newMat}).eq('id',mr.id);else if(mu)throw mu;}}
  if(student.auth_user_id){const {error:ae}=await admin.auth.admin.updateUserById(student.auth_user_id,{email:newEmail,email_confirm:true,user_metadata:{...(body.user_metadata||{}),login_email:newEmail,matricula:newMat}});if(ae)throw ae;const {error:pe}=await admin.from('perfiles').update({correo:newEmail,correo_auth:newEmail,matricula:newMat}).eq('id',student.auth_user_id);if(pe)throw pe;}
  try{await createJaguarNotification(admin,student.auth_user_id,{titulo:'Cambio de grupo realizado',contenido:`Control Escolar realizó un cambio de grupo. Grupo anterior: ${current.clave}. Nuevo grupo: ${target.clave}.`,tipo:'cambio_grupo'});}catch(e){console.warn('No se pudo notificar el cambio directo:',e.message)}
  return {student:updated,current,target,oldMat,newMat,newEmail};
}

async function createSpecialGradeRequest(admin,user,profile,body){
  if(profile.rol!=='control_escolar')throw Object.assign(new Error('Solo Control Escolar puede iniciar un cambio especial de grado.'),{status:403});
  const alumnoId=Number(body.alumno_id||0), gradoSolicitado=Number(body.grado_solicitado||0), grupoDestinoId=Number(body.grupo_destino_id||0)||null, motivo=String(body.motivo||'').trim();
  if(!alumnoId||!Number.isInteger(gradoSolicitado)||gradoSolicitado<1||gradoSolicitado>3||!motivo)throw Object.assign(new Error('Alumno, grado solicitado y motivo son obligatorios.'),{status:400});
  const {data:student,error:se}=await admin.from('alumnos').select('id,nombre_completo,matricula,grupo_id,grado_ingreso').eq('id',alumnoId).maybeSingle();if(se)throw se;if(!student)throw Object.assign(new Error('Alumno no encontrado.'),{status:404});
  const {data:current,error:ce}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',student.grupo_id).maybeSingle();if(ce)throw ce;if(!current)throw Object.assign(new Error('El grupo actual del alumno no existe.'),{status:409});
  if(Number(current.grado)===gradoSolicitado)throw Object.assign(new Error('El grado solicitado debe ser diferente al actual. Para cambiar solo de grupo usa el cambio directo.'),{status:400});
  let target=null;
  if(grupoDestinoId){const {data:g,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',grupoDestinoId).maybeSingle();if(ge)throw ge;if(!g||g.activo===false)throw Object.assign(new Error('El grupo destino no está activo.'),{status:400});if(Number(g.grado)!==gradoSolicitado)throw Object.assign(new Error('El grupo destino no corresponde al grado solicitado.'),{status:400});target=g;}
  const {data:pending}=await admin.from('solicitudes_cambio_grado').select('id').eq('alumno_id',alumnoId).in('estado',['pendiente','aprobada']).limit(1);if(pending?.length)throw Object.assign(new Error('Este alumno ya tiene un cambio especial de grado en proceso.'),{status:409});
  const {data:reqRow,error:re}=await admin.from('solicitudes_cambio_grado').insert({alumno_id:alumnoId,grupo_actual_id:current.id,grupo_destino_id:target?.id||null,grado_actual:Number(current.grado),grado_solicitado:gradoSolicitado,motivo,estado:'pendiente',solicitado_por:user.id}).select('*').single();if(re)throw re;
  const approvals=ITHLA_DEPARTMENTS.map(departamento=>({solicitud_id:reqRow.id,departamento,estado:'pendiente'}));
  const {error:ae}=await admin.from('aprobaciones_cambio_grado').insert(approvals);if(ae){await admin.from('solicitudes_cambio_grado').delete().eq('id',reqRow.id);throw ae;}
  for(const role of ITHLA_DEPARTMENTS){try{await notifyJaguarRole(admin,role,{titulo:'Cambio especial de grado pendiente',contenido:`Se solicita autorización para cambiar a ${student.nombre_completo||'un alumno'} de ${current.grado}° a ${gradoSolicitado}°. Una sola negativa rechazará la solicitud.`,tipo:'cambio_grado_especial'});}catch(e){console.warn('No se pudo notificar a '+role,e.message)}}
  return {request:reqRow,target,departments:ITHLA_DEPARTMENTS};
}

async function resolveSpecialGradeApproval(admin,user,profile,body){
  if(!ITHLA_DEPARTMENTS.includes(profile.rol))throw Object.assign(new Error('Este perfil no participa en autorizaciones de cambios especiales de grado.'),{status:403});
  const id=Number(body.id||0), decision=body.decision==='aprobada'?'aprobada':body.decision==='rechazada'?'rechazada':null;
  if(!id||!decision)throw Object.assign(new Error('Solicitud o decisión inválida.'),{status:400});
  const {data:reqRow,error:re}=await admin.from('solicitudes_cambio_grado').select('*,alumnos(id,nombre_completo,matricula,auth_user_id,grupo_id,grado_ingreso,sexo,turno,grupos(id,clave,grado,letra,turno))').eq('id',id).maybeSingle();if(re)throw re;if(!reqRow)throw Object.assign(new Error('Cambio especial no encontrado.'),{status:404});
  if(reqRow.estado!=='pendiente')throw Object.assign(new Error('Esta solicitud ya fue resuelta o ejecutada.'),{status:409});
  const {data:ap,error:ae}=await admin.from('aprobaciones_cambio_grado').select('*').eq('solicitud_id',id).eq('departamento',profile.rol).maybeSingle();if(ae)throw ae;if(!ap)throw Object.assign(new Error('No tienes una autorización pendiente para esta solicitud.'),{status:403});
  if(ap.estado!=='pendiente')throw Object.assign(new Error('Tu departamento ya resolvió esta solicitud.'),{status:409});
  const {error:ue}=await admin.from('aprobaciones_cambio_grado').update({estado:decision,autorizado_por:user.id,observaciones:String(body.observaciones||'').trim()||null,atendida_at:new Date().toISOString()}).eq('id',ap.id);if(ue)throw ue;
  if(decision==='rechazada'){
    await admin.from('solicitudes_cambio_grado').update({estado:'rechazada',atendida_at:new Date().toISOString()}).eq('id',id);
    for(const role of ITHLA_DEPARTMENTS){try{await notifyJaguarRole(admin,role,{titulo:'Cambio especial de grado rechazado',contenido:`La solicitud de cambio de ${reqRow.alumnos?.nombre_completo||'alumno'} fue rechazada por ${labelsRole(role)}.`,tipo:'cambio_grado_especial'});}catch(e){}}
    if(reqRow.alumnos?.auth_user_id)try{await createJaguarNotification(admin,reqRow.alumnos.auth_user_id,{titulo:'Cambio especial de grado rechazado',contenido:`La solicitud de cambio especial de grado fue rechazada por ${labelsRole(profile.rol)}.`,tipo:'cambio_grado_especial'});}catch(e){}
    return {estado:'rechazada',message:'La solicitud fue rechazada. Una sola negativa cancela el cambio especial.'};
  }
  const {data:all,error:allError}=await admin.from('aprobaciones_cambio_grado').select('departamento,estado').eq('solicitud_id',id);if(allError)throw allError;
  const allApproved=ITHLA_DEPARTMENTS.every(role=>(all||[]).some(a=>a.departamento===role&&a.estado==='aprobada'));
  if(allApproved){const {error:su}=await admin.from('solicitudes_cambio_grado').update({estado:'aprobada',atendida_at:new Date().toISOString()}).eq('id',id);if(su)throw su;for(const role of ITHLA_DEPARTMENTS){try{await notifyJaguarRole(admin,role,{titulo:'Cambio especial autorizado',contenido:`Todos los departamentos autorizaron el cambio especial de ${reqRow.alumnos?.nombre_completo||'alumno'}. Control Escolar puede ejecutar el cambio.`,tipo:'cambio_grado_especial'});}catch(e){}}}
  return {estado:allApproved?'aprobada':'pendiente',message:allApproved?'Todos los departamentos autorizaron el cambio. Control Escolar puede ejecutarlo.':'Autorización registrada. Aún faltan departamentos.'};
}

function labelsRole(role){return ({direccion_escolar:'Dirección Escolar',control_escolar:'Control Escolar',servicios_docentes:'Servicios Docentes',servicios_estudiantiles:'Servicios Estudiantiles',prefectura:'Prefectura',coordinacion_academica:'Coordinación Académica'})[role]||role;}

async function reopenSpecialGradeRequest(admin,user,profile,body){
  if(profile.rol!=='direccion_escolar')throw Object.assign(new Error('Solo Dirección Escolar puede reabrir solicitudes.'),{status:403});
  const id=Number(body.id||0);if(!id)throw Object.assign(new Error('Solicitud inválida.'),{status:400});
  const {data:reqRow,error:re}=await admin.from('solicitudes_cambio_grado').select('id,estado').eq('id',id).maybeSingle();if(re)throw re;if(!reqRow)throw Object.assign(new Error('Solicitud no encontrada.'),{status:404});
  if(reqRow.estado!=='rechazada')throw Object.assign(new Error('Solo se pueden reabrir solicitudes rechazadas.'),{status:409});
  const {error:ar}=await admin.from('aprobaciones_cambio_grado').update({estado:'pendiente',autorizado_por:null,observaciones:null,atendida_at:null}).eq('solicitud_id',id);if(ar)throw ar;
  const {error:sr}=await admin.from('solicitudes_cambio_grado').update({estado:'pendiente',atendida_at:null}).eq('id',id);if(sr)throw sr;
  for(const role of ITHLA_DEPARTMENTS){try{await notifyJaguarRole(admin,role,{titulo:'Solicitud reabierta por Dirección Escolar',contenido:'Dirección Escolar reabrió una solicitud de cambio especial de grado para una nueva revisión.',tipo:'cambio_grado_especial'});}catch(e){}}
  return {estado:'pendiente',message:'La solicitud fue reabierta y volvió a enviarse a los departamentos.'};
}

async function executeSpecialGradeChange(admin,user,profile,body){
  if(profile.rol!=='control_escolar')throw Object.assign(new Error('Solo Control Escolar puede ejecutar el cambio especial.'),{status:403});
  const id=Number(body.id||0);if(!id)throw Object.assign(new Error('Solicitud inválida.'),{status:400});
  const {data:reqRow,error:re}=await admin.from('solicitudes_cambio_grado').select('*,alumnos(id,auth_user_id,nombre_completo,matricula,sexo,grupo_id,grado_ingreso,turno)').eq('id',id).maybeSingle();if(re)throw re;if(!reqRow)throw Object.assign(new Error('Solicitud no encontrada.'),{status:404});if(reqRow.estado!=='aprobada')throw Object.assign(new Error('El cambio todavía no tiene la autorización de todos los departamentos.'),{status:409});
  const {data:aps,error:ae}=await admin.from('aprobaciones_cambio_grado').select('departamento,estado').eq('solicitud_id',id);if(ae)throw ae;if(!ITHLA_DEPARTMENTS.every(role=>(aps||[]).some(a=>a.departamento===role&&a.estado==='aprobada')))throw Object.assign(new Error('Falta la autorización de uno o más departamentos.'),{status:409});
  const student=reqRow.alumnos;const {data:groups,error:ge}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('activo',true).eq('grado',Number(reqRow.grado_solicitado));if(ge)throw ge;const caps=await groupCapacity(admin,(groups||[]).map(g=>g.id));let target=(groups||[]).find(g=>Number(g.id)===Number(reqRow.grupo_destino_id))||null;if(!target){const available=(groups||[]).filter(g=>!caps[String(g.id)]?.lleno);if(!available.length)throw Object.assign(new Error(`No hay grupos con cupo disponible para ${reqRow.grado_solicitado}°.`),{status:409});target=available[Math.floor(Math.random()*available.length)];}else if(caps[String(target.id)]?.lleno)throw Object.assign(new Error(`El grupo ${target.clave||''} está lleno (40 alumnos).`),{status:409});
  const current=student.grupo_id?await admin.from('grupos').select('id,clave,grado,letra,turno').eq('id',student.grupo_id).maybeSingle():{data:null};
  const oldGroup=current.data;const newMat=await generateJaguarMatricula(admin,{nombre:student.nombre_completo,sexo:student.sexo,grupo:target,turno:target.turno});const oldMat=String(student.matricula||'').trim();const newEmail=student.auth_user_id?await institutionalEmail(admin,newMat):null;
  const {data:updated,error:ue}=await admin.from('alumnos').update({grupo_id:target.id,grado_ingreso:Number(target.grado),turno:target.turno||null,matricula:newMat}).eq('id',student.id).select('*,grupos(id,clave,grado,letra,turno)').single();if(ue)throw ue;
  if(oldMat){const {data:mr,error:me}=await admin.from('matricula_alumnos').select('id').eq('numero_matricula',oldMat).maybeSingle();if(!me&&mr){const {error:mu}=await admin.from('matricula_alumnos').update({numero_matricula:newMat,matricula_anterior:oldMat}).eq('id',mr.id);if(mu&&/column .*matricula_anterior.*does not exist/i.test(mu.message||''))await admin.from('matricula_alumnos').update({numero_matricula:newMat}).eq('id',mr.id);else if(mu)throw mu;}}
  if(student.auth_user_id){const {error:ae2}=await admin.auth.admin.updateUserById(student.auth_user_id,{email:newEmail,email_confirm:true,user_metadata:{login_email:newEmail,matricula:newMat}});if(ae2)throw ae2;const {error:pe}=await admin.from('perfiles').update({correo:newEmail,correo_auth:newEmail,matricula:newMat}).eq('id',student.auth_user_id);if(pe)throw pe;}
  const {error:mark}=await admin.from('solicitudes_cambio_grado').update({estado:'ejecutada',ejecutada_at:new Date().toISOString(),atendida_at:new Date().toISOString()}).eq('id',id);if(mark)throw mark;
  if(student.auth_user_id)try{await createJaguarNotification(admin,student.auth_user_id,{titulo:'Cambio especial de grado realizado',contenido:`Tu cambio de grado fue autorizado por todos los departamentos y ejecutado por Control Escolar. ${oldGroup?.clave||''} → ${target.clave}.`,tipo:'cambio_grado_especial'});}catch(e){}
  return {student:updated,current:oldGroup,target,oldMat,newMat};
}

/* =========================================================
   SOLICITUDES ESTUDIANTILES
   ========================================================= */

async function handleStudentRequest(
  req,
  res,
  user,
  profile,
  admin,
  legacyWorkshop
) {
  const body =
    req.body || {};

  /* -------------------------
     ALUMNO CREA SOLICITUD
     ------------------------- */

  if (
    profile.rol ===
    'alumno'
  ) {
    const student =
      await studentId(
        admin,
        user.id
      );

    if (!student) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            'Alumno no encontrado.'
        });
    }

    const data =
      body.data || {};

    const type =
      legacyWorkshop
        ? 'taller'
        : String(
            data.tipo ||
            'otro'
          );

    const reason =
      String(
        data.motivo || ''
      ).trim();

    if (!reason) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Indica el motivo de la solicitud.'
        });
    }

    const row = {
      alumno_id:
        student.id,

      tipo:
        type,

      valor_actual:
        data.valor_actual ||
        null,

      valor_solicitado:
        data.valor_solicitado ||
        null,

      motivo:
        reason,

      estado:
        'pendiente',

      departamento_destino:
        type === 'grupo'
          ? 'control_escolar'
          : (type === 'taller' || type === 'grado' || type === 'turno'
            ? 'servicios_estudiantiles'
            : (['control_escolar','servicios_docentes','prefectura','coordinacion_academica'].includes(String(data.departamento_destino||'')) ? String(data.departamento_destino) : 'servicios_estudiantiles'))
    };

    if(type==='grupo') {
      const targetId=Number(data.valor_solicitado||0);
      const {data:studentGroup,error:sg}=await admin.from('alumnos').select('grupo_id,grupos(id,clave,grado,activo)').eq('id',student.id).maybeSingle();
      if(sg)throw sg;
      const {data:target,error:tg}=await admin.from('grupos').select('id,clave,grado,letra,turno,activo').eq('id',targetId).maybeSingle();
      if(tg)throw tg;
      if(!target||target.activo===false)throw Object.assign(new Error('El grupo solicitado no está disponible.'),{status:400});
      if(!studentGroup?.grupos||Number(target.grado)!==Number(studentGroup.grupos.grado))throw Object.assign(new Error('Solo puedes solicitar cambio a otro grupo del mismo grado. Los cambios de grado se tramitan por una solicitud especial.'),{status:400});
      row.valor_actual=String(studentGroup.grupo_id||'');
      row.valor_solicitado=String(target.id);
      const {data:pending}=await admin.from('solicitudes_estudiantiles').select('id').eq('alumno_id',student.id).eq('tipo','grupo').eq('estado','pendiente').limit(1);
      if(pending?.length)throw Object.assign(new Error('Ya tienes una solicitud de cambio de grupo pendiente.'),{status:409});
    }

    if (
      type === 'taller' &&
      data.taller_solicitado_id
    ) {
      row.valor_solicitado =
        String(
          data.taller_solicitado_id
        );
    }

    const {
      data: created,
      error
    } = await admin
      .from(
        'solicitudes_estudiantiles'
      )
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    if(type==='grupo') {
      try{await notifyJaguarRole(admin,'control_escolar',{titulo:'Nueva solicitud de cambio de grupo',contenido:`${student.nombre_completo||'Un alumno'} solicitó cambio de grupo. Revisa la solicitud para aceptar el grupo solicitado o asignar uno aleatorio del mismo grado.`,tipo:'cambio_grupo',solicitudId:created.id});}catch(e){console.warn('No se pudo crear la notificación de Control Escolar:',e.message)}
    } else if(type==='taller') {
      try{await notifyJaguarRole(admin,'servicios_estudiantiles',{titulo:'Nueva solicitud de taller',contenido:`${student.nombre_completo||'Un alumno'} envió una solicitud relacionada con su taller extracurricular.`,tipo:'taller',solicitudId:created.id});}catch(e){console.warn('No se pudo crear la notificación de Servicios Estudiantiles:',e.message)}
    }

    return res
      .status(200)
      .json({
        ok: true,
        data: created
      });
  }

  /* -------------------------
     SERVICIOS ESTUDIANTILES
     RESUELVE
     ------------------------- */

  const allowedRequestResolvers=['direccion_escolar','control_escolar','servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica'];
  if (!allowedRequestResolvers.includes(profile.rol)) {
    return res.status(403).json({ok:false,error:'Este perfil no administra solicitudes.'});
  }

  const id =
    Number(
      body.id || 0
    );

  if (
    body.action ===
    'resolve'
  ) {
    if (!id) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Solicitud inválida.'
        });
    }

    const estado =
      body.estado ===
      'aprobada'
        ? 'aprobada'
        : body.estado ===
          'rechazada'
        ? 'rechazada'
        : null;

    if (!estado) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Estado inválido.'
        });
    }

    const {
      data: request,
      error: requestError
    } = await admin
      .from(
        'solicitudes_estudiantiles'
      )
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (
      requestError ||
      !request
    ) {
      throw Object.assign(
        new Error(
          requestError?.message ||
          'Solicitud no encontrada.'
        ),
        { status: 404 }
      );
    }
    if (profile.rol!=='direccion_escolar' && !(request.tipo==='grupo' && ['control_escolar','control'].includes(profile.rol)) && request.departamento_destino && request.departamento_destino!==profile.rol) {
      return res.status(403).json({ok:false,error:'Esta solicitud pertenece a otro departamento.'});
    }

    if (
      estado ===
      'aprobada'
    ) {
      const alumnoId =
        request.alumno_id;

      if (request.tipo === 'grupo') {
        const mode=body.grupo_modo==='random'?'random':'solicitado';
        const result=await changeStudentGroup(admin,user,profile,request,mode);
        const quien=profile.nombre_completo||user.email||'Control Escolar';
        try{await createJaguarNotification(admin,result.student.auth_user_id,{
          titulo:'Solicitud de cambio de grupo resuelta',
          contenido:`Tu solicitud fue aceptada por ${quien}. Grupo anterior: ${result.current.clave}. Nuevo grupo: ${result.target.clave}. ${mode==='random'?'La reasignación se realizó aleatoriamente dentro de tu mismo grado.':'Se asignó el grupo que solicitaste.'}`,
          tipo:'cambio_grupo',
          solicitudId:id
        });}catch(e){console.warn('No se pudo notificar al alumno:',e.message)}
      }

      if (
        request.tipo ===
          'turno' &&
        request.valor_solicitado
      ) {
        await admin
          .from('alumnos')
          .update({
            turno:
              request.valor_solicitado
          })
          .eq(
            'id',
            alumnoId
          );
      }

      if (
        request.tipo ===
          'grado' &&
        request.valor_solicitado
      ) {
        await admin
          .from('alumnos')
          .update({
            grado_ingreso:
              Number(
                request.valor_solicitado
              )
          })
          .eq(
            'id',
            alumnoId
          );
      }

      if (
        request.tipo ===
          'taller' &&
        request.valor_solicitado
      ) {
        const {
          data: current
        } = await admin
          .from(
            'inscripciones_talleres'
          )
          .select(
            'id,ciclo_escolar'
          )
          .eq(
            'alumno_id',
            alumnoId
          )
          .eq(
            'estado',
            'inscrito'
          )
          .order('id', {
            ascending: false
          })
          .limit(1)
          .maybeSingle();

        if (current?.id) {
          await admin
            .from(
              'inscripciones_talleres'
            )
            .update({
              estado:
                'cambio'
            })
            .eq(
              'id',
              current.id
            );
        }

        const ciclo =
          current?.ciclo_escolar ||
          `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

        const {
          error: workshopError
        } = await admin
          .from(
            'inscripciones_talleres'
          )
          .upsert(
            {
              alumno_id:
                alumnoId,

              taller_id:
                Number(
                  request.valor_solicitado
                ),

              ciclo_escolar:
                ciclo,

              estado:
                'inscrito',

              fecha_inscripcion:
                new Date()
                  .toISOString()
                  .slice(0, 10)
            },
            {
              onConflict:
                'alumno_id,taller_id,ciclo_escolar'
            }
          );

        if (workshopError) {
          throw workshopError;
        }
      }
    }

    if(request.tipo==='grupo' && estado==='rechazada') {
      const {data:st}=await admin.from('alumnos').select('auth_user_id').eq('id',request.alumno_id).maybeSingle();
      const quien=profile.nombre_completo||user.email||'Control Escolar';
      try{await createJaguarNotification(admin,st?.auth_user_id,{titulo:'Solicitud de cambio de grupo rechazada',contenido:`Tu solicitud fue rechazada por ${quien}. Consulta la resolución en Solicitudes para conocer las observaciones.`,tipo:'cambio_grupo',solicitudId:id});}catch(e){console.warn('No se pudo notificar al alumno:',e.message)}
    }

    const {
      error: updateError
    } = await admin
      .from(
        'solicitudes_estudiantiles'
      )
      .update({
        estado,

        observaciones_resolucion:
          body.observaciones_resolucion ||
          null,

        atendida_por:
          user.id,

        atendida_at:
          new Date().toISOString()
      })
      .eq(
        'id',
        id
      );

    if (updateError) {
      throw updateError;
    }

    return res
      .status(200)
      .json({
        ok: true,
        message:
          estado ===
          'aprobada'
            ? 'Solicitud aprobada.'
            : 'Solicitud rechazada.'
      });
  }

  return res
    .status(400)
    .json({
      ok: false,
      error:
        'Acción no válida.'
    });
}
