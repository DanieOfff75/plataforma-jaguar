import {evidenceId} from './jaguar_history_evidence.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const roles=['control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios','direccion_escolar'];
const text=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw fail('Campos editoriales incompletos.');return v.trim();};
export async function editorialManagement(db,user,profile,action,b={}){
 if(!roles.includes(profile.rol))throw fail('Sin atribución.',403);
 const args={p_actor:user.id},experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(action==='admin-portal-editorial-write'){
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||!['propose','publish','reject','withdraw','withdraw_legacy'].includes(b.operation))throw fail('Operación inválida.');
  args.p_op=b.operation;args.p_motivo=text(b.reason,15,1500);
  if(b.operation==='propose'){
   if(profile.rol==='direccion_escolar')throw fail('Se requiere propuesta departamental.',403);
   Object.assign(args,{p_titulo:text(b.title,6,180),p_contenido:text(b.body,15,6000),p_referencia:text(b.reference,5,300)});
  }else{
   if(profile.rol!=='direccion_escolar')throw fail('Solo Dirección resuelve.',403);
   try{args.p_id=evidenceId(b.id)}catch{throw fail('Propuesta inválida.');}
  }
  if(['propose','publish'].includes(b.operation)){
   if(b.publicConfirmed!==true)throw fail('Confirma que el texto es público y no contiene datos privados.');args.p_confirmed_public=true;
  }
 }else if(action!=='admin-portal-editorial-data')throw fail('Operación no válida.',404);
 const legacy=b.operation==='withdraw_legacy'&&action==='admin-portal-editorial-write';
 const {data,error}=legacy?await db.rpc('jaguar360_editorial_legacy',{p_actor:user.id,p_id:args.p_id,p_motivo:args.p_motivo}):await db.rpc('jaguar360_editorial_gestion',args);
 if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar la revisión editorial.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);
 if(legacy)return {experimental};
 if(profile.rol==='direccion_escolar'){const legacyRows=await db.rpc('jaguar360_editorial_legacy',{p_actor:user.id});if(legacyRows.error||!Array.isArray(legacyRows.data))throw fail('No se pudo consultar avisos anteriores.',503);return {...data,legacy:legacyRows.data,experimental};}
 return {...data,experimental};
}
export async function publicEditorialApproved(db){
 const {data,error}=await db.rpc('jaguar360_editorial_publica');
 if(error||!Array.isArray(data))throw fail('No se pudo consultar el contenido aprobado.',503);
 // Deliberate whitelist, even if RPC is changed later. No actor, reference, reason or recipient fields.
 return data.map(x=>({id:String(x.id),titulo:String(x.titulo??''),contenido:String(x.contenido??''),descripcion:String(x.contenido??'').slice(0,300),fecha_publicacion:x.fecha_publicacion,responsable_nombre:'Dirección Escolar'}));
}

export async function retiredPublicTitles(db){const {data,error}=await db.rpc('jaguar360_editorial_titulos_retirados');if(error||!Array.isArray(data))throw fail('No se pudo comprobar el retiro de publicaciones.',503);return data.map(x=>String(x).toLocaleLowerCase('es').trim());}
