import {gradeRules} from './jaguar360_grade_policy.js';
import {validateCurriculum} from './jaguar_curriculum.js';
/** Motor de reglas puro. No escribe calificaciones ni concede permisos. */
const fail=m=>{throw new Error(m)};
const number=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(label+' fuera de rango.');return v};
const int=(v,min,max,label)=>{number(v,min,max,label);if(!Number.isInteger(v))fail(label+' debe ser entero.');return v};
const choice=(v,a,label)=>{if(!a.includes(v))fail(label+' inválido.');return v};
const bool=(v,label)=>{if(typeof v!=='boolean')fail(label+' debe ser booleano.');return v};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateCycle(c){if(typeof c!=='string'||!/^\d{4}-\d{4}$/.test(c)||Number(c.slice(5))!==Number(c.slice(0,4))+1)fail('Ciclo consecutivo AAAA-AAAA requerido.');return c}
export function validateTemplate(t){if(typeof t!=='string'||t.length<1||t.length>80||!/^[A-Z0-9_{} -]+$/.test(t))fail('Plantilla inválida.');const valid=['TIPO','MATERIA','PERIODO','GRADO','TURNO','CONSECUTIVO','CICLO','LETRA'];const rest=t.replace(/\{([A-Z]+)\}/g,(_,k)=>{if(!valid.includes(k))fail('Variable desconocida: '+k);return ''});if(/[{}]/.test(rest))fail('Llaves inválidas.');if(!t.includes('{'))fail('Incluye variables para identificar grupos.');return t}
function namedTemplate(value,label){
 try{return validateTemplate(value)}catch(error){
  const bad=typeof value==='string'?Array.from(new Set([...value].filter(c=>!/^[A-Z0-9_{} -]$/.test(c)))).slice(0,8):[];
  const detail=typeof value!=='string'?' Se esperaba texto; el campo está ausente o tiene otro tipo.':!value.length?' El campo está vacío.':value.length>80?' Máximo 80 caracteres.':bad.length?' Caracteres no permitidos: '+bad.map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(', ')+'. Usa mayúsculas, números, espacios, guiones y llaves.':'';
  fail(label+': '+error.message+detail);
 }
}
export function groupName(template,values){validateTemplate(template);const v=template.replace(/\{([A-Z]+)\}/g,(_,k)=>{const x=String(values[k]??'');if(!x||!/^[A-Z0-9_-]+$/.test(x))fail('Falta valor válido de '+k);return x});if(v.length>100)fail('Nombre demasiado largo.');return v}
export function validatePolicy(p){
 if(!p||typeof p!=='object'||Array.isArray(p))fail('Política requerida.');
 const periods=int(p.periods,1,6,'Periodos');const minimum=int(p.minimum,1,10,'Mínima');
 const recoveryCap=number(p.recoveryCap,minimum,10,'Máximo de recuperación'),recourseCap=number(p.recourseCap,minimum,10,'Máximo de recursamiento');
 const pointsMode=choice(p.pointsMode,['auto','custom'],'Puntaje');
 const points=pointsMode==='auto'?minimum*periods:number(p.points,1,10*periods,'Puntos');
 return {periods,minimum,recoveryCap,recourseCap,pointsMode,points,
  precision:choice(p.precision??0,[0,1],'Precisión ordinaria'),...gradeRules(p),floor:bool(p.floor,'Piso'),
  pointsSource:choice(p.pointsSource,['original','official'],'Fuente de puntos'),allPeriods:bool(p.allPeriods,'Todos los periodos'),
  attendanceMode:choice(p.attendanceMode,['informative','period','cycle','both'],'Asistencia'),attendancePct:number(p.attendancePct,0,100,'Asistencia mínima'),
  justified:choice(p.justified,['exclude','valid','absent'],'Justificadas'),late:choice(p.late,['present','absent','convert'],'Retardos'),lateRatio:int(p.lateRatio,2,20,'Equivalencia de retardos'),
  attendancePenalty:choice(p.attendancePenalty,['status','fail_floor','fail_cap'],'Consecuencia por periodo'),attendanceVeto:bool(p.attendanceVeto,'Bloqueo por inasistencia'),
  recoveryMethod:choice(p.recoveryMethod,['direct','proportional'],'Recuperación'),recourseMethod:choice(p.recourseMethod,['direct','proportional','qualitative'],'Recursamiento'),
  recourseRecord:choice(p.recourseRecord,['periods','extraordinary'],'Registro recursamiento'),partialBlocks:bool(p.partialBlocks,'Acreditación parcial'),
  preserveDecimals:bool(p.preserveDecimals,'Decimales regularización'),repeatThreshold:number(p.repeatThreshold??50,0,100,'Umbral de repetición'),
  equivalenceSource:choice(p.equivalenceSource??'points',['points','official','original'],'Fuente de equivalencias'),
  absenceRecourse:choice(p.absenceRecourse,['review','exhaust_unjustified'],'Abandono'),
  pendingReenrollment:choice(p.pendingReenrollment,['provisional','wait'],'Reinscripción pendiente'),groupDistribution:choice(p.groupDistribution,['continuity','redistribute'],'Distribución'),
  missedReenrollment:choice(p.missedReenrollment,['review','withdraw_authorized'],'Reinscripción vencida'),externalEntry:choice(p.externalEntry,['allow','beginning'],'Ingreso externo'),
  lateEntry:choice(p.lateEntry,['replicate','mandatory_recovery'],'Ingreso tardío'),scheduleModel:choice(p.scheduleModel,['fixed','flexible'],'Modelo de jornada'),
  scheduleGeneration:choice(p.scheduleGeneration,['manual','automatic','both'],'Generación'),maxStudentGap:int(p.maxStudentGap,0,600,'Hueco máximo alumno'),
  ordinaryTemplate:namedTemplate(p.ordinaryTemplate,'Nombre grupo ordinario'),recoveryTemplate:namedTemplate(p.recoveryTemplate,'Nombre recuperación'),recourseTemplate:namedTemplate(p.recourseTemplate,'Nombre recursamiento')};
}
// Same constraints as a materialized subject; no identity or extra fields accepted into the template.
export function validateCurriculumDefaults(raw,periods){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Configuración general de asignaturas inválida.');
 const checked=validateCurriculum([{...raw,key:'GENERAL',name:'Configuración general',grade:1,legacyId:null}],periods)[0];
 const {key,name,grade,legacyId,...general}=checked;
 return general;
}
export function validatePlan(raw){
 const cycle=validateCycle(raw?.cycle),policy=validatePolicy(raw?.policy);
 if(!Array.isArray(raw?.calendar)||raw.calendar.length!==policy.periods)fail('Define todas las fechas de los periodos.');
 let end='';const calendar=raw.calendar.map((r,i)=>{if(!date(r.start)||!date(r.end)||r.start>r.end||r.start<=end||r.start<cycle.slice(0,4)+'-01-01'||r.end>cycle.slice(5)+'-12-31')fail('Fechas superpuestas o fuera de ciclo en periodo '+(i+1));end=r.end;return {number:i+1,start:r.start,end:r.end}});
 const template=raw.template==null?null:validateTemplateOrigin(raw.template,cycle);
 const curriculum=validateCurriculum(raw.curriculum,policy.periods);
 const general=raw.curriculumDefaults==null?null:validateCurriculumDefaults(raw.curriculumDefaults,policy.periods);
 return {cycle,policy,calendar,template,curriculum,...(general?{curriculumDefaults:general}:{})};
}
export function regularizationGrade(raw,{minimum=6,maximum=7,method='proportional',floor=false}={}){
 number(raw,0,10,'Calificación');number(minimum,1,10,'Mínima');number(maximum,minimum,10,'Máximo');choice(method,['direct','proportional'],'Método');
 if(raw<minimum)return floor?Math.max(raw,minimum-1):raw;
 return method==='direct'?Math.min(raw,maximum):minimum===10?10:minimum+(raw-minimum)*(maximum-minimum)/(10-minimum);
}
export const recoveryGrade=(original,raw,opts)=>Math.max(number(original,0,10,'Nota anterior'),regularizationGrade(raw,opts));
export function attendance({present,absent,justified=0,late=0,unknown=0},policy){
 for(const [k,v] of Object.entries({present,absent,justified,late,unknown}))int(v,0,100000,k);
 const denominator=present+absent+late+(policy.justified==='exclude'?0:justified);
 const lateValid=policy.late==='present'?late:policy.late==='absent'?0:late-Math.floor(late/int(policy.lateRatio,2,20,'Retardos'));
 const valid=present+lateValid+(policy.justified==='valid'?justified:0);
 const [pct,scale]=decimal(number(policy.attendancePct,0,100,'Porcentaje'));
 const divisor=100n*scale;
 const required=Number((BigInt(denominator)*pct+divisor-1n)/divisor);
 return {denominator,valid,required,deficit:Math.max(0,required-valid),rate:denominator?100*valid/denominator:null,complete:unknown===0&&denominator>0,meets:unknown===0&&denominator>0?valid>=required:null};
}
// Evaluate attendance using subject and period-specific minima; cycle minimum applies to the cumulative count.
function attendanceOutcome(periodRows,p,overrides={}){
 let attendanceFailed=[],cumulative=null;
 if(p.attendanceMode!=='informative'){
  if(periodRows.some(r=>!r?.attendance))return null;
  const base=overrides.attendancePct??p.attendancePct;
  const all=periodRows.map((r,i)=>attendance(r.attendance,{...p,attendancePct:overrides.periodAttendancePct?.[i]??base}));
  if(all.some(a=>!a.complete))return null;
  if(['period','both'].includes(p.attendanceMode))attendanceFailed=all.flatMap((a,i)=>a.meets?[]:[i+1]);
  if(['cycle','both'].includes(p.attendanceMode)){
   const totals=Object.fromEntries(['present','absent','justified','late','unknown'].map(k=>[k,periodRows.reduce((n,r)=>n+(r.attendance[k]??0),0)]));cumulative=attendance(totals,{...p,attendancePct:base});
  }
 }
 const absence=attendanceFailed.length>0||cumulative?.meets===false;
 const blocked=absence&&(p.attendanceVeto||p.attendanceMode==='cycle'||p.attendanceMode==='both');
 return {attendanceFailed,cumulative,blocked};
}
export function accreditation(periodRows,p,overrides={}){
 p=validatePolicy(p);if(!Array.isArray(periodRows)||periodRows.length!==p.periods)return {state:'pending'};
 if(periodRows.some(r=>r==null||r.original==null||r.official==null))return {state:'pending'};
 const notes=periodRows.map(r=>number(r[p.pointsSource],0,10,'Nota'));
 const points=notes.reduce((a,b)=>a+b,0),failed=notes.flatMap((n,i)=>n<p.minimum?[i+1]:[]);
 const a=attendanceOutcome(periodRows,p,overrides);if(!a)return {state:'pending'};
 const academic=decimalSumAtLeast(notes,p.points)&&(!p.allPeriods||failed.length===0);
 return {state:academic&&!a.blocked?'accredited':'candidate',points,required:p.points,failed,attendanceFailed:a.attendanceFailed,cumulative:a.cumulative,reason:!academic&&a.blocked?'mixed':a.blocked?'attendance':!academic?'academic':null,notesPreserved:true};
}
/** Simulation against a specific proposed curriculum, without inventing missing period obligations. */
export function curriculumAccreditation(raw,subjectKey,periodRows,{final=null}={}){
 const plan=validatePlan(raw),subject=plan.curriculum.find(r=>r.key===subjectKey);if(!subject)fail('Asignatura no encontrada en esta versión.');
 const p=plan.policy;
 if(subject.evaluation==='no_aplica')return {state:'not_applicable',required:false,subjectKey};
 const extra={subjectKey,required:subject.required};
 if(subject.evaluation==='numerica')return {...accreditation(periodRows,p,subject),...extra};
 if(!Array.isArray(periodRows)||periodRows.length!==p.periods)return {state:'pending',...extra};
 const result=qualitativeAccreditation(periodRows.map(r=>r?.result),{mode:subject.qualitativeMode,final});if(result==='pending')return {state:'pending',...extra};
 const a=attendanceOutcome(periodRows,p,subject);if(!a)return {state:'pending',...extra};
 const academic=result==='accredited';return {state:academic&&!a.blocked?'accredited':'candidate',reason:!academic&&a.blocked?'mixed':a.blocked?'attendance':!academic?'academic':null,attendanceFailed:a.attendanceFailed,cumulative:a.cumulative,notesPreserved:true,...extra};
}
export function promotion(subjects){return Array.isArray(subjects)&&subjects.length>0&&subjects.every(s=>s.state==='accredited')?'eligible':'blocked'}
export function closureChecklist(obligations,{rosterVerified=false,sessionsVerified=false}={}){
 if(!Array.isArray(obligations))fail('Obligaciones requeridas.');const ids=new Set();let missingGrade=0,missingAttendance=0;
 for(const o of obligations){if(!o||typeof o.key!=='string'||ids.has(o.key))fail('Obligación duplicada o inválida.');ids.add(o.key);if(!o.gradeComplete&&!o.exceptionAuthorized)missingGrade++;if(!o.attendanceComplete&&!o.attendanceExceptionAuthorized)missingAttendance++}
 return {total:obligations.length,missingGrade,missingAttendance,ready:rosterVerified&&sessionsVerified&&obligations.length>0&&!missingGrade&&!missingAttendance};
}
/** AP/RP no se traduce a números ni participa en sumas. */
export function qualitativeAccreditation(results,{mode='all',final=null}={}){
 if(!Array.isArray(results)||!results.length||results.some(r=>r==null))return 'pending';
 results.forEach(r=>choice(r,['AP','RP'],'Resultado cualitativo'));
 choice(mode,['all','final'],'Acreditación cualitativa');
 if(mode==='final'){if(final==null)return 'pending';return choice(final,['AP','RP'],'Resultado final')==='AP'?'accredited':'candidate'}
 return results.every(r=>r==='AP')?'accredited':'candidate';
}
/** No crea notas ni asistencias anteriores; devuelve obligaciones propuestas. */
export function lateEntryPlan({periods,entry,minimum,method,firstGrade=null,qualitative=false}){
 int(periods,1,6,'Periodos');int(entry,1,periods,'Ingreso');number(minimum,1,10,'Mínima');choice(method,['replicate','mandatory_recovery'],'Método');
 if(firstGrade!==null){if(qualitative)choice(firstGrade,['AP','RP'],'Resultado');else number(firstGrade,0,10,'Nota')}
 return Array.from({length:entry-1},(_,i)=>({period:i+1,source:'late_entry',attendanceApplicable:false,grade:method==='replicate'?firstGrade:qualitative?'RP':minimum-1,mandatoryRecovery:method==='mandatory_recovery',requiresValidation:true}));
}
/** Solo genera una propuesta; Coordinación autoriza los bloques y casos especiales. */
export function proposeBlocks(result,periodCount){
 int(periodCount,1,6,'Periodos');if(result?.state!=='candidate')return {blocks:[],review:false};
 const requested=[...(result.failed||[]),...(result.attendanceFailed||[])];
 requested.forEach(n=>int(n,1,periodCount,'Bloque'));
 return {blocks:[...new Set(requested)].sort((a,b)=>a-b),review:result.reason==='attendance'||result.reason==='mixed'||!requested.length};
}
/** La exclusión de titulares opera por persona, no por nombre ni cuenta de sesión. */
export function eligibleSupportTeachers(candidates,{subjectId,excludedTeacherIds=[],requiredSlots=[],hours=0}){
 if(!Array.isArray(candidates)||subjectId==null||!Array.isArray(requiredSlots))fail('Asignación inválida.');number(hours,0,1000,'Carga');
 const excluded=new Set(excludedTeacherIds.map(String));
 return candidates.filter(c=>c.active===true&&c.validated===true&&c.volunteer===true&&!excluded.has(String(c.id))&&Array.isArray(c.subjectIds)&&c.subjectIds.map(String).includes(String(subjectId))&&Array.isArray(c.availableSlots)&&requiredSlots.every(s=>c.availableSlots.includes(s))&&Array.isArray(c.busySlots)&&requiredSlots.every(s=>!c.busySlots.includes(s))&&Number.isFinite(c.assignedHours)&&Number.isFinite(c.maxHours)&&c.assignedHours+hours<=c.maxHours);
}
/** Sesiones con minutos reales. Solo análisis, no optimización ni publicación. */
export function teacherDay(sessions,{maxSpan,maxTeaching,maxGap,minBreak=0,maxConsecutive=Infinity}={}){
 if(!Array.isArray(sessions))fail('Sesiones inválidas.');
 const sorted=sessions.map(s=>{int(s.start,0,1439,'Inicio');int(s.end,s.start+1,1440,'Fin');return s}).sort((a,b)=>a.start-b.start);
 let overlap=false,teaching=0,gaps=0,largestGap=0,consecutive=0,longest=0;
 for(let i=0;i<sorted.length;i++){const s=sorted[i],prev=sorted[i-1],gap=prev?s.start-prev.end:0;if(gap<0)overlap=true;if(gap>0){gaps+=gap;largestGap=Math.max(largestGap,gap)}if(i&&gap>=minBreak&&gap>0)consecutive=0;const duration=s.end-s.start;if(s.type==='class'){teaching+=duration;consecutive+=duration;longest=Math.max(longest,consecutive)}else if(s.type==='break'&&duration>=minBreak)consecutive=0;}
 const span=sorted.length?Math.max(...sorted.map(s=>s.end))-sorted[0].start:0;
 return {span,teaching,gaps,largestGap,longest,overlap,violations:[...(overlap?['overlap']:[]),...(span>maxSpan?['span']:[]),...(teaching>maxTeaching?['teaching']:[]),...(largestGap>maxGap?['gap']:[]),...(longest>maxConsecutive?['consecutive']:[])]};
}

