#!/usr/bin/env python3
"""Run the V37 lab gates on verified local copies. No production deployment."""
import argparse, datetime, json, os, shutil, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; TOP=ROOT.parent

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--export',type=Path,help='Export de esquema original saneado; necesario para SQL')
 p.add_argument('--solo-codigo',action='store_true',help='Solo Node + inventario; no certifica SQL')
 p.add_argument('--navegador',action='store_true',help='Todos los ensayos Chromium aislados (Linux/WSL, Playwright)')
 p.add_argument('--base',type=Path,help='ZIP original de Plataforma para comparar los menús')
 p.add_argument('--reporte',type=Path,default=TOP/'RESULTADO_PRUEBAS_V37.json')
 a=p.parse_args()
 if not (TOP/'PRUEBA_LOCAL.txt').is_file():p.error('Ejecuta únicamente en copias preparadas por PREPARAR_COPIAS.py.')
 if a.solo_codigo and a.export:p.error('No combines --solo-codigo con --export.')
 if not a.solo_codigo and (not a.export or not a.export.is_file()):p.error('Indica --export del esquema saneado, o --solo-codigo.')
 if not all((TOP/r/'package.json').is_file() for r in ('admisiones','centro-control')):p.error('Faltan repositorios completos del laboratorio.')
 env=os.environ.copy();env.update(JAGUAR_ADMISIONES_DIR=str(TOP/'admisiones'),JAGUAR_CENTRO_DIR=str(TOP/'centro-control'))
 stages=[('Node', ['node','--test',*[str(x.relative_to(ROOT)) for x in sorted((ROOT/'tests').glob('*.test.mjs'))]]),('Inventario',['node','tools/validar-jaguar360-clon.mjs','--plan'])]
 if a.navegador:
  if not a.base or not a.base.is_file():p.error('--navegador requiere --base del ZIP original.')
  stages.append(('Chromium completo',[sys.executable,'tools/probar-navegador-v37.py','--base',str(a.base.absolute()),'--reporte',str(a.reporte.absolute().with_suffix('.browser.json'))]))
 if not a.solo_codigo:stages.extend([('Cotejo estático',[sys.executable,'tools/cotejar-esquema-jaguar360.py',str(a.export.absolute())]),('SQL Docker',[sys.executable,'tools/ensayar-jaguar360-docker.py','--export',str(a.export.absolute()),'--confirmar-efimero'])])
 results=[];failed=False;invalid_inventory=False
 for stage,args in stages:
  print('\n=== '+stage+' ===',flush=True)
  if stage=='SQL Docker' and invalid_inventory:results.append({'paso':stage,'estado':'no_ejecutado','motivo':'inventario o cotejo inválido'});continue
  try:
   r=subprocess.run(args,cwd=ROOT,env=env,text=True,encoding='utf-8',errors='replace',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=1200)
   print(r.stdout,flush=True);success=r.returncode==0
   # Detect skipped/failed tests or empty Node test runners as a failed gate.
   if stage=='Node':
    import re
    skipped=re.search(r'^# skipped (\d+)$',r.stdout,re.M);count=re.search(r'^# tests (\d+)$',r.stdout,re.M)
    success=success and bool(skipped and skipped[1]=='0' and count and int(count[1])>=456)
   results.append({'paso':stage,'estado':'aprobado' if success else 'fallo','codigo':r.returncode});failed=failed or not success
   if stage in ('Inventario','Cotejo estático') and not success:invalid_inventory=True
  except (OSError,subprocess.TimeoutExpired) as e:
   print(str(e),file=sys.stderr);results.append({'paso':stage,'estado':'fallo','error':type(e).__name__});failed=True
   if stage in ('Inventario','Cotejo estático'):invalid_inventory=True
 report={'version':'V37','fecha_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pasos':results,'sql_solicitado':not a.solo_codigo,'navegador_solicitado':a.navegador,'produccion_autorizada':False,'alcance':'Laboratorio local, no certificación integral.'}
 # Do not overwrite old evidence.
 try:
  with a.reporte.open('x',encoding='utf-8') as f:json.dump(report,f,indent=2,ensure_ascii=False)
 except FileExistsError:print('Reporte existente: elige --reporte con nombre nuevo.',file=sys.stderr);return 2
 print(json.dumps(report,ensure_ascii=False,indent=2));return 1 if failed else 0
if __name__=='__main__':raise SystemExit(main())
