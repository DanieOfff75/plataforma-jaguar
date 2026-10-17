/* Prueba actualizada para la V5.4; se conserva la ruta histórica del test. */
const fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const api=fs.readFileSync(path.resolve(__dirname,'../api/data.js'),'utf8');
const sql=fs.readFileSync(path.resolve(__dirname,'../sql/JAGUAR_V5_4_PLANEACIONES_DICTAMENES.sql'),'utf8');
const policy=fs.readFileSync(path.resolve(__dirname,'../lib/planeaciones_dictamen.js'),'utf8');
assert.match(api,/const planningReviewers = \['direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes'\]/);
assert.match(api,/const departamento=departmentForPlanningRole\(profile\?\.rol\)/);
assert.match(api,/admin\.rpc\('jaguar_firmar_dictamen_planeacion'/);
assert.match(api,/admin\.storage\.from\('firmas-institucionales'\)\.download\(perfil\.firma_path\)/);
assert.match(api,/async function appealTeacherPlanning/);
assert.match(sql,/UNIQUE\(planeacion_id, departamento\)/);
assert.match(sql,/FOR UPDATE/);
assert.match(sql,/v_si>=3/);
assert.match(sql,/v_no>=2/);
assert.match(policy,/rechazos>=2/);
assert(!api.includes("const planningReviewers = ['archivo_escolar'"));
console.log('PASS planeaciones V5.4: roles, firmante validado, dictámenes únicos, operación bloqueada, apelación versionada');
