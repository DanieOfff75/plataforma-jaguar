"""Compila la maqueta HTML aprobada a tres fondos PDF + coordenadas (solo desarrollo).
En producción Jaguar utiliza exclusivamente pdf-lib; Chromium NO es dependencia de Vercel.
Ejecutar: python tools/build_boleta_templates.py
"""
import json
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT/'assets/Boleta-Jaguar-Propuesta-Visual-15.html').read_text()
soup = BeautifulSoup(source,'html.parser')
main = soup.select_one('main')
assert len(main.select('section.sheet'))==3
counter=0

def mark(el,key):
    global counter
    assert el is not None, f'No existe campo {key}'
    counter+=1
    el['data-jaguar-field']=key
    # NBSP mantiene altura, alineación y estilos originales.
    el.clear()
    el.append(NavigableString('\u00a0'))

for pagei,section in enumerate(main.select('section.sheet')):
    prefix=str(pagei+1)
    mark(section.select_one('.institution h1'),f'{prefix}.institution')
    mark(section.select_one('.institution .motto'),f'{prefix}.motto')
    # La indicación de ciclo se mantiene, solo varía el texto del año.
    cycle = section.select_one('.doc-tag .cycle')
    if cycle:
        # conservar la etiqueta original si estuviera anidada
        mark(cycle.select_one('b'),f'{prefix}.cycle')
    mark(section.select_one('.folio strong'),f'{prefix}.folio')
    mark(section.select_one('.footer span:first-child'),f'{prefix}.footer')
    mark(section.select_one('.footer .page-num'),f'{prefix}.page')

first=main.select('section.sheet')[0]
mark(first.select_one('.subtitle'),'1.subtitle')
for n,el in enumerate(first.select('.student-line .value')):mark(el,f'1.student.{n}')
for n,el in enumerate(first.select('thead th')[1:-1]):mark(el,f'1.period.{n}')
for r,tr in enumerate(first.select('tbody tr')):
    for c,td in enumerate(tr.select('td')):mark(td,f'1.grade.{r}.{c}')
for i,el in enumerate(first.select('.summary .value')):mark(el,f'1.summary.{i}')
notes=first.select_one('.notes')
for ch in list(notes.children):
    if isinstance(ch,NavigableString): ch.replace_with(' ')
mark(notes,'1.notes')  # reescribimos con la etiqueta Observaciones en el PDF, manteniendo estilo
for i,el in enumerate(first.select('.sign-area .sign-sub')):mark(el,f'1.signlabel.{i}')
# QR de maqueta quitado para insertar el QR criptográficamente verificable.
qr=first.select_one('.qr-box'); qr.clear()

second=main.select('section.sheet')[1]
# Introducciones de maqueta: texto institucional definitivo.
second.select_one('.page-intro').string='Cada docente asignado firma en el espacio correspondiente para validar la evaluación registrada. La relación se adapta al número real de asignaturas calificadas. El taller formativo se registra en los datos del alumno y no aparece como materia con calificación.'
second.select_one('.note-small').string='Los campos están separados para admitir firma electrónica o manuscrita; las filas se ajustan al número de docentes asignados. Los registros y las firmas digitales proceden de la plataforma Jaguar.'
for r,tr in enumerate(second.select('.teacher-table tbody tr')):
    for c,td in enumerate(tr.select('td')[:3]):mark(td,f'2.teacher.{r}.{c}')
for i,el in enumerate(second.select('.compact-validation .sign-sub')):mark(el,f'2.signlabel.{i}')

third=main.select('section.sheet')[2]
third.select_one('.page-intro').string='Se reserva un bloque de firma por departamento para evitar concentrar todas las validaciones en una sola hoja. Los nombres se reemplazan por las áreas responsables que existan y participen en el proceso de Jaguar.'
third.select_one('.notes').string='Control de validación: Las firmas de estas áreas complementan las validaciones del alumno, docentes y Dirección.'
for i,dep in enumerate(third.select('.department')):
    for sel,k in [('h3','name'),('.dept-note','description'),('.dept-sign','sign'),('.dept-role','role')]: mark(dep.select_one(sel),f'3.department.{i}.{k}')

# Evitar referencias a sello en los textos visibles sin cambiar el diseño.
for el in main.find_all(string=True):
    if 'sello' in str(el).lower(): el.replace_with(str(el).replace('Nombre, firma y sello','Nombre y firma').replace('sello institucional','firma institucional').replace('sello si corresponde','firma según corresponda'))

