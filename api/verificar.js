import crypto from 'node:crypto';
import { getClients, requireRoles } from '../lib/_admin.js';
import { documentStatus } from './documentos.js';

function hashToken(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function publicData(row,status){
  const payload=row?.datos_publicos&&typeof row.datos_publicos==='object'?row.datos_publicos:{};
  return {ok:true,estado:status,documento:{folio:row.folio,tipo:row.tipo,titulo:row.titulo,fecha_emision:row.fecha_emision,fecha_expiracion:row.fecha_expiracion,datos:payload}};
}

export default async function handler(req,res){
  try{
    const {adminClient}=getClients(req);
    if(req.method==='GET'){
      const token=String(req.query?.token||'').trim();
      if(!token)return res.status(400).json({ok:false,error:'Token de validación requerido.'});
      const {data,error}=await adminClient.from('documentos_verificables').select('folio,tipo,titulo,estado,fecha_emision,fecha_expiracion,datos_publicos,token_hash').eq('token_hash',hashToken(token)).maybeSingle();
      if(error)throw error;
      if(!data)return res.status(404).json({ok:false,estado:'no_valido',error:'El documento no existe o el código de validación no es válido.'});
      const status=documentStatus(data);
      if(status==='expirado'&&data.estado!=='expirado'){
        try{await adminClient.from('documentos_verificables').update({estado:'expirado'}).eq('token_hash',data.token_hash);}catch{}
      }
      return res.status(200).json(publicData(data,status));
    }
    if(req.method==='POST'){
      const {user,profile}=await requireRoles(req,['control','control_escolar','direccion_escolar']);
      const b=req.body||{}; const id=Number(b.id||0); const action=String(b.action||'').trim();
      if(action==='list'){
        const {data,error}=await adminClient.from('documentos_verificables').select('id,folio,tipo,titulo,estado,fecha_emision,fecha_expiracion,alumno_id,datos_publicos').order('id',{ascending:false}).limit(500);
        if(error)throw error;
        return res.status(200).json({ok:true,data:data||[]});
      }
      if(!id||!['valido','cancelado','expirado'].includes(action))return res.status(400).json({ok:false,error:'Solicitud de estado inválida.'});
      const patch={estado:action,updated_at:new Date().toISOString(),updated_by:user.id};
      const {data,error}=await adminClient.from('documentos_verificables').update(patch).eq('id',id).select('id,folio,estado').single();
      if(error)throw error;
      return res.status(200).json({ok:true,data,message:`Documento ${data.folio} actualizado a ${action}.`});
    }
    return res.status(405).json({ok:false,error:'Método no permitido.'});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'No se pudo validar el documento.'});}
}
