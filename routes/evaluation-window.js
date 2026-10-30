import {requireRoles} from '../lib/_admin.js';
import {evaluationWindow} from '../lib/jaguar_evaluation_window.js';
import {explainEvaluationSaveError} from '../lib/jaguar_evaluation_errors.js';
const roles=['docente','direccion_escolar','coordinacion_academica','servicios_docentes','control_escolar'];
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,roles);
  const action=String((req.method==='GET'?req.query?.action:req.body?.action)||'status');
  if(req.method==='GET'&&action==='list'){
   const {data:periods,error}=await db.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,numero_periodo,fecha_inicio,fecha_fin').order('id',{ascending:false}).limit(80);
   if(error)throw error;
   const ids=(periods||[]).map(p=>p.id);
   let windows=[];
   if(ids.length){const r=await db.from('jaguar_evaluacion_ventanas').select('periodo_id,habilitada,actualizado_at').in('periodo_id',ids);if(r.error)fail('Instala primero el SQL de ventanas de evaluación.',409);windows=r.data||[];}
   const map=new Map(windows.map(w=>[Number(w.periodo_id),w]));
   return res.status(200).json({ok:true,data:(periods||[]).map(p=>({...p,habilitada:Boolean(map.get(Number(p.id))?.habilitada&&p.activo!==false),actualizado_at:map.get(Number(p.id))?.actualizado_at||null}))});
  }
  if(req.method==='GET'&&action==='status'){
   const p=await evaluationWindow(db,req.query?.periodo_id);
   return res.status(200).json({ok:true,data:p});
  }
  if(req.method==='GET'&&action==='attendance_history'){
   if(profile.rol!=='docente')fail('Consulta exclusiva del docente.',403);
   const gm=positive(req.query?.grupo_materia_id),pid=positive(req.query?.periodo_id);
   if(!gm||!pid)fail('Selecciona materia y periodo.');
   const {data:t,error:te}=await db.from('docentes').select('id,activo').eq('auth_user_id',user.id).maybeSingle();if(te)throw te;
   if(!t?.activo)fail('Docente sin asignación activa.',403);
   const {data:period,error:pe}=await db.from('periodos_escolares').select('id,ciclo_escolar,fecha_inicio,fecha_fin,nombre').eq('id',pid).maybeSingle();if(pe)throw pe;
   if(!period)fail('Periodo no encontrado.',404);
   const {data:assignment,error:ae}=await db.from('asignaciones_docentes').select('id').eq('docente_id',t.id).eq('grupo_materia_id',gm).eq('ciclo_escolar',period.ciclo_escolar).eq('activo',true).limit(1);if(ae)throw ae;
   if(!assignment?.length)fail('No tienes esa materia asignada.',403);
   let query=db.from('asistencias').select('fecha,estado').eq('docente_id',t.id).eq('grupo_materia_id',gm);
   if(period.fecha_inicio)query=query.gte('fecha',period.fecha_inicio);
   if(period.fecha_fin)query=query.lte('fecha',period.fecha_fin);
   const {data:rows,error:re}=await query.order('fecha',{ascending:false}).limit(5000);if(re)throw re;
   const dates=new Map();for(const row of rows||[]){const d=dates.get(row.fecha)||{fecha:row.fecha,total:0,presentes:0};d.total++;if(row.estado==='presente')d.presentes++;dates.set(row.fecha,d);}
   return res.status(200).json({ok:true,data:{periodo:period,fechas:[...dates.values()].slice(0,80)}});
  }
  if(req.method==='POST'&&action==='set'){
   if(profile.rol!=='direccion_escolar')fail('Únicamente Dirección Escolar puede abrir o cerrar evaluaciones.',403);
   const origin=String(req.headers?.origin||'');const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'');
   if(!origin||!host||new URL(origin).host!==host)fail('Operación fuera del dominio autorizado.',403);
   if(req.body?.confirmado!==true||typeof req.body?.habilitada!=='boolean')fail('Confirma expresamente la apertura o cierre.');
   const pid=positive(req.body?.periodo_id);const period=await evaluationWindow(db,pid);
   if(period.periodo.activo===false&&req.body.habilitada)fail('No puedes abrir un periodo inactivo.',409);
   const result=await db.rpc('jaguar_abrir_cerrar_evaluacion',{p_periodo_id:pid,p_habilitada:req.body.habilitada,p_actor:user.id});
   if(result.error){
     const issue=explainEvaluationSaveError(result.error);
     console.error('Ventana de evaluación: fallo RPC',{
       code:result.error.code||null,
       message:result.error.message||null,
       details:result.error.details||null,
       hint:result.error.hint||null,
       periodo_id:pid
     });
     return res.status(issue.status).json({ok:false,error:issue.message,code:issue.code});
   }
   // Confirmar la persistencia; no anunciar éxito si Supabase no la refleja.
   const confirmed=await evaluationWindow(db,pid);
   if(confirmed.habilitada!==req.body.habilitada){
     console.error('Ventana de evaluación: estado no confirmado',{periodo_id:pid});
     return res.status(500).json({ok:false,error:'Supabase no confirmó el estado solicitado. Actualiza la pantalla y comprueba el registro del servidor.',code:'EVAL_SIN_CONFIRMAR'});
   }
   return res.status(200).json({ok:true,data:{periodo_id:pid,habilitada:confirmed.habilitada,actualizado_at:confirmed.actualizado_at}});
  }
  return res.status(405).json({ok:false,error:'Método o acción no disponibles.'});
 }catch(e){console.error('Ventana de evaluación:',e?.message);return res.status(e.status||500).json({ok:false,error:e.message||'Error de evaluación.'});}
}
