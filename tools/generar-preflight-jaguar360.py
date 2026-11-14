#!/usr/bin/env python3
"""Generate read-only post-migration catalog audit from the documented migration order. No DB connection."""
import re
from pathlib import Path
root=Path(__file__).resolve().parent.parent
order=re.findall(r'`(sql/ITHLA_JAGUAR_360_\w+\.sql)`', (root/'GUIA_JAGUAR_360_APERTURA_PRECISION_V22.md').read_text())
order.append('sql/ITHLA_JAGUAR_360_RECUPERACION_V23.sql')
order.append('sql/ITHLA_JAGUAR_360_RECUPERACION_V24.sql')
order.append('sql/ITHLA_JAGUAR_360_MOVIMIENTOS_V25.sql')
order.extend('sql/ITHLA_JAGUAR_360_'+x+'_V26.sql' for x in ['SEGURIDAD_DOCUMENTOS','PUBLICACION_HORARIOS','COMUNICADOS'])
order.append('sql/ITHLA_JAGUAR_360_EDITORIAL_V27.sql')
order.append('sql/ITHLA_JAGUAR_360_CONTINUIDAD_V29.sql')
order.append('sql/ITHLA_JAGUAR_360_BANDEJA_V30.sql')
order.append('sql/ITHLA_JAGUAR_360_AGENDA_V31.sql')
order.append('sql/ITHLA_JAGUAR_360_CONFIRMACION_CONTINUIDAD_V32.sql')
order.append('sql/ITHLA_JAGUAR_360_ECOSISTEMA_V34.sql')
order.append('sql/ITHLA_JAGUAR_360_PRIVACIDAD_REAL_V35.sql')
order.append('sql/ITHLA_JAGUAR_360_SOLICITUDES_V36.sql')
order.append('sql/ITHLA_JAGUAR_360_BANDEJA_ATOMICA_V37.sql')
order.insert(0,'sql/ITHLA_CALIFICACIONES_REAPLICACION_2026.sql')
assert len(order)==39,order
import json
(root/'sql/JAGUAR360_ORDEN_CLON.json').write_text(json.dumps({'base':'V37','migrations':order,'audit':'tests/jaguar360_catalog_acl_audit.sql'},indent=2)+'\n')
rpcs=set();tables=set();funcs=set()
for name in order:
    sql=(root/name).read_text()
    tables.update(re.findall(r'CREATE TABLE IF NOT EXISTS public\.(jaguar(?:360_\w+|_reaplicacion_calificaciones))',sql,re.I))
    for group in re.findall(r'GRANT\s+EXECUTE\s+ON FUNCTION\s+(.+?)\s+TO service_role\s*;',sql,re.I|re.S):
        rpcs.update(re.findall(r'public\.\w+\([^()]*\)',group))
    for group in re.findall(r'REVOKE ALL ON FUNCTION\s+(.+?)\s+FROM PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;',sql,re.I|re.S):
        funcs.update(re.findall(r'public\.\w+\([^()]*\)',group))
assert rpcs and tables
funcs.update(rpcs)
def values(xs):return ',\n'.join(" ('"+s.replace("'","''")+"')" for s in sorted(xs))
header='''-- Generated from the 39 ordered prerequisite + V1–V37 migration files. Run as DB owner on an isolated clone AFTER migrations.
-- Read-only inventory: absence of findings does NOT certify RLS semantics, function bodies or concurrency.
BEGIN TRANSACTION READ ONLY;
'''
query=f'''WITH expected_rpc(signature) AS (VALUES\n{values(rpcs)}\n), expected_private(signature) AS (VALUES\n{values(funcs-rpcs)}\n), expected_table(name) AS (VALUES\n{values('public.'+t for t in tables)}\n), legacy_private_relation(name) AS (VALUES
 ('public.incidencias_prefectura'),('public.solicitudes_estudiantiles'),('public.matricula_migraciones'),('public.aprobaciones_cambio_grado'),('public.solicitudes_cambio_grado'),('public.docente_disponibilidad'),('public.ciclos_escolares_operaciones'),('public.jaguar_recursos_movimientos')
), legacy_rel AS (SELECT name,to_regclass(name) AS oid FROM legacy_private_relation), f AS (SELECT signature,to_regprocedure(signature) AS oid,true AS exposed FROM expected_rpc UNION ALL SELECT signature,to_regprocedure(signature),false FROM expected_private), t AS (SELECT name,to_regclass(name) AS oid FROM expected_table), findings AS (
 SELECT 'missing function' AS issue,signature AS object FROM f WHERE oid IS NULL
 UNION ALL SELECT 'client RPC execute',signature FROM f WHERE oid IS NOT NULL AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))
 UNION ALL SELECT 'service execute differs',signature FROM f WHERE oid IS NOT NULL AND has_function_privilege('service_role',oid,'EXECUTE') IS DISTINCT FROM exposed
 UNION ALL SELECT 'missing legacy relation',name FROM legacy_rel WHERE oid IS NULL
 UNION ALL SELECT 'legacy client relation privileges',name FROM legacy_rel WHERE oid IS NOT NULL AND (has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 UNION ALL SELECT 'legacy service SELECT missing',name FROM legacy_rel WHERE oid IS NOT NULL AND NOT has_table_privilege('service_role',oid,'SELECT')
 UNION ALL SELECT 'notification client content mutation','public.notificaciones' WHERE has_column_privilege('authenticated','public.notificaciones','contenido','UPDATE') OR has_column_privilege('authenticated','public.notificaciones','usuario_id','UPDATE') OR has_table_privilege('authenticated','public.notificaciones','INSERT,DELETE,TRUNCATE') OR has_table_privilege('anon','public.notificaciones','SELECT,INSERT,UPDATE,DELETE')
 UNION ALL SELECT 'notification own-row access missing','public.notificaciones' WHERE NOT has_table_privilege('authenticated','public.notificaciones','SELECT') OR NOT has_column_privilege('authenticated','public.notificaciones','leida','UPDATE')
 UNION ALL SELECT 'missing table',name FROM t WHERE oid IS NULL
 UNION ALL SELECT 'RLS disabled',t.name FROM t JOIN pg_class c ON c.oid=t.oid WHERE NOT c.relrowsecurity
 UNION ALL SELECT 'client table privileges',name FROM t WHERE oid IS NOT NULL AND (has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 UNION ALL SELECT 'service direct mutation',name FROM t WHERE oid IS NOT NULL AND has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE')
) SELECT issue,object FROM findings ORDER BY issue,object;
ROLLBACK;
'''
# Some grant/revoke lists use spaces; preserve signatures exactly from migration scripts.
(root/'tests/jaguar360_catalog_acl_audit.sql').write_text(header+query)
print(f'{len(order)} migraciones; {len(rpcs)} RPC de servicio, {len(funcs-rpcs)} funciones privadas, {len(tables)} tablas revisadas.')
