import { createHash } from 'node:crypto';

function safeJson(value){
  try{return JSON.parse(JSON.stringify(value ?? null));}catch{return null;}
}

export async function audit(admin,{userId=null,role=null,action,module,entity=null,entityId=null,description='',before=null,after=null,req=null}={}){
  if(!admin || !action || !module) return null;
  const payload={usuario_id:userId||null,rol:role||null,accion:String(action).slice(0,100),modulo:String(module).slice(0,100),entidad:entity?String(entity).slice(0,100):null,entidad_id:entityId==null?null:String(entityId).slice(0,120),descripcion:String(description||'').slice(0,1000),datos_anteriores:safeJson(before),datos_nuevos:safeJson(after)};
  if(req){
    const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim();
    payload.ip=forwarded||String(req.socket?.remoteAddress||'').slice(0,100)||null;
    payload.user_agent=String(req.headers?.['user-agent']||'').slice(0,500)||null;
  }
  try{
    const {data,error}=await admin.from('auditoria_sistema').insert(payload).select('id').maybeSingle();
    if(error && !/auditoria_sistema|schema cache|does not exist/i.test(error.message||'')) throw error;
    return data||null;
  }catch(e){
    console.warn('No se pudo registrar auditoría:',e.message);
    return null;
  }
}

export function hashForAudit(value){
  return createHash('sha256').update(String(value??''),'utf8').digest('hex');
}
