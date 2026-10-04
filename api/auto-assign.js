import { requireRoles } from '../lib/_admin.js';

const roleOk = [
  'servicios_docentes',
  'coordinacion_academica',
  'direccion_escolar',
  'control_escolar',
  'control'
];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
}

function mezclar(array) {
  const copia = [...array];

  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }

  return copia;
}

export default async function handler(req, res) {
  try {
    const { adminClient } = await requireRoles(req, roleOk);

    if (req.method !== 'POST') {
      return res.status(405).json({
        ok: false,
        error: 'Método no permitido.'
      });
    }

    const body = req.body || {};

    const ciclo =
      String(body.ciclo_escolar || '').trim() ||
      `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

    const docenteId = n(body.docente_id);
    const materiaId = n(body.materia_id);
    const cantidad = n(body.cantidad_grupos);

    if (!docenteId || !materiaId || cantidad < 1) {
      return res.status(400).json({
        ok: false,
        error: 'Selecciona docente, materia y una cantidad válida de grupos.'
      });
    }

    // =========================================================
    // 1. DOCENTE
    // =========================================================

    const {
      data: docente,
      error: docenteError
    } = await adminClient
      .from('docentes')
      .select(`
        id,
        nombre_completo,
        especialidad,
        horas_solicitadas,
        horas_asignadas,
        activo
      `)
      .eq('id', docenteId)
      .maybeSingle();

    if (docenteError || !docente) {
      return res.status(404).json({
        ok: false,
        error: docenteError?.message || 'Docente no encontrado.'
      });
    }

    if (docente.activo === false) {
      return res.status(400).json({
        ok: false,
        error: 'El docente seleccionado está inactivo.'
      });
    }

    // =========================================================
    // 2. MATERIA
    // =========================================================

    const {
      data: materia,
      error: materiaError
    } = await adminClient
      .from('materias')
      .select(`
        id,
        nombre,
        clave,
        grado,
        grados,
        horas_semana,
        activa
      `)
      .eq('id', materiaId)
      .maybeSingle();

    if (materiaError || !materia) {
      return res.status(404).json({
        ok: false,
        error: materiaError?.message || 'Materia no encontrada.'
      });
    }

    if (materia.activa === false) {
      return res.status(400).json({
        ok: false,
        error: 'La materia seleccionada está inactiva.'
      });
    }

    const horasMateria = Number(materia.horas_semana || 0);

    if (horasMateria <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'La materia no tiene configuradas sus horas semanales.'
      });
    }

    // =========================================================
    // 3. GRUPOS COMPATIBLES CON LA MATERIA
    // =========================================================

    const {
      data: grupoMaterias,
      error: gruposError
    } = await adminClient
      .from('grupo_materias')
      .select(`
        id,
        grupo_id,
        materia_id,
        horas_semana,
        activo,
        grupos(
          id,
          clave,
          grado,
          letra,
          activo
        )
      `)
      .eq('materia_id', materiaId)
      .eq('activo', true);

    if (gruposError) {
      throw gruposError;
    }

    let candidatos = (grupoMaterias || []).filter(gm => {
      const grupo = gm.grupos;
    
      if (!grupo) return false;
      if (grupo.activo === false) return false;
    
      const gradoGrupo = Number(grupo.grado);
    
      /*
        =========================================================
        COMPATIBILIDAD DE GRADOS
        =========================================================
    
        Las materias nuevas pueden tener:
    
          grados: [1,2,3]
    
        mientras que las materias antiguas pueden conservar:
    
          grado: 1
    
        Primero usamos "grados" cuando exista.
        Solamente usamos "grado" como compatibilidad
        con registros antiguos.
      */
    
      let gradosPermitidos = [];
    
      if (Array.isArray(materia.grados)) {
        gradosPermitidos = materia.grados
          .map(Number)
          .filter(n => Number.isFinite(n) && n > 0);
      }
    
      if (gradosPermitidos.length > 0) {
        if (!gradosPermitidos.includes(gradoGrupo)) {
          return false;
        }
      } else if (
        materia.grado !== null &&
        materia.grado !== undefined &&
        Number(materia.grado) > 0
      ) {
        if (gradoGrupo !== Number(materia.grado)) {
          return false;
        }
      }
    
      return true;
    });
    if (!candidatos.length) {
      return res.status(400).json({
        ok: false,
        error: 'No existen grupos compatibles con esta materia.'
      });
    }

    // =========================================================
    // 4. BUSCAR ASIGNACIONES EXISTENTES
    // =========================================================

    const {
      data: asignacionesExistentes,
      error: asignacionesError
    } = await adminClient
      .from('asignaciones_docentes')
      .select(`
        id,
        docente_id,
        grupo_materia_id,
        horas_asignadas,
        activo
      `)
      .eq('ciclo_escolar', ciclo)
      .eq('activo', true);

    if (asignacionesError) {
      throw asignacionesError;
    }

    /*
      =========================================================
      CORRECCIÓN IMPORTANTE
      =========================================================

      Antes se hacía esto:

          si existe una asignación
          -> grupo completo

      Eso era incorrecto.

      Ahora SUMAMOS las horas de cada grupo-materia
      y las comparamos contra las horas requeridas.

      Ejemplo:

          2A Español
          requiere: 5
          asignadas: 0
          restantes: 5

      -> DISPONIBLE

      1A Español
          requiere: 5
          asignadas: 5
          restantes: 0

      -> COMPLETO

      También permite dividir las horas:

          2A Español
          Docente A = 3
          Docente B = 2

          total = 5

      -> COMPLETO
    */

    const horasPorGrupo = new Map();

    for (const asignacion of (asignacionesExistentes || [])) {
      const gmId = Number(asignacion.grupo_materia_id);

      if (!gmId) continue;

      const horas = Number(asignacion.horas_asignadas || 0);

      horasPorGrupo.set(
        gmId,
        (horasPorGrupo.get(gmId) || 0) + horas
      );
    }

    /*
      Cada candidato recibe su propio cálculo:

        horas_requeridas
        horas_asignadas
        horas_restantes
    */

    candidatos = candidatos.map(gm => {
      const horasRequeridas = Number(
        gm.horas_semana || horasMateria || 0
      );

      const horasAsignadas = Number(
        horasPorGrupo.get(Number(gm.id)) || 0
      );

      const horasRestantes = Math.max(
        horasRequeridas - horasAsignadas,
        0
      );

      return {
        ...gm,
        _horas_requeridas: horasRequeridas,
        _horas_asignadas: horasAsignadas,
        _horas_restantes: horasRestantes
      };
    });

    /*
      SOLAMENTE quedan como candidatos los grupos
      que todavía tengan horas disponibles.
    */

    candidatos = candidatos.filter(
      gm => gm._horas_restantes > 0
    );

    if (!candidatos.length) {
      return res.status(400).json({
        ok: false,
        error:
          `Todos los grupos compatibles de ${materia.nombre} ` +
          `ya tienen cubiertas sus horas requeridas.`
      });
    }

    // =========================================================
    // 5. HORAS DISPONIBLES DEL DOCENTE
    // =========================================================

    const horasSolicitadas = Number(
      docente.horas_solicitadas || 0
    );

    const horasAsignadas = Number(
      docente.horas_asignadas || 0
    );

    const horasDisponibles =
      Math.max(
        0,
        horasSolicitadas - horasAsignadas
      );

    /*
      Para saber cuántos grupos completos puede recibir
      el docente usamos las horas requeridas de cada grupo.

      No suponemos que todos los grupos necesariamente
      tienen las mismas horas.
    */

    if (horasDisponibles <= 0) {
      return res.status(400).json({
        ok: false,
        error:
          `El docente no tiene horas disponibles. ` +
          `Tiene ${horasAsignadas} h asignadas de ` +
          `${horasSolicitadas} h solicitadas.`
      });
    }

    // =========================================================
    // 6. ALEATORIZAR
    // =========================================================

    candidatos = mezclar(candidatos);

    /*
      Vamos seleccionando grupos mientras las horas del docente
      alcancen.

      MUY IMPORTANTE:

      Si un grupo tiene 5 horas restantes,
      se asignan 5.

      Si solamente tiene 2 horas restantes,
      solamente se asignan esas 2.

      Así nunca sobrepasamos las horas requeridas del grupo.
    */

    const seleccionados = [];
    let horasQueSeVanAAsignar = 0;

    for (const gm of candidatos) {

      if (seleccionados.length >= cantidad) {
        break;
      }

      const horasNecesarias = Number(
        gm._horas_restantes || 0
      );

      if (horasNecesarias <= 0) {
        continue;
      }

      if (
        horasQueSeVanAAsignar + horasNecesarias >
        horasDisponibles
      ) {
        continue;
      }

      seleccionados.push(gm);

      horasQueSeVanAAsignar += horasNecesarias;
    }

    if (!seleccionados.length) {
      return res.status(400).json({
        ok: false,
        error:
          `El docente tiene ${horasDisponibles} h disponibles, ` +
          `pero no hay suficientes horas disponibles para ` +
          `completar otro grupo de ${materia.nombre}.`
      });
    }

    // =========================================================
    // 7. CREAR ASIGNACIONES
    // =========================================================

    const filas = seleccionados.map(gm => ({
      docente_id: docenteId,
      grupo_materia_id: gm.id,
      ciclo_escolar: ciclo,
      horas_asignadas: Number(gm._horas_restantes),
      origen: 'aleatoria',
      activo: true
    }));

    if (!filas.length) {
      return res.status(400).json({
        ok: false,
        error: 'No fue posible generar las asignaciones.'
      });
    }

    const {
      data: insertadas,
      error: insertarError
    } = await adminClient
      .from('asignaciones_docentes')
      .insert(filas)
      .select('*');

    if (insertarError) {
      throw insertarError;
    }

    // =========================================================
    // 8. RECALCULAR HORAS DEL DOCENTE
    // =========================================================

    await adminClient.rpc(
      'recalcular_horas_docente',
      {
        p_docente_id: docenteId
      }
    );

    // =========================================================
    // 9. RESPUESTA
    // =========================================================

    return res.status(200).json({
      ok: true,

      message:
        `Se asignaron ${filas.length} grupo(s) aleatoriamente ` +
        `a ${docente.nombre_completo}.`,

      data: insertadas,

      grupos: seleccionados.map(gm => ({
        grupo_materia_id: gm.id,
        grupo: gm.grupos?.clave || '—',
        horas_requeridas: Number(gm._horas_requeridas),
        horas_que_tenia_asignadas: Number(gm._horas_asignadas),
        horas_asignadas: Number(gm._horas_restantes)
      })),

      horas_asignadas: horasQueSeVanAAsignar
    });

  } catch (error) {

    console.error('AUTO ASSIGN ERROR:', error);

    return res.status(error.status || 500).json({
      ok: false,
      error:
        error.message ||
        'No se pudo realizar la asignación aleatoria.'
    });
  }
}
