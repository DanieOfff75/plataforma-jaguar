import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {REQUEST_TYPES,canTransition,canView,canManage,validRequest,ALL_ROLES} from '../lib/jaguar360_rules.js';
const BASE=new URL('../',import.meta.url);
function mockDb({student={id:17,activo:true},rows=[],err=null}={}){
 const calls=[];
 const from=table=>{
  const filters=[];
  const chain={select(){return chain},eq(k,v){filters.push([k,v]);return chain},order(){return chain},limit(){return chain},maybeSingle:async()=>({data:student,error:err}),then(onFulfill,onReject){calls.push({table,filters});return Promise.resolve({data:rows,error:err}).then(onFulfill,onReject)}};
  return chain;
 };
 const db={from,rpc:(name,args)=>{calls.push({rpc:name,args});return Promise.resolve({data:{folio:'J360-2026-ABC',estado:'recibida'},error:null})}};
 return {db,calls};
}
let loadSerial=0;
async function route(){
 let src=fs.readFileSync(new URL('../routes/jaguar360.js',import.meta.url),'utf8');
 src=src.replace("import {requireRoles} from '../lib/_admin.js';","const requireRoles=globalThis.__jaguar360RequireRoles;");
 src=src.replace("from '../lib/jaguar360_rules.js'",`from '${pathToFileURL(new URL('../lib/jaguar360_rules.js',import.meta.url).pathname).href}'`);
 return (await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64')+'#'+(++loadSerial))).default;
}
function res(){return {statusCode:200,headers:{},status(code){this.statusCode=code;return this},setHeader(k,v){this.headers[k]=v;return this},json(body){this.body=body;return this}};}
async function call({role,method='GET',mode='list',body={},db,requests=[]}){
 globalThis.__jaguar360RequireRoles=async()=>({user:{id:'11111111-1111-4111-8111-111111111111'},profile:{rol:role},adminClient:db});
 const h=await route();const response=res();await h({method,query:{mode},body},response);return response;
}
test('los ocho trámites tienen departamentos válidos y no se duplican',()=>{
 assert.equal(REQUEST_TYPES.length,8);
 assert.equal(new Set(REQUEST_TYPES.map(x=>x.id)).size,8);
 assert(REQUEST_TYPES.every(x=>ALL_ROLES.includes(x.dept)));
 assert(validRequest('constancia_estudios','Constancia de estudios',''));
 assert(!validRequest('tipo_inventado','Asunto válido',''));
});
test('solo roles responsables pueden cambiar estados; Dirección supervisa',()=>{
 const r={departamento:'control_escolar',estado:'en_revision',solicitante_id:'student'};
 assert(canManage('control_escolar',r));
 assert(!canManage('direccion_escolar',r));
 assert(!canTransition('servicios_estudiantiles',r,'lista_para_recoger'));
 assert(canTransition('control_escolar',r,'lista_para_recoger'));
 assert(canView('direccion_escolar',r,'any'));
 assert(!canView('docente',r,'any'));
});
test('alumno únicamente puede cancelar solicitud propia en estado permitido',()=>{
 assert(canTransition('alumno',{estado:'recibida',departamento:'archivo_escolar'},'cancelada'));
 assert(!canTransition('alumno',{estado:'entregada',departamento:'archivo_escolar'},'cancelada'));
 assert(!canTransition('alumno',{estado:'recibida',departamento:'archivo_escolar'},'entregada'));
});
test('consulta estudiante restringe por alumno vinculado Y usuario autenticado',async()=>{
 const {db,calls}=mockDb();const r=await call({role:'alumno',db});
 assert.equal(r.statusCode,200);
 const q=calls.find(x=>x.table==='jaguar360_solicitudes');
 assert(q.filters.some(([k,v])=>k==='alumno_id'&&v===17));
 assert(q.filters.some(([k,v])=>k==='solicitante_id'&&v==='11111111-1111-4111-8111-111111111111'));
});
test('un docente no recibe solicitudes de alumnos',async()=>{
 const {db,calls}=mockDb();const r=await call({role:'docente',db});
 assert.equal(r.body.data.rows.length,0);
 assert(!calls.some(x=>x.table==='jaguar360_solicitudes'));
});
test('un departamento no puede leer otra bandeja',async()=>{
 const {db,calls}=mockDb();const r=await call({role:'prefectura',db});
 assert.equal(r.statusCode,200);
 assert(calls.find(x=>x.table==='jaguar360_solicitudes')?.filters.some(([k,v])=>k==='departamento'&&v==='prefectura'));
});
test('docente no puede iniciar solicitudes de alumno',async()=>{
 const {db,calls}=mockDb();const r=await call({role:'docente',method:'POST',body:{action:'create',tipo:'constancia_estudios',asunto:'Constancia de estudios'},db});
 assert.equal(r.statusCode,403);
 assert(!calls.some(x=>x.rpc));
});
test('alumno crea solicitud mediante RPC con identidad derivada de sesión',async()=>{
 const {db,calls}=mockDb();const r=await call({role:'alumno',method:'POST',body:{action:'create',tipo:'constancia_estudios',asunto:'Solicitar constancia',alumno_id:999,departamento:'prefectura'},db});
 assert.equal(r.statusCode,201);
 const rpc=calls.find(x=>x.rpc==='jaguar360_crear_solicitud');
 assert.equal(rpc.args.p_actor,'11111111-1111-4111-8111-111111111111');
 assert(!('p_alumno_id' in rpc.args));
 assert(!('p_departamento' in rpc.args));
});
test('no hay ruta de descarga de documentos privados en el nuevo módulo',()=>{
 const a=fs.readFileSync(new URL('../routes/jaguar360.js',import.meta.url),'utf8');
 const b=fs.readFileSync(new URL('../assets/jaguar360.js',import.meta.url),'utf8');
 assert(!a.includes('createSignedUrl'));
 assert(!a.includes('pdf_base64'));
 assert(!b.includes('downloadPdf('));
});
test('migración protege modificación y deja rastro de auditoría en transacción',()=>{
 const s=fs.readFileSync(new URL('../sql/ITHLA_JAGUAR360_01_SOLICITUDES_PRESENCIALES.sql',import.meta.url),'utf8');
 assert(s.includes('FOR UPDATE'));
 assert(s.includes('jaguar360_solicitud_eventos'));
 assert(s.includes('ENABLE ROW LEVEL SECURITY'));
 assert(s.includes('REVOKE ALL'));
 assert(s.includes('p_actor'));
 assert(!s.includes('CREATE POLICY public_'));
});

test('docente no puede consultar el historial de un trámite estudiantil',async()=>{
 const {db}=mockDb({student:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',departamento:'control_escolar',solicitante_id:'otra-cuenta',alumno_id:17}});
 const handler=await (async()=>{let src=fs.readFileSync(new URL('../routes/jaguar360.js',import.meta.url),'utf8');src=src.replace("import {requireRoles} from '../lib/_admin.js';","const requireRoles=globalThis.__jaguar360RequireRoles;").replace("from '../lib/jaguar360_rules.js'",`from '${new URL('../lib/jaguar360_rules.js',import.meta.url).href}'`);return (await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64')+'#historytest')).default;})();
 globalThis.__jaguar360RequireRoles=async()=>({user:{id:'11111111-1111-4111-8111-111111111111'},profile:{rol:'docente'},adminClient:db});
 const result=res();await handler({method:'GET',query:{mode:'history',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},result);
 assert.equal(result.statusCode,403);
});
test('un alumno con suspensión no puede crear trámites',async()=>{
 const {db,calls}=mockDb({student:{id:17,activo:true,suspension_fecha:'2026-10-28',suspension_hasta:null}});
 const r=await call({role:'alumno',method:'POST',body:{action:'create',tipo:'constancia_estudios',asunto:'Solicitar constancia'},db});
 assert.equal(r.statusCode,403);assert(!calls.some(x=>x.rpc));
});
