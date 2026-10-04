const ROLE_DEPARTMENT={
  direccion_escolar:'DIR', control_escolar:'CE', control:'CE', servicios_docentes:'SD',
  servicios_estudiantiles:'SE', prefectura:'PRE', coordinacion_academica:'CA', archivo_escolar:'AE', recursos_monetarios:'RM'
};
export function departmentKeyForRole(role){return ROLE_DEPARTMENT[String(role||'').trim()]||null;}
export async function getDepartmentByKey(admin,clave){
  const key=String(clave||'').trim().toUpperCase(); if(!key)return null;
  const {data,error}=await admin.from('departamentos').select('id,clave,nombre,descripcion,activo').eq('clave',key).maybeSingle();
  if(error)throw error; return data||null;
}
export async function listResponsibleUsers(admin,clave){
  const dep=await getDepartmentByKey(admin,clave); if(!dep)return [];
  const {data:rows,error}=await admin.from('responsables_departamento')
    .select('id,departamento_id,usuario_id,cargo,nombre_responsable,es_director,activo,firma_path,firma_sha256,firma_subida_at,created_at')
    .eq('departamento_id',dep.id).eq('activo',true).order('es_director',{ascending:false}).order('id').limit(1);
  if(error){
    if(/responsables_departamento|schema cache|does not exist/i.test(error.message||'')){
      // Compatibilidad con instalaciones que aún no ejecutaron la migración 037.
      // El sistema usa temporalmente la cuenta departamental existente para que
      // Perfil, documentos y consultas sigan funcionando; no crea una cuenta nueva.
      const roleMap={DIR:['direccion_escolar'],CE:['control_escolar','control'],SD:['servicios_docentes'],SE:['servicios_estudiantiles'],PRE:['prefectura'],CA:['coordinacion_academica'],AE:['archivo_escolar'],RM:['recursos_monetarios']};
      const roles=roleMap[String(clave||'').toUpperCase()]||[];
      if(!roles.length)return [];
      const {data:profiles,error:pe}=await admin.from('perfiles').select('id,nombre_completo,correo,rol,activo,firma_path,firma_sha256,firma_subida_at').in('rol',roles).eq('activo',true).order('id').limit(1);
      if(pe)throw pe;
      const profile=(profiles||[])[0]; if(!profile)return [];
      return [{id:null,registro_id:null,departamento_id:dep.id,usuario_id:profile.id,cargo:`Responsable de ${dep.nombre}`,nombre_responsable:profile.nombre_completo||'Encargado departamental',es_director:String(clave||'').toUpperCase()==='DIR',activo:true,firma_path:profile.firma_path||null,firma_sha256:profile.firma_sha256||null,firma_subida_at:profile.firma_subida_at||null,departamento:dep,perfil:{...profile,cargo:`Responsable de ${dep.nombre}`},nombre_completo:profile.nombre_completo||'Encargado departamental',firma_registrada:!!profile.firma_path}];
    }
    throw error;
  }
  const row=(rows||[])[0]; if(!row)return [];
  let profile=null;
  if(row.usuario_id){
    const {data,error:pe}=await admin.from('perfiles').select('id,nombre_completo,correo,rol,activo,firma_path,firma_sha256,firma_subida_at').eq('id',row.usuario_id).maybeSingle();
    if(pe)throw pe;
    profile=error?null:data||null;
  }
  if(profile && profile.activo===false)return [];
  // La identidad visible y la firma pertenecen al registro interno del encargado.
  // Si no existe una firma propia todavía, se conserva como fallback la firma de la cuenta departamental.
  // La firma propia del encargado tiene prioridad. Si el encargado aún no
  // tiene firma registrada, usamos como respaldo la firma institucional de la
  // cuenta del departamento, tal como contempla el flujo de documentos.
  let fallbackSignature=null;
  if(!row.firma_path && !profile?.firma_path){
    const roleMap={DIR:['direccion_escolar'],CE:['control_escolar','control'],SD:['servicios_docentes'],SE:['servicios_estudiantiles'],PRE:['prefectura'],CA:['coordinacion_academica'],AE:['archivo_escolar'],RM:['recursos_monetarios']};
    const roles=roleMap[String(clave||'').toUpperCase()]||[];
    if(roles.length){
      const {data:departmentProfiles,error:fe}=await admin.from('perfiles')
        .select('id,nombre_completo,correo,rol,firma_path,firma_sha256,firma_subida_at')
        .in('rol',roles).eq('activo',true).not('firma_path','is',null).neq('firma_path','')
        .order('id',{ascending:true}).limit(10);
      if(fe)throw fe;
      fallbackSignature=(departmentProfiles||[])[0]||null;
    }
  }
  const mergedProfile={
    id:row.usuario_id||row.id,
    nombre_completo:row.nombre_responsable||profile?.nombre_completo||fallbackSignature?.nombre_completo||'Encargado departamental',
    correo:profile?.correo||fallbackSignature?.correo||'',
    rol:profile?.rol||fallbackSignature?.rol||null,
    activo:true,
    firma_path:row.firma_path||profile?.firma_path||fallbackSignature?.firma_path||null,
    firma_sha256:row.firma_sha256||profile?.firma_sha256||fallbackSignature?.firma_sha256||null,
    firma_subida_at:row.firma_subida_at||profile?.firma_subida_at||fallbackSignature?.firma_subida_at||null,
    cargo:row.cargo||'Encargado departamental'
  };
  return [{...row,departamento:dep,perfil:mergedProfile,nombre_completo:mergedProfile.nombre_completo,firma_registrada:!!mergedProfile.firma_path}];
}
export async function validateResponsible(admin,responsibleId,role,departmentKey){
  const key=String(departmentKey||departmentKeyForRole(role)||'').trim().toUpperCase();
  const rows=await listResponsibleUsers(admin,key);
  if(!rows.length)throw Object.assign(new Error(`No hay un encargado activo configurado para ${key}. Dirección Escolar debe registrarlo.`),{status:409});
  const current=rows[0];
  // Compatibilidad: las pantallas antiguas pueden enviar el id, pero ya no se elige entre varias personas.
  if(responsibleId && ![String(current.usuario_id||''),String(current.id)].includes(String(responsibleId))){
    // No se rechaza un id antiguo si apunta a un registro histórico; el encargado actual prevalece.
  }
  return {...current,usuario_id:current.usuario_id||null,perfil:current.perfil};
}
