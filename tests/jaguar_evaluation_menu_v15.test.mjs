import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../sistema.html',import.meta.url),'utf8');
const canonical=html.match(/<script id="jaguar-navigation-central-v02133">([\s\S]*?)<\/script>/)?.[1];

test('Dirección conserva acceso a evaluaciones luego de reconstruir el menú',()=>{
 assert.ok(canonical,'No existe la navegación central del sistema');
 const roles=['docente','alumno','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','direccion_escolar','control_escolar','archivo_escolar','recursos_monetarios'];
 const roleNav=Object.fromEntries(roles.map(r=>[r,[['inicio','Inicio']]]));
 const titles={};const controlNav=[['inicio','Inicio']];
 vm.runInNewContext(canonical,{roleNav,titles,controlNav});
 const menu=roleNav.direccion_escolar;
 assert.equal(menu.filter(([id])=>id==='ventanas_evaluacion').length,1,'La opción debe mostrarse exactamente una vez');
 assert.equal(titles.ventanas_evaluacion,'Apertura de evaluaciones');
 assert.ok(menu.some(([id])=>id==='horarios'));
 assert.ok(menu.some(([id])=>id==='planeaciones'));
 assert.ok(menu.some(([id])=>id==='relevos_docentes'));
 assert.equal(roleNav.docente.some(([id])=>id==='ventanas_evaluacion'),false,'El docente no debe tener este control');
 assert.equal(roleNav.alumno.some(([id])=>id==='ventanas_evaluacion'),false,'El alumno no debe tener este control');
});

test('La vista se resuelve para Dirección y exige permisos en API',()=>{
 assert.match(html,/if\(p==='ventanas_evaluacion'&&S\.role==='direccion_escolar'\)return jaguarEvaluationDirectionPage\(\)/);
 assert.match(html,/async function jaguarEvaluationDirectionPage\(\)/);
 assert.match(html,/\/api\/evaluation-window\?action=list/);
 const route=readFileSync(new URL('../routes/evaluation-window.js',import.meta.url),'utf8');
 assert.match(route,/profile\.rol!=='direccion_escolar'/);
 const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(vercel.rewrites.some(r=>r.source==='/api/evaluation-window'&&r.destination.includes('evaluation-window')));
});
