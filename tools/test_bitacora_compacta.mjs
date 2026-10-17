import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../lib/jaguar_gradebook_pdf.js',import.meta.url),'utf8');
const helpers=src.slice(src.indexOf('function balancedChunks'),src.indexOf('function clipped'));
const ctx={};vm.runInNewContext(`${helpers}\nthis.chunks=balancedChunks;this.mark=attendanceMark;this.date=compactDate`,ctx);
for(const [count,expected] of [[0,[0]],[1,[1]],[19,[19]],[24,[24]],[25,[13,12]],[39,[20,19]],[41,[21,20]],[49,[17,16,16]],[71,[24,24,23]]]){
  const portions=ctx.chunks([...Array(count).keys()],24).map(x=>x.length);
  assert.deepEqual([...portions],[...expected],`Paginas para ${count}`);
  assert.equal(portions.reduce((a,b)=>a+b,0),count);
  assert.ok(Math.max(...portions)-Math.min(...portions)<=1,`Equilibrio ${count}`);
}
for(const [raw,expected] of [['presente','·'],['Presente','·'],['falta','-'],['f','-'],['retardo','R'],['retardó','R'],['justificado','J'],['justificada','J'],['—',''],['', ''],[undefined,''],['invalido','?']])assert.equal(ctx.mark(raw),expected,`Estado ${raw}`);
assert.equal(ctx.date('2026-09-22'),'22/09/26');
console.log('OK: paginación equilibrada, estados asistencia, fechas.');
