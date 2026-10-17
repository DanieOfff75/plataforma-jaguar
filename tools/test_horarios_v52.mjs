import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const reports=readFileSync(new URL('../api/reports.js',import.meta.url),'utf8');
const data=readFileSync(new URL('../api/data.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=(name)=>{
  const beginning=reports.indexOf(`function ${name}(`);
  assert(beginning>=0,`${name} existe`);
  const open=reports.indexOf('{',beginning);
  let level=0,i=open;
  for(;i<reports.length;i++){
    if(reports[i]==='{')level++;
    if(reports[i]==='}') {level--;if(level===0)break;}
  }
  return reports.slice(beginning,i+1);
};
const input=grab('getSlots')+'\ngetSlots';
const getSlots=vm.runInNewContext(input,{});
const rows=[
 {hora_inicio:'07:00:00',hora_fin:'08:00:00'},
 {hora_inicio:'10:45:00',hora_fin:'11:35:00'},
 {hora_inicio:'07:00:00',hora_fin:'08:00:00'}
];
assert.deepEqual(Array.from(getSlots(rows,'Matutino')),['07:00|08:00','10:45|11:35']);
assert.equal(getSlots([],'Matutino').length,0);
assert.match(reports,/const primary=teacherMode\?rgb\(\.41,\.31,\.105\):GREEN/);
assert.match(reports,/const stripe=teacherMode\?gold:normColor\(rec.subject_color\)/);
assert.match(reports,/const colorsBySubject=new Map\(\)/);
assert.match(reports,/grupo_materias!inner\(id,grupo_id,materia_id,materias\(nombre\)/);
assert.match(reports,/simultaneous=\[\.\.\.slotGroups.entries\(\)\]/);
assert.match(reports,/pdf.getPageCount\(\)/);
assert.match(reports,/const qr=verification\?\.qrBytes/);
assert.match(reports,/const authorities=teacherMode/);
assert.match(index,/background:rgba\(212,175,55,\.095\)/);
assert.match(index,/r.subject_color/);
assert.match(data,/getGroupSubjectColors\(admin, student.grupo_id\)/);
assert.match(data,/try \{\s*const assignedColors=/);
assert(!reports.includes('materia(s) no mostradas en este resumen'));
console.log('OK: horarios grupo/alumno, docente dorado, materias, horarios extraordinarios, firmas, QR y protección contra omisiones.');
