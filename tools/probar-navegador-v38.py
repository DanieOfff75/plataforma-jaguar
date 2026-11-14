#!/usr/bin/env python3
"""Ejecuta cada prueba Chromium aislada con API simulada y reporte individual (Linux/WSL)."""
import argparse, concurrent.futures, json, os, signal, subprocess, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',required=True,type=Path,help='ZIP original de Plataforma');p.add_argument('--reporte',required=True,type=Path);p.add_argument('--trabajadores',type=int,default=2,choices=(1,2,3));p.add_argument('--limite',type=int,default=60);a=p.parse_args()
 if not (ROOT.parent/'PRUEBA_LOCAL.txt').is_file():p.error('Usa las copias del laboratorio.')
 if a.reporte.exists():p.error('Usa un reporte nuevo.')
 if not Path('/usr/bin/chromium').is_file():p.error('Se requiere Chromium en /usr/bin/chromium (Linux/WSL).')
 if not 10<=a.limite<=300:p.error('Límite de 10 a 300 segundos por prueba.')
 from importlib.util import spec_from_file_location,module_from_spec
 spec=spec_from_file_location('pack',ROOT/'tools/preparar-ecosistema-jaguar360.py');m=module_from_spec(spec);spec.loader.exec_module(m)
 manifest=json.loads((ROOT/'JAGUAR360_INTEGRIDAD_V38.json').read_text())
 expected=manifest['unchanged'].get('sistema.html') or manifest['files']['sistema.html']['before']
 original=m.original(a.base)
 if m.sha(original['sistema.html'])!=expected:p.error('sistema.html base no coincide.')
 tests=sorted((ROOT/'tools').glob('test_*_browser.py'))
 if not tests:p.error('No se encontraron pruebas.')
 with tempfile.TemporaryDirectory(prefix='jaguar-browser-') as tmp:
  base=Path(tmp)/'original';base.mkdir()
  for k,v in original.items():
   target=base/k;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(v)
  def run(test):
   args=[sys.executable,str(test)]
   if test.name=='test_workspaces_browser.py':args+=['--base',str(base)]
   proc=subprocess.Popen(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
   try:output,_=proc.communicate(timeout=a.limite);state='aprobado' if proc.returncode==0 else 'fallo'
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGKILL);output,_=proc.communicate();state='tiempo_excedido'
   return {'prueba':test.name,'estado':state,'codigo':proc.returncode,'salida':output[-4000:]}
  results=[]
  with concurrent.futures.ThreadPoolExecutor(max_workers=a.trabajadores) as executor:
   for result in executor.map(run,tests):results.append(result);print(result['prueba'],result['estado'],flush=True)
 summary={'total':len(results),'aprobadas':sum(x['estado']=='aprobado' for x in results),'resultados':results,'alcance':'API simulada; no servicios externos, autenticación real ni certificación productiva.'}
 with a.reporte.open('x',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False)
 return 0 if summary['total']==summary['aprobadas'] else 1
if __name__=='__main__':raise SystemExit(main())