# Styling preserved 1:1 from user's reference. Extension for repeating sheets
# with classes rather than positional nth-of-type selectors.
style=soup.select_one('style')
style.append(NavigableString('''\n@media print {
  .sheet.jaguar-teachers .sign-grid{margin-top:18px;gap:30px 40px}
  .sheet.jaguar-teachers .compact-validation .sign-block{padding-top:30px;min-height:62px}
  .sheet.jaguar-departments .department-grid{row-gap:20px;margin-top:16px}
  .sheet.jaguar-departments .department{min-height:142px;padding-top:10px}
  .sheet.jaguar-departments .department .dept-sign{margin-top:59px}
}\n'''))
second['class'].append('jaguar-teachers')
third['class'].append('jaguar-departments')
# Keep a source copy of exact dynamic-proof appearance for audit
html=str(soup)
(ROOT/'assets/boleta-visual15-plantilla.html').write_text(html)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':816,'height':1056},device_scale_factor=1)
    page.set_content(html,wait_until='load')
    page.emulate_media(media='print')
    positions=page.evaluate('''() => {
      const sheets=[...document.querySelectorAll('main .sheet')];
      const fields={};
      for(const s of sheets){
        const sheetRect=s.getBoundingClientRect();
        for(const el of s.querySelectorAll('[data-jaguar-field]')){
          let rect=el.getBoundingClientRect();const css=getComputedStyle(el);
          if(el.matches('.folio strong')){const parent=el.closest('.folio').getBoundingClientRect();rect={x:parent.x,y:rect.y,width:parent.width,height:rect.height};}
          if(el.matches('.cycle b')){const parent=el.closest('.cycle').getBoundingClientRect();rect={x:parent.x,y:rect.y,width:parent.width,height:rect.height};}
          if(el.matches('.summary .value')){const parent=el.closest('.summary').getBoundingClientRect();rect={x:parent.x+8,y:rect.y,width:parent.width-16,height:rect.height};}
          if(el.matches('.footer span:first-child')){const r=el.closest('.footer').getBoundingClientRect();rect={x:r.x,y:rect.y,width:r.width*.67,height:rect.height};}
          if(el.matches('.footer .page-num')){const r=el.closest('.footer').getBoundingClientRect();rect={x:r.x+r.width*.76,y:rect.y,width:r.width*.24,height:rect.height};}
          fields[el.dataset.jaguarField]={x:rect.x-sheetRect.x,top:rect.y-sheetRect.y,
            w:rect.width,h:rect.height,font:parseFloat(css.fontSize),family:css.fontFamily,
            weight:css.fontWeight,italic:css.fontStyle==='italic',align:css.textAlign,
            transform:css.textTransform,color:css.color,lineHeight:parseFloat(css.lineHeight)||parseFloat(css.fontSize)*1.2};
        }
      }
      for(let i=0;i<sheets.length;i++){
        const s=sheets[i],sr=s.getBoundingClientRect();
        if(i===0){
          const qr=s.querySelector('.qr-box'),r=qr.getBoundingClientRect();
          fields['1.qr']={x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height};
        }
        if(i===1){
          for(const [j,cell] of [...s.querySelectorAll('.teacher-table .signcell')].entries()){
            const r=cell.getBoundingClientRect();fields[`2.signature.${j}`]={x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height};
          }
          for(const [j,el] of [...s.querySelectorAll('.compact-validation .sign-block')].entries()){
            const r=el.getBoundingClientRect();fields[`2.signbox.${j}`]={x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height};
          }
        }
        if(i===2){
          for(const [j,el] of [...s.querySelectorAll('.department')].entries()){
            const r=el.getBoundingClientRect();fields[`3.signbox.${j}`]={x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height};
          }
        }
        if(i===0){
          for(const [j,el] of [...s.querySelectorAll('.sign-area .sign-block')].entries()){
            const r=el.getBoundingClientRect();fields[`1.signbox.${j}`]={x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height};
          }
        }
      }
      return fields;
    }''')
    page.pdf(path=str(ROOT/'assets/boleta-visual15-base.pdf'),format='Letter',print_background=True,prefer_css_page_size=True)
    browser.close()
(ROOT/'assets/boleta-visual15-campos.json').write_text(json.dumps(positions,ensure_ascii=False,indent=2))
print(f'Creada plantilla con {counter} campos dinámicos, {len(positions)} posiciones')
