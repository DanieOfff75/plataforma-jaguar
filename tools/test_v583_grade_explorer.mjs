import assert from 'node:assert/strict';
import { academicGradesNavigation, academicGradeDetail, allowGradeExplorer } from '../lib/academic_grade_explorer.js';
import fs from 'node:fs';

class Query {
  constructor(rows){this.rows=rows;this.conds=[];this.mx=Infinity;}
  select(){return this;}
  eq(k,v){this.conds.push([k,v]);return this;}
  order(){return this;}
  limit(n){this.mx=n;return this;}
  filtered(){return this.rows.filter(r=>this.conds.every(([k,v])=>r[k]===v)).slice(0,this.mx);}
  maybeSingle(){return Promise.resolve({data:this.filtered()[0]||null,error:null});}
  then(ok,bad){return Promise.resolve({data:this.filtered(),error:null}).then(ok,bad);}
}
const groups=Array.from({length:18},(_,i)=>({id:i+1,clave:`${Math.floor(i/6)+1}°${'ABCDEF'[i%6]}`,grado:Math.floor(i/6)+1,letra:'ABCDEF'[i%6],turno:i<9?'Matutino':'Vespertino',activo:true}));
const periods=[{id:11,nombre:'Primer periodo',numero_periodo:1,ciclo_escolar:'2026-2027',activo:true},{id:12,nombre:'Segundo periodo',numero_periodo:2,ciclo_escolar:'2026-2027',activo:true}];
const gms=groups.map(g=>({id:g.id+100,grupo_id:g.id,materia_id:301,materias:{id:301,nombre:'Español I, II y III',clave:'ESP'}}));
const students=Array.from({length:39},(_,i)=>({id:i+800,grupo_id:1,matricula:`MAT${i}`,nombre_completo:`ALUMNO ${String(i).padStart(2,'0')}`,activo:true}));
const grades=[{id:500,alumno_id:800,grupo_materia_id:101,periodo_id:11,calificacion:10,calificacion_calculada:10,observaciones:'Excel valor total',detalle_evaluacion:{fuente:'excel_valor_total',valor_total_excel:10,actividades:[{nombre:'Actividades',valor:5,puntos_obtenidos:5,maximo_puntos:5,ponderacion:50,unidad:'puntos_ponderados_excel'},{nombre:'Proyecto',valor:4,puntos_obtenidos:4,maximo_puntos:4,ponderacion:40,unidad:'puntos_ponderados_excel'},{nombre:'Compromiso',valor:1,puntos_obtenidos:1,maximo_puntos:1,ponderacion:10,unidad:'puntos_ponderados_excel'}]}}];
const tables={grupos:groups,periodos_escolares:periods,grupo_materias:gms,alumnos:students,calificaciones:grades};
const db={from:t=>{assert.ok(tables[t],`Unexpected Supabase table ${t}`);return new Query(tables[t]);}};
assert.equal(allowGradeExplorer('docente'),false);
assert.equal(allowGradeExplorer('alumno'),false);
assert.equal(allowGradeExplorer('control_escolar'),true);
assert.equal(allowGradeExplorer('direccion_escolar'),true);
const nav=await academicGradesNavigation(db,'control_escolar');
assert.equal(nav.groups.length,18);assert.equal(nav.subjects.length,18);assert.equal(nav.periods.length,2);
const det=await academicGradeDetail(db,'direccion_escolar',{grupo_id:1,grupo_materia_id:101,periodo_id:11});
assert.equal(det.students.length,39);assert.equal(det.totals.registered,1);assert.equal(det.totals.pending,38);
assert.equal(det.students[0].calificacion,10);assert.equal(det.students[0].valor_total_excel,10);
assert.deepEqual(det.students[0].componentes.map(c=>c.valor),[5,4,1]);
assert.equal(det.students[1].calificacion,null);assert.equal(det.students[1].calificacion_id,null);
await assert.rejects(academicGradeDetail(db,'alumno',{grupo_id:1,grupo_materia_id:101,periodo_id:11}),/no puede consultar/);
await assert.rejects(academicGradeDetail(db,'control_escolar',{grupo_id:1,grupo_materia_id:102,periodo_id:11}),/no corresponde/);
await assert.rejects(academicGradeDetail(db,'control_escolar',{grupo_id:1,grupo_materia_id:101,periodo_id:0}),/Selecciona/);
const root=new URL('../',import.meta.url);
const api=fs.readdirSync(new URL('../api/',import.meta.url)).filter(x=>x.endsWith('.js'));
assert.equal(api.length,10,'No aumentar el numero de funciones Vercel Hobby');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const key of ['jaguarAcademicGradesModule','jaguarGradesOpenGroup','jaguarGradesOpenPeriod','jaguarGradesOpenSubject','jaguarGradesClaimSubmit','jaguarGradesDownloadPdf','createInstitutionalGradeClarification'])assert.ok(html.includes(key)||fs.readFileSync(new URL('../api/data.js',import.meta.url),'utf8').includes(key),key);
console.log('OK: 18 grupos, periodos, materias, 39 alumnos, total Excel, ausentes, roles, validaciones y 10 rutas Hobby');
