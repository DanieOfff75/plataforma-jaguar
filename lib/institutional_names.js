/** Nombres institucionales para documentos. No altera registros ni infiere apellidos. */
export function institutionalName(person){
  const raw=typeof person==='string'?person:(person?.nombre_completo||person?.nombre||'');
  return String(raw||'—').replace(/\s+/g,' ').trim()||'—';
}
export function sortInstitutionalPeople(rows){
  return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>
    institutionalName(a).localeCompare(institutionalName(b),'es-MX',{sensitivity:'base',numeric:true}) ||
    String(a?.matricula||'').localeCompare(String(b?.matricula||''),'es-MX')
  );
}
