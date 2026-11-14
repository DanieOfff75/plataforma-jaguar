import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {assertInstitutionalAccess,sessionStatus} from '../lib/ithla_session.js';
import {requireLegacyReportCompatible} from '../lib/jaguar360_report_guard.js';
import {institutionalPlanning} from '../routes/institution-planning.js';
const record=(data,error=null)=>({from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data,error}}}}});
test('baja, traslado y archivo no crean acceso escolar; ausencia y fallo de catálogo se rechazan',async()=>{
 for(const estado_escolar of ['baja','traslado','archivado'])await assert.rejects(assertInstitutionalAccess(record({activo:true,estado_escolar}),'U','alumno','jaguar'),e=>e.status===403);
 await assert.rejects(assertInstitutionalAccess(record(null),'U','alumno','jaguar'),e=>e.status===403);
 await assert.rejects(assertInstitutionalAccess(record(null,{}),'U','alumno','jaguar'),e=>e.status===503);
 await assertInstitutionalAccess(record({activo:true,estado_escolar:'suspendido'}),'U','alumno','jaguar');
 await assertInstitutionalAccess(record({activo:false,estado_escolar:'egresado'}),'U','alumno','jaguar');
});
test('docente inactivo no abre sesión, otras aplicaciones no reciben un permiso Jaguar',async()=>{
 await assert.rejects(assertInstitutionalAccess(record({activo:false,estado_profesional:'activo'}),'U','docente','jaguar'),e=>e.status===403);
 await assert.rejects(assertInstitutionalAccess(record({activo:true,estado_profesional:'baja'}),'U','docente','jaguar'),e=>e.status===403);
 await assertInstitutionalAccess(record({activo:true,estado_profesional:'activo'}),'U','docente','jaguar');
 await assertInstitutionalAccess({},'U','aspirante','admisiones');
});
test('la sesión exacta no puede reutilizarse con otro departamento de la misma clase administrativa',async()=>{
 const sid='11111111-2222-4333-8444-555555555555',row={id:sid,usuario_id:'U',aplicacion:'jaguar',rol_activo:'prefectura',ultimo_uso:new Date().toISOString(),vence_absoluto:new Date(Date.now()+3600000).toISOString()};
 const db={from(t){if(t==='ithla_config')return{select(){return this},eq(){return this},async single(){return{data:{valor:{}}}}};const filters=[];return{select(){return this},eq(k,v){filters.push([k,v]);return this},is(){return this},async maybeSingle(){return{data:filters.every(([k,v])=>row[k]===v)?row:null}}}}};
 assert.ok((await sessionStatus({headers:{'x-ithla-session':sid}},db,'U','prefectura','jaguar')).remaining_seconds>0);
 await assert.rejects(sessionStatus({headers:{'x-ithla-session':sid}},db,'U','coordinacion_academica','jaguar'),e=>e.status===401);
});
test('boleta antigua bloqueada por evidencia nueva y falla cerrada si no hay comprobación',async()=>{
 const db=d=>({rpc:async(n,args)=>{assert.equal(n,'jaguar360_boleta_bloqueos');assert.deepEqual(args,{p_alumno:'42',p_ciclo:'2027-2028'});return d;}});
 await requireLegacyReportCompatible(db({data:{allowed:true,reasons:[]}}),42,'2027-2028');
 for(const reason of ['rectificacion','recuperacion','recursamiento','asistencia_por_sesion','evaluacion_cualitativa','sin_grupo_vigente'])await assert.rejects(requireLegacyReportCompatible(db({data:{allowed:false,reasons:[reason]}}),42,'2027-2028'),e=>e.status===409);
 await assert.rejects(requireLegacyReportCompatible(db({data:null,error:{}}),42,'2027-2028'),e=>e.status===503);
});
test('publicación inicial: consulta de Coordinación, ejecución solo Dirección con huella y entorno de prueba',async()=>{
 const old=process.env.JAGUAR360_TEST_SEALS;const calls=[];const auth={user:{id:'real'},profile:{rol:'coordinacion_academica'},adminClient:{rpc:async(n,args)=>{calls.push([n,args]);return {data:{ready:true,cycle:'2027-2028'}}}}};
 const res=()=>({status(){return this},json(){return this}});const req={method:'POST',headers:{host:'j.test',origin:'https://j.test'},body:{action:'ordinary_schedule',operation:'publish',cycle:'2027-2028',confirmed:true,fingerprint:'a'.repeat(32),reference:'OFICIO-001',reason:'Publicación inicial con revisión independiente',actor:'fake',slots:[]}};
 try{delete process.env.JAGUAR360_TEST_SEALS;await institutionalPlanning({method:'GET',query:{view:'schedule_publication',cycle:'2027-2028'}},res(),auth);assert.equal(calls[0][0],'jaguar360_publicar_horario');await assert.rejects(institutionalPlanning(req,res(),{...auth,profile:{rol:'direccion_escolar'}}),e=>e.status===409);process.env.JAGUAR360_TEST_SEALS='true';await assert.rejects(institutionalPlanning(req,res(),auth),e=>e.status===403);await assert.rejects(institutionalPlanning({...req,headers:{host:'j.test',origin:'https://bad.test'}},res(),{...auth,profile:{rol:'direccion_escolar'}}),e=>e.status===403);await institutionalPlanning(req,res(),{...auth,profile:{rol:'direccion_escolar'}});assert.equal(calls[1][1].p_actor,'real');assert.equal(calls[1][1].p_huella,'a'.repeat(32));assert.equal(calls[1][1].slots,undefined);}finally{if(old===undefined)delete process.env.JAGUAR360_TEST_SEALS;else process.env.JAGUAR360_TEST_SEALS=old;}
});
test('contratos SQL protegen publicación inicial y tabla de horarios, revocan todas las aplicaciones y bloquean boletas',()=>{
 const s=fs.readFileSync(new URL('../sql/ITHLA_JAGUAR_360_PUBLICACION_HORARIOS_V26.sql',import.meta.url),'utf8');for(const x of ['b.cupo','slots IS DISTINCT FROM firstslots','SHARE ROW EXCLUSIVE MODE NOWAIT','r.actor<>p.actor','INSERT INTO public.horarios','INSERT INTO public.jaguar360_horarios_publicados','BEFORE INSERT OR UPDATE OR DELETE ON public.horarios',"tipo_espacio='aula'"])assert.ok(s.includes(x),x);assert.doesNotMatch(s,/DELETE FROM public\.horarios|UPDATE public\.calificaciones/i);
 const g=fs.readFileSync(new URL('../sql/ITHLA_JAGUAR_360_SEGURIDAD_DOCUMENTOS_V26.sql',import.meta.url),'utf8');for(const x of ['ADD COLUMN IF NOT EXISTS rol_activo','AFTER UPDATE OF rol,activo ON public.perfiles','AFTER UPDATE OF estado_profesional','AFTER UPDATE OF estado_escolar','WHERE usuario_id IN (uid,olduid)','BEFORE INSERT ON public.documentos_verificables','GRANT EXECUTE ON FUNCTION public.jaguar360_boleta_bloqueos'])assert.ok(g.includes(x),x);
});

test('API central exige sesión protegida y el navegador no transmite identificador a otro origen',()=>{
 const api=fs.readFileSync(new URL('../api/data.js',import.meta.url),'utf8');const client=fs.readFileSync(new URL('../assets/jaguar-session-guard.js',import.meta.url),'utf8');const auth=fs.readFileSync(new URL('../api/auth.js',import.meta.url),'utf8');
 assert.match(api,/async function authContext\(req\)[\s\S]*?await assertSession\(req,adminClient,user.id,profile.rol,'jaguar'\)/);assert.match(client,/target.origin!==location.origin/);assert.match(auth,/await assertSession\(req,adminClient,user.id,profile.rol,'jaguar'\);\n  \/\/ Impedir que first_access/);
});
