/** Decimal arithmetic for cycle grade rules. No implicit rounding at the pass boundary. */
const fail=m=>{throw Error(m)};
const names=['recovery','recourse'];
const choice=(v,values,label)=>values.includes(v)?v:fail(label+' inválido.');
const digits=v=>Number.isInteger(v)&&v>=0&&v<=12?v:fail('Precisión especial inválida (0–12).');
function ratio(n){
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>10)fail('Nota fuera de rango.');
 const [mantissa,exp='0']=String(n).toLowerCase().split('e');const [whole,decimal='']=mantissa.split('.');
 const shift=Number(exp)-decimal.length;
 const a=BigInt(whole+decimal);return shift>=0?[a*10n**BigInt(shift),1n]:[a,10n**BigInt(-shift)];
}
export function gradeRules(p={}){
 const out={ordinaryRounding:choice(p.ordinaryRounding??'nearest',['nearest','truncate'],'Redondeo ordinario')};
 for(const kind of names){out[kind+'Rounding']=choice(p[kind+'Rounding']??'exact',['exact','truncate','nearest'],kind+' redondeo');out[kind+'Digits']=digits(p[kind+'Digits']??6);}
 return out;
}
function asNumber(a,b){return Number(a)/Number(b);}
function represent(a,b,mode,d){
 if(mode==='exact'){
  for(let i=0,s=1n;i<=12;i++,s*=10n)if(a*s%b===0n)return asNumber(a*s/b,s);
  fail('Fracción no terminante o precisión superior a 12 decimales: se requiere un criterio de precisión autorizado.');
 }
 const s=10n**BigInt(d),q=a*s/b,r=a*s%b;
 return asNumber(q+(mode==='nearest'&&2n*r>=b?1n:0n),s);
}
export function ordinaryGrade(raw,p){
 const [a,b]=ratio(raw),min=p.minimum,places=choice(p.precision??0,[0,1],'Precisión ordinaria');
 if(!Number.isInteger(min)||min<1||min>10)fail('Mínima inválida.');
 const {ordinaryRounding}=gradeRules(p),s=10**places;
 let result=represent(a,b,ordinaryRounding,places);
 if(raw<min){result=Math.min(result,min-1/s);if(p.floor)result=Math.max(result,min-1);}
 return Number(result.toFixed(places));
}
export function specialGrade(raw,{minimum,maximum,method,floor=false,kind,policy={}}){
 choice(kind,names,'Tipo');choice(method,['direct','proportional'],'Escala');
 if(!Number.isInteger(minimum)||minimum<1||minimum>10||maximum<minimum)fail('Escala inválida.');
 const [r,rd]=ratio(raw),[c,cd]=ratio(maximum),rules=gradeRules(policy),mode=rules[kind+'Rounding'],places=rules[kind+'Digits'];
 let a,b;
 if(raw<minimum){[a,b]=ratio(floor?Math.max(raw,minimum-1):raw);}
 else if(method==='direct'||minimum===10){[a,b]=ratio(Math.min(raw,maximum));}
 else {b=rd*cd*BigInt(10-minimum);a=BigInt(minimum)*b+(r-BigInt(minimum)*rd)*(c-BigInt(minimum)*cd);}
 let result=represent(a,b,mode,places);
 // Respect the cap, even when a selected nearest mode would round beyond it.
 if(raw>=minimum){if(result>maximum)result=represent(c,cd,'truncate',places);if(result<minimum)fail('Precisión incompatible con mínima y máximo.');}
 else if(result>=minimum){result=mode==='exact'?raw:minimum-1/10**places;}
 return result;
}
export function previewGradeRules(raw,p){
 const ordinary=ordinaryGrade(raw,p),out={raw,ordinary};
 for(const kind of names){try{out[kind]=specialGrade(raw,{minimum:p.minimum,maximum:p[kind+'Cap'],method:p[kind+'Method'],floor:p.floor,kind,policy:p});}catch(e){out[kind]=null;out[kind+'Review']=e.message;}}
 return out;
}
