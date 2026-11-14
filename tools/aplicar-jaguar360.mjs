#!/usr/bin/env node
// Development package: deliberately refuse installation; old ten-file installer was incomplete.
if(process.argv.includes('--aplicar')){console.error('Instalación bloqueada: paquete experimental acumulativo. Ejecuta únicamente el verificador.');process.exit(2);}
process.argv=process.argv.filter(x=>x!=='--verificar');await import('./verificar-jaguar360-acumulado.mjs');
