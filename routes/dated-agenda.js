const roles=new Set(['alumno','docente','direccion_escolar','coordinacion_academica','control_escolar','control']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
export function validateAgendaRange(q){
 if(!date(q.from)||!date(q.to)||q.to<q.from||Date.parse(q.to)-Date.parse(q.from)>30*86400000)throw fail('Selecciona un intervalo válido de hasta 31 días.');
 return {p_desde:q.from,p_hasta:q.to};
}
export async function datedAgenda(req,res,{user,profile,adminClient:db}){
 if(req.query?.mode!=='dated_agenda')return false;
 if(req.method!=='GET')throw fail('Método no permitido.',405);
 if(!roles.has(profile.rol))throw fail('Sin atribución.',403);
 const args=validateAgendaRange(req.query);
 const {data,error}=await db.rpc('jaguar360_agenda_fechada',{p_actor:user.id,...args});
 if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'La agenda fechada no está disponible.',error.code==='42501'?403:error.code==='P0001'?409:503);
 if(!data||!Array.isArray(data.coverage)||!Array.isArray(data.sessions))throw fail('Respuesta de agenda incompleta.',503);
 res.status(200).json({ok:true,data});return true;
}
