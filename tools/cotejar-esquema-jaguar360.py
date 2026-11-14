#!/usr/bin/env python3
"""Static inventory against SQL Editor export. Does not connect or print definitions/data."""
import argparse,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def parse_export(filename):
    raw=Path(filename).read_text(encoding='utf-8-sig').strip()
    try:
        result=json.loads(raw)
    except ValueError:
        # SQL Editor markdown table: reverse ONLY markdown escape of pipe/backslash.
        raw=raw[raw.index('{'):raw.rindex('}')+1]
        try: result=json.loads(raw)
        except ValueError: result=json.loads(re.sub(r'\\([\\|])',r'\1',raw))
    if isinstance(result,list) and len(result)==1: result=result[0]
    if 'esquema_jaguar360' in result: result=result['esquema_jaguar360']
    if isinstance(result,str): result=json.loads(result)
    assert isinstance(result,dict) and all(isinstance(result.get(k),list) for k in ('relations','columns','functions','policies','triggers','constraints','indexes','sequences','views')),'Export incompleto'
    return result

def analyze(j):
    plan=json.loads((ROOT/'sql/JAGUAR360_ORDEN_CLON.json').read_text())
    source='\n'.join((ROOT/x).read_text() for x in plan['migrations'])
    base={r['relname'] for r in j['relations']}; funcs={f['proname'] for f in j['functions']}
    created=set(re.findall(r'CREATE TABLE IF NOT EXISTS public\.(\w+)',source,re.I)); made_funcs=set(re.findall(r'CREATE OR REPLACE FUNCTION public\.(\w+)',source,re.I))
    refs=set(re.findall(r'\b(?:FROM|JOIN|UPDATE|INTO|TABLE|REFERENCES|ON)\s+public\.(\w+)',source,re.I));
    called=set(re.findall(r'\bpublic\.(\w+)\s*\(',source,re.I))
    missing_calls=sorted(called-base-created-funcs-made_funcs)
    columns={}
    for r in j['columns']: columns.setdefault(r['relname'],set()).add(r['attname'])
    expected={'aspirantes':{'id','estado','numero_matricula','fecha_resolucion','curp','calificacion_examen','puntaje_minimo_examen','examen_presentado_fecha','examen_calificado_por','examen_observaciones','notificacion_email_enviada','notificacion_email_fecha','notificacion_email_error','motivo_rechazo','resuelto_por'},'ithla_centro_operadores':{'usuario_id','rol','activo'},'ithla_sesiones':{'id','usuario_id','aplicacion','perfil','ultimo_uso','vence_absoluto','revocada_en'},'ithla_inscripciones_pendientes':{'aspirante_id','aceptado_en','matriculado_en','confirmado_por','documentos_confirmados_en'},'configuracion_admision':{'clave','valor'},'ithla_auditoria':{'accion','actor','clave','anterior','posterior'},'ithla_config':{'clave','valor','revision'},'alumnos':{'id','matricula','curp','activo','estado_escolar','grupo_id'},'grupos':{'id','activo'},'perfiles':{'id','rol','activo','correo'}}
    missing_fields=sorted(f'{t}.{x}' for t,cols in expected.items() for x in cols-columns.get(t,set()))
    return {'server_version':j.get('server_version'),'tables':sum(r['relkind'] in ('r','p') for r in j['relations']),'sequences':len(j['sequences']),'views':len(j['views']),'columns':len(j['columns']),'functions':len(j['functions']),'policies':len(j['policies']),'triggers':len(j['triggers']),'constraints':len(j['constraints']),'indexes':len(j['indexes']), 'tables_without_rls':sorted(r['relname'] for r in j['relations'] if r['relkind'] in ('r','p') and not r['relrowsecurity']), 'migration_count':len(plan['migrations']),'new_tables_declared':len(created),'new_table_name_collisions':sorted(created&base),'literal_public_relation_references_unmatched':sorted(refs-base-created-funcs-made_funcs),'unmatched_literal_public_calls':missing_calls,'existing_function_names_replaced':sorted(made_funcs&funcs),'missing_v34_base_columns':missing_fields,'auth_foreign_keys':sum('REFERENCES auth.' in x['definition'] for x in j['constraints']),'limitations':'Static text match only. No execution, no validation of auth/storage schemas, data, SQL semantics, order, RLS behavior or effective ACL.'}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('export'); args=parser.parse_args();r=analyze(parse_export(args.export));print(json.dumps(r,indent=2,ensure_ascii=False));raise SystemExit(1 if r['literal_public_relation_references_unmatched'] or r['unmatched_literal_public_calls'] or r['missing_v34_base_columns'] or r['new_table_name_collisions'] else 0)
