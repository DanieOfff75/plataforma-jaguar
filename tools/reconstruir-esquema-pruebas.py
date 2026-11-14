#!/usr/bin/env python3
"""Reconstruye un laboratorio PostgreSQL público SIN datos a partir del export SQL Editor.
No es pg_dump ni réplica de Supabase Auth. Solo para clúster vacío, local, desechable.
"""
import argparse, importlib.util, json, os, re, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('cotejo',Path(__file__).with_name('cotejar-esquema-jaguar360.py'))
cotejo=importlib.util.module_from_spec(spec);spec.loader.exec_module(cotejo)
ROLES={'postgres','anon','authenticated','service_role'}

def q(s):
    if not isinstance(s,str) or not s or '\x00' in s: raise ValueError('Identificador inválido')
    return '"'+s.replace('"','""')+'"'
def table(s): return 'public.'+q(s)
def role(s):
    if s.lower()=='public' or s=='': return 'PUBLIC'
    if s not in ROLES: raise ValueError('Rol no reconstructible: '+s)
    return q(s)

def acl_sql(kind,name,acl):
    if acl is None: raise ValueError('ACL por defecto sin inventario explícito: '+name)
    out=[f'REVOKE ALL PRIVILEGES ON {kind} {name} FROM PUBLIC,anon,authenticated,service_role;']
    maps={'TABLE':dict(zip('arwdDxtm',['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])), 'SEQUENCE':{'r':'SELECT','w':'UPDATE','U':'USAGE'},'FUNCTION':{'X':'EXECUTE'}}
    for item in acl:
        m=re.fullmatch(r'([a-z_]*?)=([a-zA-Z]+)/postgres',item)
        if m is None or m[1] not in ROLES|{''}: raise ValueError('ACL no soportada: '+name)
        gr,perms=m.groups()
        if gr=='postgres': continue
        mapping=maps[kind]
        if set(perms)-mapping.keys():raise ValueError('Privilegio no soportado: '+name)
        privileges='ALL PRIVILEGES' if set(perms)==set(mapping) else ','.join(mapping[x] for x in perms)
        out.append(f'GRANT {privileges} ON {kind} {name} TO {role(gr)};')
    return out

def build(j):
    if not str(j.get('server_version','')).startswith('17.'): raise ValueError('Solo catálogo PostgreSQL 17 revisado')
    relations=j['relations']; columns=j['columns']; functions=j['functions']; sequences=j['sequences']; policies=j['policies']; cons=j['constraints']; triggers=j['triggers']; indexes=j['indexes']; views=j['views']
    if not relations or not columns or not functions or not cons:raise ValueError('Export incompleto')
    if any(r['owner']!='postgres' or r['relkind'] not in ('r','S','v') for r in relations) or any(f['owner']!='postgres' or f['prokind']!='f' or not f['definition'] for f in functions):raise ValueError('Objetos o propietarios no reconstructibles')
    types={r['relname']:r['relkind'] for r in relations}; smap={s['sequencename']:s for s in sequences}
    if len(types)!=len(relations) or len(smap)!=len(sequences):raise ValueError('Objetos repetidos')
    # These are the exact identity sequences in the supplied export. The JSON exporter
    # rounded max_value for bigint; use PostgreSQL's default type maximum, not the rounded value.
    ids={x['relname']+'_'+x['attname']+'_seq':x for x in columns if x['attidentity']}
    if set(smap)!=set(ids) or len(ids)!=sum(bool(x['attidentity']) for x in columns): raise ValueError('Secuencias no asociadas a identidades; requiere pg_dump real')
    for k,s in smap.items():
        if s['sequenceowner']!='postgres' or s['schemaname']!='public' or s['cycle'] or s['start_value']!=1 or s['increment_by']!=1 or s['cache_size']!=1 or s['min_value']!=1 or s['data_type']!=ids[k]['type'] or len(k.encode())>63:raise ValueError('Secuencia no estándar: '+k)
    # Do not include raw credentials if a function export contains them. Review is still mandatory.
    suspect=re.compile(r'(?i)(?:\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sb_secret_|sbp_)[A-Za-z0-9_-]{20,})')
    for f in functions:
        if suspect.search(f['definition']): raise ValueError('Posible credencial en definición '+f['proname']+'; revisa/exporta versión saneada')
    out=['-- LABORATORIO SINTÉTICO. Nunca ejecutar en producción. No reproduce Auth/Storage/Vault.', 'BEGIN;', '''DO $$BEGIN
 IF current_user<>'postgres' OR current_database() !~ '^jaguar360_clon_[a-z0-9_]+$'
 OR current_setting('jaguar360.isolated_clone',true) IS DISTINCT FROM 'validacion_sin_datos_reales'
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','storage','extensions'))
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))
 THEN RAISE EXCEPTION 'Clon sintético exige clúster local nuevo, base vacía y marcador.'; END IF;
END $$;''',
    'CREATE ROLE anon NOLOGIN;', 'CREATE ROLE authenticated NOLOGIN;', 'CREATE ROLE service_role NOLOGIN BYPASSRLS;',
    'CREATE SCHEMA auth;', 'CREATE SCHEMA extensions;', 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;', 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
    'CREATE TABLE auth.users (id uuid PRIMARY KEY);',
    '''CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;''',
    '''CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;''',
    'GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;',
    'REVOKE ALL ON TABLE auth.users FROM PUBLIC,anon,authenticated,service_role;',
    'SET LOCAL search_path=public,extensions,pg_catalog;', 'SET LOCAL check_function_bodies=off;']
    # First create public table skeletons, then routines/defaults and relational constraints.
    allowed_type=re.compile(r'^(?:text|bigint|integer|smallint|boolean|uuid|jsonb|date|timestamp with time zone|time without time zone|numeric(?:\([0-9]+,[0-9]+\))?|character\([0-9]+\)|integer\[\]|text\[\])$')
    for name in sorted(k for k,v in types.items() if v=='r'):
        rows=sorted((x for x in columns if x['relname']==name),key=lambda x:x['attnum']);defs=[]
        if not rows:raise ValueError('Tabla sin columnas: '+name)
        for c in rows:
            typ=c['type'];col=q(c['attname'])+' '+typ
            if not allowed_type.fullmatch(typ) or c['attidentity'] not in ('','a','d') or c['attgenerated'] not in ('','s'):raise ValueError('Tipo/generación no soportado: '+name+'.'+c['attname'])
            if c['attidentity']:
                col+=' GENERATED '+('ALWAYS' if c['attidentity']=='a' else 'BY DEFAULT')+' AS IDENTITY (SEQUENCE NAME '+table(name+'_'+c['attname']+'_seq')+')'
            elif c['attgenerated']:
                if not c['default_expression']:raise ValueError('Falta expresión de columna generada')
                col+=' GENERATED ALWAYS AS ('+c['default_expression']+') STORED'
            if c['attnotnull']:col+=' NOT NULL'
            defs.append(col)
        out.append('CREATE TABLE '+table(name)+' (\n '+',\n '.join(defs)+'\n);')
    for f in functions:out.append(f['definition'].rstrip().rstrip(';')+';')
    for c in columns:
        if types.get(c['relname'])=='r' and c['default_expression'] is not None and not c['attidentity'] and not c['attgenerated']:
            out.append('ALTER TABLE '+table(c['relname'])+' ALTER COLUMN '+q(c['attname'])+' SET DEFAULT '+c['default_expression']+';')
    for kind in ('p','u','c','f'):
        for c in cons:
            if c['contype']==kind:out.append('ALTER TABLE '+table(c['relname'])+' ADD CONSTRAINT '+q(c['conname'])+' '+c['definition']+';')
    if any(c['contype'] not in ('p','u','c','f') for c in cons):raise ValueError('Restricción no soportada')
    backed={(c['relname'],c['conname']) for c in cons if c['contype'] in ('p','u')}
    for x in indexes:
        if (x['tablename'],x['indexname']) not in backed:out.append(x['indexdef'].rstrip().rstrip(';')+';')
    # Only one view in the real export; cannot reconstruct missing reloptions.
    for v in views:out.append('CREATE VIEW '+table(v['relname'])+' AS '+v['definition'].rstrip().rstrip(';')+';')
    for t in triggers:
        if t['tgenabled']!='O':raise ValueError('Trigger no estándar: '+t['tgname'])
        out.append(t['definition'].rstrip().rstrip(';')+';')
    for p in policies:
        if p['cmd'] not in ('ALL','SELECT','INSERT','UPDATE','DELETE') or p['permissive'] not in ('PERMISSIVE','RESTRICTIVE'):raise ValueError('Política no soportada')
        stmt=f"CREATE POLICY {q(p['policyname'])} ON {table(p['tablename'])} AS {p['permissive']} FOR {p['cmd']} TO "+','.join(role(x) for x in p['roles'])
        if p['qual'] is not None:stmt+=' USING ('+p['qual']+')'
        if p['with_check'] is not None:stmt+=' WITH CHECK ('+p['with_check']+')'
        out.append(stmt+';')
    for r in relations:
        name=table(r['relname']);kind='SEQUENCE' if r['relkind']=='S' else 'TABLE'
        if r['relkind']=='r':
            if r['relrowsecurity']:out.append('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY;')
            if r['relforcerowsecurity']:out.append('ALTER TABLE '+name+' FORCE ROW LEVEL SECURITY;')
        out.extend(acl_sql(kind,name,r['relacl']))
    for f in functions:out.extend(acl_sql('FUNCTION','public.'+q(f['proname'])+'('+f['args']+')',f['proacl']))
    out+=['SET LOCAL check_function_bodies=on;', 'COMMIT;']
    stats=dict(tables=sum(x=='r' for x in types.values()),functions=len(functions),sequences=len(sequences),policies=len(policies),constraints=len(cons),triggers=len(triggers),views=len(views))
    return '\n\n'.join(out)+'\n',stats

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('export');p.add_argument('salida');p.add_argument('--confirmar-esquema-ficticio',action='store_true');a=p.parse_args()
    if not a.confirmar_esquema_ficticio:p.error('Confirma uso exclusivamente local, sin datos reales.')
    try:
        sql,stats=build(cotejo.parse_export(a.export))
        with open(a.salida,'x',encoding='utf-8') as f:f.write(sql)
        print(json.dumps(stats,ensure_ascii=False));print('DDL reconstruido sin filas. Revisar secretos antes de ejecutar/compartir. No se ejecutó PostgreSQL.')
    except Exception as e:p.exit(1,f'No se generó un esquema utilizable: {e}\n')
if __name__=='__main__':main()
