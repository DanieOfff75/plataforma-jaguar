#!/usr/bin/env python3
"""Ensayo SQL en un contenedor PostgreSQL 17 nuevo, sin puertos ni volúmenes del usuario.
No utiliza credenciales ni conexión a Supabase. El esquema se reconstruye localmente.
"""
import argparse, importlib.util, json, os, secrets, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DB='jaguar360_clon_v37'

def run(args,sql=None,timeout=180):
    return subprocess.run(args,input=sql,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=timeout)
def checked(args,sql=None,timeout=180):
    r=run(args,sql,timeout)
    if r.returncode!=0:raise RuntimeError((r.stderr or r.stdout or 'Comando falló').strip()[-4000:])
    return r.stdout

def ensure_local_docker():
    if any(os.environ.get(k) for k in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')):raise RuntimeError('Quita las variables Docker remotas antes de iniciar el laboratorio.')
    ctx=checked(['docker','context','show']).strip(); data=json.loads(checked(['docker','context','inspect',ctx]))
    host=data[0]['Endpoints']['docker']['Host']
    if not host.startswith(('unix://','npipe://')):raise RuntimeError('Sólo un motor Docker local por socket/npipe.')

def script(export):
    spec=importlib.util.spec_from_file_location('synthetic',ROOT/'tools/reconstruir-esquema-pruebas.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m.build(m.cotejo.parse_export(export))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--export',required=True);p.add_argument('--confirmar-efimero',action='store_true');a=p.parse_args()
    if not a.confirmar_efimero:p.error('Confirma creación/eliminación automática de un contenedor nuevo con datos ficticios.')
    if not (ROOT.parent/'PRUEBA_LOCAL.txt').is_file():p.error('Ejecuta desde Plataforma dentro de las copias preparadas y verificadas.')
    cid=None;stage='preparación'; completed=[]
    try:
        ensure_local_docker();base,stats=script(a.export)
        plan=json.loads((ROOT/'sql/JAGUAR360_ORDEN_CLON.json').read_text())
        assert len(plan['migrations'])==39 and len(set(plan['migrations']))==39
        stage='crear contenedor aislado'
        name='jaguar360-lab-'+secrets.token_hex(6)
        # No port mappings, no bind mounts, no persistent external storage, no network access.
        cid=checked(['docker','run','--pull','missing','--detach','--name',name,'--network','none','--label','org.jaguar360.test=ephemeral','--env','POSTGRES_DB='+DB,'--env','POSTGRES_PASSWORD='+secrets.token_urlsafe(32),'postgres:17'],timeout=300).strip()
        if not cid or not all(ch in '0123456789abcdef' for ch in cid):raise RuntimeError('Identificador de contenedor inesperado.')
        for _ in range(90):
            # Socket inside the container; TCP unavailable to outside.
            r=run(['docker','exec','-u','postgres',cid,'pg_isready','-q','-U','postgres','-d',DB],timeout=10)
            if r.returncode==0:
                # The image temporarily starts a server while initializing; wait for final server.
                probe=run(['docker','exec','-u','postgres',cid,'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',DB],timeout=10)
                if probe.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('PostgreSQL no inició correctamente.')
        def psql(s):return checked(['docker','exec','-i','-u','postgres',cid,'psql','-X','-qAt','-U','postgres','-d',DB,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],s)
        stage='marcador';psql("ALTER DATABASE "+DB+" SET jaguar360.isolated_clone='validacion_sin_datos_reales';")
        stage='reconstrucción del esquema público (sintético)';psql(base);print(json.dumps(stats,ensure_ascii=False),flush=True)
        for i,rel in enumerate(plan['migrations'],1):
            stage=f'{i}/39 {rel}';print(stage,flush=True);psql((ROOT/rel).read_text(encoding='utf-8'));completed.append(rel)
        stage='auditoría ACL';findings=psql((ROOT/plan['audit']).read_text(encoding='utf-8')).strip()
        if findings:raise RuntimeError('Hallazgos ACL:\n'+findings)
        for test in ['tests/jaguar360_curriculum_db_smoke.sql','tests/jaguar360_privacidad_real_db_smoke.sql','tests/jaguar360_solicitudes_db_smoke.sql']:
            stage=test;print(stage,flush=True);psql((ROOT/test).read_text(encoding='utf-8'))
        print(json.dumps({'estado':'ensayo_sintetico_superado','migraciones':len(completed),'acl':'sin hallazgos','smoke_sql':3,'produccion_autorizada':False},ensure_ascii=False),flush=True)
    except Exception as e:
        print(json.dumps({'estado':'fallo','paso':stage,'migraciones_completadas':len(completed),'error':str(e),'produccion_autorizada':False},ensure_ascii=False),file=sys.stderr,flush=True)
        return 1
    finally:
        if cid and all(ch in '0123456789abcdef' for ch in cid):
            r=run(['docker','rm','-f','-v',cid],timeout=60)
            if r.returncode!=0:print('No se pudo retirar el contenedor del ensayo. Revisar sólo este ID: '+cid,file=sys.stderr)
    return 0
if __name__=='__main__':raise SystemExit(main())
