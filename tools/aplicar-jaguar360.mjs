#!/usr/bin/env node
/* Jaguar 360: verificador/instalador sin sobreescritura accidental.
   Uso: node tools/aplicar-jaguar360.mjs /ruta/a/plataforma-jaguar --verificar
        node tools/aplicar-jaguar360.mjs /ruta/a/plataforma-jaguar --aplicar
*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=["sistema.html", "api/router.js", "vercel.json", "lib/nexo_knowledge.js", "routes/jaguar360.js", "lib/jaguar360_rules.js", "assets/jaguar360.js", "assets/jaguar360.css", "sql/ITHLA_JAGUAR360_01_SOLICITUDES_PRESENCIALES.sql", "tests/jaguar360.test.mjs"];
const baseline={"sistema.html": "80a47b93a09030ae1e0ea05d4e36e82b1cee8a5eb9b72a38993b92ccdb0c01b3", "api/router.js": "a0a9b861041ce3575eba2c61c5cd1ee5b51d17e78600286d80bfbb16df386f7e", "vercel.json": "e3be07c073707c51fee9d1fdc9d4fc8b9e27dcba07f4d2955bbf82a90dd9cd82", "lib/nexo_knowledge.js": "c26dd5d10f6a96839976790e916238b866e053ac4e3e8528a165500adc737d0f"};
const target=path.resolve(process.argv[2]||'');
const action=process.argv.includes('--aplicar')?'aplicar':'verificar';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(!process.argv[2]||target===sourceRoot||!fs.existsSync(path.join(target,'sistema.html'))||!fs.existsSync(path.join(target,'api','router.js'))){console.error('Indica la ruta de un repositorio Jaguar existente, distinta de la carpeta del parche.');process.exit(2)}
let conflicts=[];let copy=[];let identical=[];
for(const rel of files){
 const from=path.join(sourceRoot,rel),dst=path.join(target,rel);
 const data=fs.readFileSync(from),newHash=hash(data);
 if(!fs.existsSync(dst)){copy.push(rel);continue}
 const actual=hash(fs.readFileSync(dst));
 if(actual===newHash){identical.push(rel);continue}
 if(baseline[rel]&&actual===baseline[rel]){copy.push(rel);continue}
 conflicts.push(rel);
}
console.log(`Jaguar 360 | ${action} | Nuevos/actualizables: ${copy.length} | Iguales: ${identical.length} | Conflictos: ${conflicts.length}`);
for(const rel of conflicts)console.error(`CONFLICTO: ${rel} (tu versión difiere; requiere fusión manual)`);
if(conflicts.length){console.error('Nada fue sobrescrito. No fuerces sustituciones de sistema.html, router, ni Academia.');process.exit(1)}
if(action!=='aplicar'){console.log('Simulación correcta. Repite con --aplicar para instalar.');process.exit(0)}
const backup=path.join(path.dirname(target),'jaguar360-backup-'+Date.now());
for(const rel of copy){
 const from=path.join(sourceRoot,rel),dst=path.join(target,rel);
 if(fs.existsSync(dst)){
  const safe=path.join(backup,rel);fs.mkdirSync(path.dirname(safe),{recursive:true});fs.copyFileSync(dst,safe);
 }
 fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(from,dst);
}
console.log('Archivos instalados. Respaldo de archivos reemplazados:',fs.existsSync(backup)?backup:'No se reemplazó ningún archivo existente.');
console.log('Aplica la migración SQL primero en Supabase de prueba. Después prueba en Vercel Preview.');
