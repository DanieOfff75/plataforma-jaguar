import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const api=join(root,'api');
const names=(await readdir(api)).filter(n=>/\.(?:js|mjs|ts)$/.test(n));
const config=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));
const original=['academic-tools','classroom','google-classroom','google-oauth','teacher'];
assert.ok(names.length<=12,`Hobby excedido: ${names.length} funciones`);
assert.equal(names.length,10,'10 funciones esperadas en este paquete');
assert.deepEqual(config.rewrites.map(x=>x.source),original.map(x=>`/api/${x}`));
for(const rule of config.rewrites){
 const url=new URL(rule.destination,'https://plataforma-jaguar.vercel.app');
 assert.equal(url.pathname,'/api/router');
 assert.equal(url.searchParams.get('__jaguar_route'),rule.source.replace('/api/',''));
 assert.ok((await stat(join(root,'routes',rule.source.replace('/api/','')+'.js'))).isFile());
}
for(const helper of ['documentos','responsables']){
 assert.ok((await stat(join(root,'lib',helper+'.js'))).isFile());
 assert.equal(names.includes(helper+'.js'),false,'Los helpers no deben desplegarse como endpoints');
}
// Each import with a literal relative specifier must resolve to an actual source file.
const files=[...(await readdir(api)).map(n=>join(api,n)),...(await readdir(join(root,'routes'))).map(n=>join(root,'routes',n)),...(await readdir(join(root,'lib'))).map(n=>join(root,'lib',n))].filter(x=>x.endsWith('.js'));
for(const path of files){
 const source=await readFile(path,'utf8');
 for(const m of source.matchAll(/\b(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
  const target=resolve(dirname(path),m[1]);
  try{assert.ok((await stat(target)).isFile());}
  catch{throw new Error(`Import inválido: ${path}: ${m[1]}`);}
 }
}
// Exercise the dispatcher with test stubs; no network, DB, OAuth tokens or credentials.
const routerSource=await readFile(join(api,'router.js'),'utf8');
let stubCalls=[];
const stubs=Object.fromEntries(original.map(name=>[name,(req,res)=>{
  stubCalls.push({name,method:req.method,body:req.body,action:req.query?.action});
  return res.status(200).json({ok:true,service:name});
}]));
let transformed=routerSource.replace(/^import .*?;$/gm,'').replace('export default async function handler(req,res)','async function handler(req,res)')+'\nhandler;';
const dispatch=vm.runInNewContext(transformed,{
 academicTools:stubs['academic-tools'],classroom:stubs.classroom,googleClassroom:stubs['google-classroom'],googleOAuth:stubs['google-oauth'],teacher:stubs.teacher,Object,String
});
const mockRes=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}});
for(const name of original){
 const r=mockRes();await dispatch({method:'POST',body:{action:'test',value:14},query:{__jaguar_route:name,action:'list'}},r);
 assert.equal(r.statusCode,200);assert.equal(r.body.service,name);
}
const denied=mockRes();await dispatch({query:{__jaguar_route:'nonexistent'}},denied);
assert.equal(denied.statusCode,404);
assert.equal(stubCalls.length,original.length);
console.log(`✓ Vercel Hobby: ${names.length} funciones, ${config.rewrites.length} rutas conservadas, imports válidos y dispatcher probado`);
