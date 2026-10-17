const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('node:path').resolve(__dirname,'..');
const source=fs.readFileSync(root+'/index.html','utf8');
const scripts=[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('src='));
const elements=new Map();
const mockElement=(id)=>{
  if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},style:{},setAttribute(){},addEventListener(){},getAttribute(){return ''},focus(){},querySelector(){return null},querySelectorAll(){return []}});
  return elements.get(id);
};
const context=vm.createContext({
  console,Promise,URL,JSON,Math,Set,Map,Array,Date,Number,Intl,String,Error,Uint8Array,TextEncoder,atob,structuredClone,
  window:{addEventListener(){},open(){},location:{href:'http://example.invalid/'}},
  document:{getElementById:mockElement,querySelector(){return null},querySelectorAll(){return []},addEventListener(){},documentElement:{setAttribute(){},getAttribute(){return 'light'},classList:{add(){}}}},
  navigator:{},localStorage:{getItem(){return null},setItem(){}},
  fetch:()=>Promise.reject(Error('offline test')),
  requestAnimationFrame(){},setTimeout(){},clearTimeout(){},
  toast(){},confirm(){return true},prompt(){return 'Revisada'},
  location:{href:'http://example.invalid/'},
});
context.window.window=context.window;
let i=0;
for(const m of scripts){
 let code=m[2].replace(/;initAuth\(\);/,';');
 try{vm.runInContext(code,context,{filename:`index-inline-${i}.js`,timeout:12000})}
 catch(e){console.log('SCRIPT_FAIL',i,e.stack.slice(0,500));process.exit(1)}
 i++;
}
let premium=fs.readFileSync(root+'/assets/jaguar-premium.js','utf8');
vm.runInContext(premium,context,{filename:'jaguar-premium.js'});
// Client role and list routes.
const planning=[
 {id:11,docentes:{nombre_completo:"María D'Ávila <Docente>"},grupo_materias:{grupos:{clave:'1A'},materias:{nombre:'Español'}},tipo:'semanal',fecha_planeada:'2026-10-16',version:1,estado:'enviada',archivo_path:"docente/44/Plan O'Brien.pdf",snapshot:{texto:'Planeación'}},
 {id:12,docentes:{nombre_completo:'Jorge'} ,grupo_materias:{grupos:{clave:'2B'},materias:{nombre:'Inglés'}},tipo:'periodo',version:2,estado:'revisada'}
];
vm.runInContext(`S.role='control_escolar';S.profile={nombre_completo:'Control Escolar',rol:'control_escolar'};S.activeCycle='2026-2027';`,context);
vm.runInContext(`api=async(resource)=>{if(resource==='teacherPlans')return _fixture;return {counts:{},notices:[]}}`,context);
context._fixture=planning;
async function test(){
 const res=await vm.runInContext("pageHtml('planeaciones')",context);
 assert(res.includes('Seguimiento de planeaciones docentes'));
 assert(res.includes('Aprobar y firmar'));
 assert(!res.includes('Cerrar revisión'));
 assert(res.includes('jaguarPlanningPrintFromList(0)'));
 assert(!res.includes('ARCHIVO ESCOLAR'));
 assert(!res.includes('onclick=\'jaguarPlanningPrint({'));
 assert(res.includes('María D&#039;Ávila &lt;Docente&gt;'));
 assert.deepEqual([...vm.runInContext('controlNav',context)].find(x=>x[0]==='planeaciones')?.[0],'planeaciones');
 console.log('PASS Control Escolar routing, navigation and planning list');
 vm.runInContext("S.role='docente';",context);
 const teacher=await vm.runInContext("pageHtml('planeaciones')",context);
 assert(teacher.includes('Nueva planeación'));
 assert(!teacher.includes('Aprobar y firmar'));
 console.log('PASS Teacher role cannot use review UI');
 vm.runInContext("S.role='direccion_escolar';",context);
 const director=await vm.runInContext("pageHtml('planeaciones')",context);
 assert(director.includes('Aprobar y firmar'));
 console.log('PASS Directorate has review access');
 vm.runInContext("S.role='servicios_estudiantiles';",context);
 const forbidden=await vm.runInContext("pageHtml('planeaciones')",context);
 assert(forbidden.includes('No tienes permiso'));
 console.log('PASS Unauthorized roles do not see planning');
 // When opening planeaciones, the page should stay selected and not 'archivo'.
 vm.runInContext("S.role='control_escolar';",context);
 await vm.runInContext("jaguarArchiveOpen('planeaciones')",context);
 assert(vm.runInContext('S.page',context)==='planeaciones');
 assert(mockElement('content').innerHTML.includes('Planeaciones docentes'));
 console.log('PASS planning remains highlighted after interactions');
 // Test Premium degraded mode with rejected dashboard API call.
 vm.runInContext("api=async(resource)=>{if(resource==='dashboard')throw Error('db');return {gradesByBand:[],attendanceMonths:[],byGrade:{},recordedGrades:0,recordedAttendance:0,mean:null,attendanceRate:null}}",context);
 const home=await context.window.jaguarPremiumHome();
 assert(home.includes('j-hero'));
 assert(home.includes('No se pudieron consultar los indicadores institucionales'));
 assert(!home.includes('v22Dashboard'));
 console.log('PASS Premium dashboard when stats API fails');
 // Preview source has correct period ID.
 const fixed=fs.readFileSync(root+'/index.html','utf8');
 assert(fixed.includes("period=el('pl_periodo')"));
 console.log('PASS preview uses proper period selector');
}
test().catch(e=>{console.error(e.stack);process.exit(1)});
