import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(ROOT,'assets/jaguar-admissions-director.js'),'utf8');
const nav=source.substring(source.indexOf('/* Jaguar V6.0.2:'));
const controlPath=path.join(ROOT,'centro-control/api/control.js');
const control=fs.existsSync(controlPath)?fs.readFileSync(controlPath,'utf8'):null;
const html=fs.readFileSync(path.join(ROOT,'sistema.html'),'utf8');
test('dirección autenticada accede al módulo sin usar window.S',async()=>{
 let calls=0;
 const sandbox={document:{getElementById(){return null;},addEventListener(){}},setTimeout(){},window:{},fetch:async()=>{calls++;return{ok:true,json:async()=>({ok:true,data:{valor:{estado:'cerrado'}}})}},supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'prueba'}}})}},esc:String,console};
 vm.runInNewContext("const S={role:'direccion_escolar'};"+source+';this.module=jaguarAdmissionDirectorModule;',sandbox);
 const result=await sandbox.module();
 assert.match(result,/Convocatoria institucional/);assert.match(result,/Abrir \/ reabrir/);assert.equal(calls,1);
});
test('otro perfil no accede al módulo',async()=>{
 const sandbox={document:{getElementById(){return null;},addEventListener(){}},setTimeout(){},window:{}};vm.runInNewContext("const S={role:'alumno'};"+source+';this.module=jaguarAdmissionDirectorModule;',sandbox);
 assert.match(await sandbox.module(),/Acceso no permitido/);
});
test('menú director añade opción sin depender de window.roleNav',()=>{
 const inserted=[],doc={getElementById(id){if(id==='app')return null;if(id==='nav')return{querySelector:()=>null,prepend:v=>inserted.push(v)};return null;},addEventListener() {},createElement(){return {dataset:{},className:'',onclick:null,textContent:''}}};
 const roleNav={direccion_escolar:[['inicio','Inicio']]};
 const sandbox={document:doc,setTimeout:fn=>fn(),queueMicrotask,MutationObserver:class{},window:{loadPage(){}},console};
 vm.runInNewContext(`const S={role:'direccion_escolar',page:'inicio'};const roleNav=${JSON.stringify(roleNav)};`+nav,sandbox);
 assert.equal(inserted.length,1);assert.match(inserted[0].textContent,/Admisiones/);
});
test('código del servidor restringe publicación a Dirección y evita sesiones e inscripciones',{skip:!control?'El repositorio Centro de Control se distribuye por separado':false},()=>{
 assert.match(control,/action==='publish-content'/);assert.match(control,/role!=='direccion_escolar'/);
 assert.match(control,/\['institucion','portal','nexo'\]\.includes\(key\)/);
 assert.match(control,/ithla_publicar_contenido_director/);
});
test('sistema conserva módulos y carga la mejora sin quitar la navegación preexistente',()=>{
 assert.match(source,/jaguar-director-navigation|menú de Admisiones|el módulo de Admisiones/);
 assert.match(html,/jaguar-admissions-director\.js/);
 assert.match(html,/page==='calificaciones'/);
 assert.match(html,/admision_control/);
});