/** Decimal exacto para comparar entradas numéricas finitas (sin tolerancias que aprueben por redondeo). */
function decimal(n){
 const [mantissa,exp='0']=String(n).toLowerCase().split('e');
 const [whole,fraction='']=mantissa.split('.');
 const digits=BigInt(whole+fraction), shift=Number(exp)-fraction.length;
 return shift>=0?[digits*10n**BigInt(shift),1n]:[digits,10n**BigInt(-shift)];
}
function decimalSumAtLeast(values,threshold){
 const parts=[...values,threshold].map(decimal),scale=parts.reduce((a,[,b])=>a>b?a:b,1n);
 const target=parts.pop();
 return parts.reduce((a,[n,d])=>a+n*(scale/d),0n)>=target[0]*(scale/target[1]);
}
/** Solo pronóstico: no crea inscripción ni cambia grado. Nunca decide con adeudos sin resolver. */
export function repetitionDecision(subjects,policy,{regularizationFinished=false}={}){
 if(!Array.isArray(subjects)||!subjects.length)return {state:'pending'};
 const seen=new Set(),required=[];
 for(const s of subjects){
  if(!s||typeof s.key!=='string'||!s.key.trim()||seen.has(s.key)||typeof s.required!=='boolean')fail('Asignatura inválida o duplicada.');
  seen.add(s.key);if(s.required){choice(s.state,['accredited','candidate','pending'],'Acreditación');required.push(s);}
 }
 if(!required.length||required.some(s=>s.state==='pending'))return {state:'pending'};
 const total=required.length,passed=required.filter(s=>s.state==='accredited').length,threshold=number(policy.repeatThreshold??50,0,100,'Umbral');
 const base={total,passed,threshold,percentage:100*passed/total};
 if(passed===total)return {...base,state:'promote'};
 if(regularizationFinished!==true)return {...base,state:'await_regularization'};
 const [n,d]=decimal(threshold),full=BigInt(passed)*100n*d<BigInt(total)*n;
 return {...base,state:full?'repeat_grade':'repeat_subjects',subjects:required.filter(s=>full||s.state!=='accredited').map(s=>s.key),historyPreserved:true};
}
/** Equivalencia propuesta; conserva fuente de cada nota y fracción decimal exacta. */
export function unifiedGrade(rows,policy){
 const p=validatePolicy(policy),source=p.equivalenceSource==='points'?p.pointsSource:p.equivalenceSource;
 if(!Array.isArray(rows)||rows.length<2||rows.length>100)fail('Se requieren entre 2 y 100 materias de origen.');
 const seen=new Set();let period=null;
 for(const r of rows){if(!r||typeof r.key!=='string'||!r.key.trim()||seen.has(r.key)||!Number.isInteger(r.period)||r.period<1||r.period>6)fail('Origen inválido o repetido.');seen.add(r.key);period??=r.period;if(r.period!==period)fail('Los periodos de origen no son equivalentes.');}
 if(rows.some(r=>r.type!=='numeric'||r[source]==null))return {state:'review',reason:'missing_or_non_numeric',source};
 const origins=rows.map(r=>({key:r.key,period:r.period,original:r.original==null?null:number(r.original,0,10,'Nota original'),official:r.official==null?null:number(r.official,0,10,'Nota oficial'),used:number(r[source],0,10,'Nota de origen')}));
 const parts=origins.map(r=>decimal(r.used)),scale=parts.reduce((a,[,b])=>a>b?a:b,1n);
 const numerator=parts.reduce((a,[n,d])=>a+n*(scale/d),0n),denominator=scale*BigInt(parts.length);
 return {state:'proposed',source,period,origins,exact:{numerator:String(numerator),denominator:String(denominator)},mean:origins.reduce((a,r)=>a+r.used,0)/origins.length,requiresAuthorization:true};
}
export function validateTemplateOrigin(origin,target){
 const cycle=validateCycle(origin?.cycle);if(cycle>=validateCycle(target))fail('La plantilla debe pertenecer a un ciclo anterior.');
 return {cycle,version:int(origin.version,1,2147483647,'Versión de plantilla')};
}
/** Copia solo criterios de una versión autorizada. No traslada fechas, identidad, notas ni asistencias. */
export function draftFromTemplate(row,target){
 if(row?.estado!=='validada_para_planificacion')fail('La plantilla requiere una versión validada.');
 const template=validateTemplateOrigin({cycle:row.ciclo,version:row.version},target),source=validatePlan(row.plan);
 if(source.cycle!==template.cycle)fail('Plantilla inconsistente.');
 return {cycle:target,template,curriculum:source.curriculum,...(source.curriculumDefaults?{curriculumDefaults:source.curriculumDefaults}:{}),policy:{...source.policy,scheduleModel:''},calendar:Array.from({length:source.policy.periods},()=>({start:'',end:''}))};
}
