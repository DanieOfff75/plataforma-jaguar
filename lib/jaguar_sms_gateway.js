import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const hash = s=>createHash('sha256').update(s).digest('hex');
const fail=(m,s=400)=>Object.assign(new Error(m),{status:s});
const db=()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw fail('Supabase no configurado',503);
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
};
function authorize(req){
  const supplied=String(req.headers?.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
  const configured=process.env.JAGUAR_SMS_DEVICE_TOKEN;
  if(!supplied||!configured||configured.length<32)throw fail('No autorizado',401);
  const a=Buffer.from(hash(supplied),'hex'),b=Buffer.from(hash(configured),'hex');
  if(!timingSafeEqual(a,b))throw fail('No autorizado',401);
}
export async function smsGateway(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'});
  try {
    authorize(req);
    const action=String(req.query?.action||new URL(req.url,'https://localhost').searchParams.get('action')||'');
    if(action==='health')return res.status(200).json({ok:true,device:'Jaguar Motorola Gateway',mode:'manual'});
    if(action==='claim'){
      const {data,error}=await db().rpc('jaguar_sms_claim');
      if(error)throw fail('No se pudo reclamar el trabajo',503);
      return res.status(200).json({ok:true,job:data||null});
    }
    if(action==='report'){
      const id=String(req.body?.id||'');const status=String(req.body?.status||'');
      if(!/^[a-f0-9-]{36}$/i.test(id)||!['submitted','failed'].includes(status))throw fail('Reporte inválido');
      const {data,error}=await db().rpc('jaguar_sms_report',{p_id:id,p_status:status});
      if(error)throw fail('No se pudo informar el resultado',503);
      return res.status(200).json({ok:!!data});
    }
    throw fail('Ruta desconocida',404);
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'Error interno'});}
}
