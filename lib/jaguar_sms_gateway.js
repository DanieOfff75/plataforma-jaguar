/** Jaguar SMS · API exclusiva de la plataforma y teléfonos autorizados.
 * No recibe texto SMS de usuarios públicos; el OTP por correo permanece independiente.
 */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import QRCode from 'qrcode';
import {requireRoles} from './_admin.js';

const PUBLIC_ORIGIN='https://plataforma-jaguar.vercel.app';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const numberPattern=/^\+[1-9][0-9]{7,14}$/;
const trim=(value,max=120)=>String(value??'').trim().slice(0,max);
const masked=number=>String(number||'').replace(/.(?=.{4})/g,'•');
function db(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw fail('Supabase sin configurar.',503);
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function one(c,table,values){
  const {data,error}=await c.from(table).insert(values).select().single();
  if(error)throw fail('Error al guardar en base de datos.',503);
  return data;
}
async function device(req,c){
  const token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)throw fail('Dispositivo no autorizado.',401);
  const {data,error}=await c.from('jaguar_sms_v5_devices').select('id,status,max_per_hour').eq('token_hash',hash(token)).maybeSingle();
  if(error)throw fail('No se pudo consultar el dispositivo.',503);
  if(!data||!['active','pending'].includes(data.status))throw fail('Dispositivo revocado o deshabilitado.',401);
  return data;
}
function checkLocalOrigin(req){
  // La sesión técnica depende de JWT + ID de sesión, nunca de la URL.
  const origin=String(req.headers.origin||'');
  if(!origin)throw fail('Abre esta opción desde Plataforma Jaguar.',403);
  if(origin!==PUBLIC_ORIGIN)throw fail('Origen no autorizado.',403);
}
async function adminAction(req,c,action){
  checkLocalOrigin(req);
  const {user}=await requireRoles(req,['tecnico']);
  if(action==='admin-devices'){
    const {data,error}=await c.from('jaguar_sms_v5_devices')
      .select('id,label,status,manufacturer,model,android_version,carrier,battery_percent,signal_level,last_seen_at,created_at,max_per_hour')
      .order('created_at',{ascending:false}).limit(50);
    if(error)throw fail('No se pudo consultar el inventario.',503);
    return {devices:data||[],server_time:new Date().toISOString()};
  }
  if(action==='admin-jobs'){
    await c.rpc('jaguar_sms_v5_maintain');
    const {data,error}=await c.from('jaguar_sms_v5_jobs')
      .select('id,kind,status,device_id,destination,created_at,claimed_at,finished_at,expires_at')
      .order('created_at',{ascending:false}).limit(30);
    if(error)throw fail('No se pudo consultar la cola.',503);
    return {jobs:(data||[]).map(({destination,...x})=>({...x,destination:masked(destination)}))};
  }
  if(action==='admin-pair'){
    const label=trim(req.body?.label,81);
    if(label.length<3||label.length>80)throw fail('Nombre de equipo inválido.');
    const since=new Date(Date.now()-10*60_000).toISOString();
    const {count,error:countError}=await c.from('jaguar_sms_v5_pairings').select('id',{head:true,count:'exact'}).eq('created_by',user.id).gte('created_at',since);
    if(countError)throw fail('No se pudo validar el límite de vinculaciones.',503);
    if(Number(count)>=8)throw fail('Demasiados QR recientes. Intenta más tarde.',429);
    const code=randomBytes(32).toString('base64url');
    const pairing=await one(c,'jaguar_sms_v5_pairings',{label,created_by:user.id,code_hash:hash(code)});
    const payload=JSON.stringify({v:1,server:PUBLIC_ORIGIN,code});
    const qr=await QRCode.toDataURL(payload,{errorCorrectionLevel:'M',width:288,margin:2,color:{dark:'#1B365D',light:'#FFFFFF'}});
    return {qr,expires_at:pairing.expires_at,expires_in:180};
  }
  if(action==='admin-device-state'){
    const id=trim(req.body?.id,60),status=trim(req.body?.status,12);
    if(!uuid.test(id)||!['active','paused','revoked'].includes(status))throw fail('Solicitud inválida.');
    const {data,error}=await c.from('jaguar_sms_v5_devices').select('status').eq('id',id).maybeSingle();
    if(error)throw fail('Error consultando equipo.',503);
    if(!data)throw fail('Equipo no encontrado.',404);
    if(data.status==='revoked')throw fail('Un dispositivo revocado debe vincularse nuevamente.',409);
    const {data:updated,error:ue}=await c.from('jaguar_sms_v5_devices')
      .update({status,revoked_at:status==='revoked'?new Date().toISOString():null})
      .eq('id',id).eq('status',data.status).neq('status','revoked').select('id').maybeSingle();
    if(ue)throw fail('No se pudo actualizar el equipo.',503);
    if(!updated)throw fail('El estado del teléfono cambió. Actualiza la lista y vuelve a intentarlo.',409);
    return {id,status};
  }
  if(action==='admin-device-limit'){
    const id=trim(req.body?.id,60),limit=Number(req.body?.max_per_hour);
    if(!uuid.test(id)||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Límite inválido.');
    const {error}=await c.from('jaguar_sms_v5_devices').update({max_per_hour:limit}).eq('id',id).neq('status','revoked');
    if(error)throw fail('No se pudo guardar el límite.',503);
    return {id,max_per_hour:limit};
  }
  if(action==='admin-test'){
    const only=trim(process.env.JAGUAR_SMS_TEST_NUMBER,32);
    if(!numberPattern.test(only))throw fail('Configura JAGUAR_SMS_TEST_NUMBER en Vercel para realizar pruebas controladas.',503);
    const since=new Date(Date.now()-24*60*60_000).toISOString();
    const {count,error:ce}=await c.from('jaguar_sms_v5_jobs').select('id',{head:true,count:'exact'}).eq('kind','test').gte('created_at',since);
    if(ce)throw fail('No se pudo verificar el límite de pruebas.',503);
    if(Number(count)>=5)throw fail('Límite de cinco SMS de prueba por día alcanzado.',429);
    const row=await one(c,'jaguar_sms_v5_jobs',{
      idem_key:'test-'+randomUUID(),destination:only,kind:'test',
      message:'Notificaciones Jaguar: prueba autorizada de la pasarela SMS. No respondas.'
    });
    return {job_id:row.id,recipient:masked(only)};
  }
  throw fail('Acción técnica desconocida.',404);
}

export async function smsGateway(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});
  const action=String(req.query?.action||new URL(req.url,'https://localhost').searchParams.get('action')||'');
  try{
    const c=db();
    if(action.startsWith('admin-'))return res.status(200).json({ok:true,...await adminAction(req,c,action)});
    if(action==='pair'){
      const code=String(req.body?.code||'');
      if(!tokenPattern.test(code))throw fail('QR inválido o incompleto.');
      const token=randomBytes(32).toString('base64url');
      const {data,error}=await c.rpc('jaguar_sms_v5_redeem',{p_hash:hash(code),p_token_hash:hash(token)});
      if(error)throw fail('No se pudo completar la vinculación.',503);
      if(!data)throw fail('QR vencido o ya utilizado.',409);
      return res.status(200).json({ok:true,device:data,token}); // única vez; cliente guarda cifrado
    }
    const d=await device(req,c);
    if(action==='health'||action==='heartbeat'||action==='poll'){
      const data={last_seen_at:new Date().toISOString()};
      if(action==='heartbeat'||action==='poll'){
        const info=req.body||{};
        const b=info.battery,s=info.signal;
        if(Number.isInteger(b)&&b>=0&&b<=100)data.battery_percent=b;
        if(Number.isInteger(s)&&s>=0&&s<=4)data.signal_level=s;
        for(const k of ['manufacturer','model','android_version','carrier']){
          const val=trim(info[k],70);if(val)data[k]=val.replace(/[\u0000-\u001f]/g,' ');
        }
      }
      const {error}=await c.from('jaguar_sms_v5_devices').update(data).eq('id',d.id);
      if(error)throw fail('No se pudo actualizar el equipo.',503);
      if(action==='poll'){
        if(d.status==='pending')return res.status(200).json({ok:true,device_id:d.id,job:null,approval_required:true,mode:'v5'});
        const {data:job,error:claimError}=await c.rpc('jaguar_sms_v5_claim',{p_device:d.id});
        if(claimError)throw fail('No se pudo consultar la cola SMS.',503);
        return res.status(200).json({ok:true,device_id:d.id,job:job||null,mode:'v5'});
      }
      return res.status(200).json({ok:true,device_id:d.id,mode:'v5'});
    }
    if(action==='claim'){
      if(d.status!=='active')throw fail('Aprobación técnica pendiente.',403);
      const {data,error}=await c.rpc('jaguar_sms_v5_claim',{p_device:d.id});
      if(error)throw fail('No se pudo consultar la cola SMS.',503);
      return res.status(200).json({ok:true,job:data||null});
    }
    if(action==='report'){
      if(d.status!=='active')throw fail('Dispositivo no habilitado para reportar.',403);
      const id=String(req.body?.id||''),state=String(req.body?.status||'');
      if(!uuid.test(id)||!['submitted','sent','delivered','failed','uncertain'].includes(state))throw fail('Reporte no válido.');
      const {data,error}=await c.rpc('jaguar_sms_v5_report',{p_device:d.id,p_job:id,p_status:state});
      if(error)throw fail('No se pudo registrar el resultado.',503);
      return res.status(data?200:409).json({ok:!!data,error:data?undefined:'Transición o propietario no válido.'});
    }
    throw fail('Acción no reconocida.',404);
  }catch(e){
    return res.status(e.status||500).json({ok:false,error:e.status?e.message:'No se pudo procesar la operación.'});
  }
}
