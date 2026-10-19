const ExcelJS = require('exceljs');

// Sanitizar nombres de hojas de Excel (máximo 31 caracteres, sin caracteres reservados)
function limpiarNombreHoja(nombre, nombresUsados = new Set()) {
    let limpio = (nombre || 'Hoja')
        .replace(/[\\/?*:[\]]/g, ' ')
        .trim()
        .substring(0, 26);
    
    if (!limpio) limpio = 'Categoria';

    let nombreFinal = limpio;
    let contador = 1;
    while (nombresUsados.has(nombreFinal.toLowerCase())) {
        nombreFinal = `${limpio.substring(0, 22)} (${contador})`;
        contador++;
    }
    nombresUsados.add(nombreFinal.toLowerCase());
    return nombreFinal;
}

// Estilo de bordes estándar
const bordesFinos = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
};

const bordesEncabezado = {
    top: { style: 'medium', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
};

// Formato de celda de alerta según el texto de velocidad
function aplicarEstiloAlerta(celda, textoVelocidad) {
    celda.alignment = { vertical: 'middle', horizontal: 'center' };
    const texto = String(textoVelocidad || '');

    if (texto.includes('Rápido')) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        celda.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF15803D' } };
    } else if (texto.includes('límite') || texto.includes('limite')) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
        celda.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF854D0E' } };
    } else if (texto.includes('mejorar')) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        celda.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
    } else {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        celda.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF475569' } };
    }
}

// Incrustar imagen en hoja de cálculo de forma segura
function incrustarImagen(wb, ws, base64Data, col, row, width = 500, height = 260) {
    if (!base64Data || typeof base64Data !== 'string') return null;
    const base64Limpio = base64Data.replace(/^data:image\/\w+;base64,/, '');
    if (!base64Limpio) return null;

    try {
        const imageId = wb.addImage({
            base64: base64Limpio,
            extension: 'png'
        });
        ws.addImage(imageId, {
            tl: { col: col, row: row },
            ext: { width: width, height: height }
        });
        return imageId;
    } catch (err) {
        console.error('Error al incrustar imagen en Excel:', err.message);
        return null;
    }
}

/**
 * Función auxiliar para construir la sección de Dashboards Principales
 */
function construirSeccionDashboardsPrincipales(ws, wb, metricas, graficas, filaInicio = 1) {
    const toleranciaPct = metricas.toleranciaPct || 25;
    const fechaReporte = new Date().toLocaleString('es-MX', {
        dateStyle: 'full',
        timeStyle: 'medium'
    });

    // 1. Título
    ws.mergeCells(`A${filaInicio}:G${filaInicio + 1}`);
    const tit = ws.getCell(`A${filaInicio}`);
    tit.value = 'SISTEMA DE TICKETS - REPORTE DE DASHBOARDS PRINCIPALES';
    tit.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    tit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    tit.alignment = { vertical: 'middle', horizontal: 'center' };

    // 2. Subtítulo con nota de domingos
    const filaSub = filaInicio + 2;
    ws.mergeCells(`A${filaSub}:G${filaSub}`);
    const sub = ws.getCell(`A${filaSub}`);
    sub.value = `Generado el: ${fechaReporte} | Margen de Alerta: ${toleranciaPct}% | 🚫 Días Domingo no laborables: Excluidos 100% de los cálculos (0 hrs)`;
    sub.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF334155' } };
    sub.alignment = { vertical: 'middle', horizontal: 'left' };

    // 3. Tarjetas KPI
    const kpis = [
        { titulo: 'TOTAL TICKETS', valor: metricas.totalTickets, color: 'FF3B82F6' },
        { titulo: 'NUEVOS', valor: metricas.estatusStats.nuevos, color: 'FF17A2B8' },
        { titulo: 'EN PROCESO', valor: metricas.estatusStats.enProceso, color: 'FFF59E0B' },
        { titulo: 'PENDIENTES', valor: metricas.estatusStats.pendientes, color: 'FFEF4444' },
        { titulo: 'RESUELTOS', valor: metricas.estatusStats.resueltos, color: 'FF10B981' },
        { titulo: 'PROM. RESOLUCIÓN', valor: metricas.tiemposGlobalesStats.promGlobalResTexto || 'N/A', color: 'FF0284C7' },
        { titulo: 'PROM. 1RA ATENCIÓN', valor: metricas.tiemposGlobalesStats.promGlobalAtenTexto || 'N/A', color: 'FF10B981' }
    ];

    const filaKpiTit = filaInicio + 4;
    const filaKpiVal = filaInicio + 5;
    const rowKpiTit = ws.getRow(filaKpiTit);
    const rowKpiVal = ws.getRow(filaKpiVal);
    rowKpiTit.height = 20;
    rowKpiVal.height = 26;

    kpis.forEach((kpi, idx) => {
        const colIdx = idx + 1;
        const cTit = rowKpiTit.getCell(colIdx);
        cTit.value = kpi.titulo;
        cTit.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
        cTit.alignment = { vertical: 'middle', horizontal: 'center' };
        cTit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cTit.border = bordesFinos;

        const cVal = rowKpiVal.getCell(colIdx);
        cVal.value = kpi.valor;
        cVal.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: kpi.color } };
        cVal.alignment = { vertical: 'middle', horizontal: 'center' };
        cVal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        cVal.border = bordesFinos;
    });

    // 4. Tabla Comparativa de Categorías
    const filaTitTabla = filaInicio + 7;
    ws.mergeCells(`A${filaTitTabla}:G${filaTitTabla}`);
    const titTablaCat = ws.getCell(`A${filaTitTabla}`);
    titTablaCat.value = '📋 Comparativa General de Categorías y Métricas de Resolución';
    titTablaCat.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    titTablaCat.alignment = { vertical: 'middle', horizontal: 'left' };

    const filaHeaderCat = filaInicio + 8;
    const headersCat = ['Categoría', 'Tickets Registrados', 'Resueltos', 'Prom. Resolución', '1ra Atención', 'Tiempo Meta Base', 'Velocidad / Alerta'];
    const rowHeaderCat = ws.getRow(filaHeaderCat);
    rowHeaderCat.height = 22;
    headersCat.forEach((h, i) => {
        const celda = rowHeaderCat.getCell(i + 1);
        celda.value = h;
        celda.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
        celda.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : (i >= 5 ? 'center' : 'right') };
        celda.border = bordesEncabezado;
    });

    let fCat = filaHeaderCat + 1;
    metricas.categoriasStats.forEach(cat => {
        const row = ws.getRow(fCat);
        row.height = 20;

        row.getCell(1).value = cat.nombre;
        row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
        row.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true };

        row.getCell(2).value = cat.total;
        row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };

        row.getCell(3).value = cat.resueltosCount;
        row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };

        row.getCell(4).value = cat.promResolucionTexto;
        row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell(4).font = { name: 'Segoe UI', size: 10, bold: cat.resueltosCount > 0 };

        row.getCell(5).value = cat.promAtencionTexto;
        row.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };

        row.getCell(6).value = `${cat.tiempoBaseHoras} hrs`;
        row.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };

        const cAlerta = row.getCell(7);
        cAlerta.value = cat.velocidadTexto;
        aplicarEstiloAlerta(cAlerta, cat.velocidadTexto);

        for (let c = 1; c <= 7; c++) {
            if (c !== 7) row.getCell(c).border = bordesFinos;
        }

        fCat++;
    });

    // 5. Gráficas Principales Incrustadas
    const filaGraficas = fCat + 1;
    if (graficas.estatus) {
        incrustarImagen(wb, ws, graficas.estatus, 0, filaGraficas - 1, 470, 260);
    }
    if (graficas.prioridad) {
        incrustarImagen(wb, ws, graficas.prioridad, 4, filaGraficas - 1, 470, 260);
    }

    let filaFin = filaGraficas + 14;
    if (graficas.tiemposResolucion) {
        incrustarImagen(wb, ws, graficas.tiemposResolucion, 0, filaFin - 1, 750, 300);
        filaFin += 16;
    }

    return filaFin;
}

/**
 * Genera el libro de Excel profesional con datos, tablas y gráficas incrustadas
 * @param {Object} params
 * @param {string} params.tipo 'general' | 'principales' | 'categoria'
 * @param {string|number} [params.categoriaId] ID de la categoría (si tipo === 'categoria')
 * @param {Object} [params.graficas] Imágenes en base64 de las gráficas
 * @param {Object} params.metricas Métricas completas calculadas
 * @returns {Promise<Buffer>} Buffer del archivo XLSX
 */
async function generarExcelDashboards({ tipo, categoriaId, graficas = {}, metricas }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema de Tickets';
    wb.lastModifiedBy = 'Administrador del Sistema';
    wb.created = new Date();
    wb.modified = new Date();

    const toleranciaPct = metricas.toleranciaPct || 25;
    const fechaReporte = new Date().toLocaleString('es-MX', {
        dateStyle: 'full',
        timeStyle: 'medium'
    });

    const nombresHojasUsados = new Set();

    if (tipo === 'principales') {
        // ==========================================
        // 1. REPORTE DE DASHBOARDS PRINCIPALES
        // ==========================================
        const wsMain = wb.addWorksheet('Dashboards Principales');
        wsMain.views = [{ showGridLines: true }];

        wsMain.columns = [
            { width: 30 },
            { width: 20 },
            { width: 14 },
            { width: 20 },
            { width: 18 },
            { width: 18 },
            { width: 20 }
        ];

        construirSeccionDashboardsPrincipales(wsMain, wb, metricas, graficas, 1);

    } else if (tipo === 'general') {
        // =========================================================================
        // 2. REPORTE GENERAL CONSOLIDADO COMPLETO (TODOS LOS DASHBOARDS Y TABLAS)
        // =========================================================================

        // --- HOJA 1 MAESTRA: REPORTE GENERAL COMPLETO (CONTIENE TODO EN UN SOLO EXCEL) ---
        const wsGeneral = wb.addWorksheet('Reporte General Completo');
        wsGeneral.views = [{ showGridLines: true }];
        nombresHojasUsados.add('reporte general completo');

        wsGeneral.columns = [
            { width: 32 }, // Subcategoría / Categoría
            { width: 20 }, // Tickets Registrados
            { width: 14 }, // Resueltos
            { width: 20 }, // Prom. Resolución
            { width: 18 }, // 1ra Atención
            { width: 18 }, // Tiempo Meta Base
            { width: 20 }  // Velocidad / Alerta
        ];

        // Construir Sección 1: Dashboards Principales
        let filaSiguiente = construirSeccionDashboardsPrincipales(wsGeneral, wb, metricas, graficas, 1);

        // Separador de Sección 2
        filaSiguiente += 2;
        wsGeneral.mergeCells(`A${filaSiguiente}:G${filaSiguiente + 1}`);
        const bannerSec2 = wsGeneral.getCell(`A${filaSiguiente}`);
        bannerSec2.value = '📁 DESGLOSE DETALLADO DE TODAS LAS CATEGORÍAS Y SUBCATEGORÍAS';
        bannerSec2.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
        bannerSec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        bannerSec2.alignment = { vertical: 'middle', horizontal: 'center' };

        filaSiguiente += 3;

        // Construir cada categoría dentro de la misma hoja maestra
        metricas.categoriasStats.forEach(cat => {
            // Título de la Categoría
            wsGeneral.mergeCells(`A${filaSiguiente}:G${filaSiguiente}`);
            const celdaTitCat = wsGeneral.getCell(`A${filaSiguiente}`);
            celdaTitCat.value = `🏷️ CATEGORÍA: ${cat.nombre.toUpperCase()}`;
            celdaTitCat.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            celdaTitCat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
            celdaTitCat.alignment = { vertical: 'middle', horizontal: 'left' };
            wsGeneral.getRow(filaSiguiente).height = 24;

            // Fila de resumen de métricas de la categoría
            filaSiguiente++;
            wsGeneral.mergeCells(`A${filaSiguiente}:G${filaSiguiente}`);
            const celdaSubCat = wsGeneral.getCell(`A${filaSiguiente}`);
            celdaSubCat.value = `Tickets: ${cat.total} | Resueltos: ${cat.resueltosCount} | Prom. Resolución: ${cat.promResolucionTexto} | 1ra Atención: ${cat.promAtencionTexto} | Más rápido: ${cat.minResolucionTexto} | Meta Base: ${cat.tiempoBaseHoras} hrs | Estatus: ${cat.velocidadTexto}`;
            celdaSubCat.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF334155' } };
            celdaSubCat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            celdaSubCat.alignment = { vertical: 'middle', horizontal: 'left' };
            wsGeneral.getRow(filaSiguiente).height = 20;

            // Encabezados de subcategorías
            filaSiguiente += 2;
            const rowHSub = wsGeneral.getRow(filaSiguiente);
            rowHSub.height = 22;
            ['Subcategoría', 'Tickets Registrados', 'Resueltos', 'Prom. Resolución', '1ra Atención', 'Tiempo Meta Base', 'Velocidad / Alerta'].forEach((h, i) => {
                const c = rowHSub.getCell(i + 1);
                c.value = h;
                c.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : (i >= 5 ? 'center' : 'right') };
                c.border = bordesEncabezado;
            });

            filaSiguiente++;
            if (cat.subcategorias.length === 0 && cat.sinSubCount === 0) {
                const rowVacia = wsGeneral.getRow(filaSiguiente);
                wsGeneral.mergeCells(`A${filaSiguiente}:G${filaSiguiente}`);
                rowVacia.getCell(1).value = 'No hay subcategorías registradas en esta categoría.';
                rowVacia.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
                rowVacia.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
                filaSiguiente++;
            } else {
                cat.subcategorias.forEach(sub => {
                    const r = wsGeneral.getRow(filaSiguiente);
                    r.height = 20;

                    r.getCell(1).value = sub.nombre;
                    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                    r.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true };

                    r.getCell(2).value = sub.count;
                    r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(3).value = sub.resueltosCount;
                    r.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(4).value = sub.promResolucionTexto;
                    r.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
                    r.getCell(4).font = { name: 'Segoe UI', size: 10, bold: sub.resueltosCount > 0 };

                    r.getCell(5).value = sub.promAtencionTexto;
                    r.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(6).value = `${sub.tiempoBaseHoras} hrs`;
                    r.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };

                    const cAlerta = r.getCell(7);
                    cAlerta.value = sub.velocidadTexto;
                    aplicarEstiloAlerta(cAlerta, sub.velocidadTexto);

                    for (let col = 1; col <= 7; col++) {
                        if (col !== 7) r.getCell(col).border = bordesFinos;
                    }

                    filaSiguiente++;
                });

                if (cat.sinSubCount > 0) {
                    const rSin = wsGeneral.getRow(filaSiguiente);
                    rSin.height = 20;
                    rSin.getCell(1).value = 'General / Sin especificar';
                    rSin.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
                    rSin.getCell(2).value = cat.sinSubCount;
                    rSin.getCell(3).value = '-';
                    rSin.getCell(4).value = cat.sinSubPromResolucionTexto || 'N/A';
                    rSin.getCell(5).value = cat.sinSubPromAtencionTexto || 'N/A';
                    rSin.getCell(6).value = '-';
                    rSin.getCell(7).value = 'En atención';
                    aplicarEstiloAlerta(rSin.getCell(7), 'En atención');
                    for (let col = 1; col <= 7; col++) {
                        if (col !== 7) rSin.getCell(col).border = bordesFinos;
                    }
                    filaSiguiente++;
                }
            }

            // Incrustar las dos gráficas de esta categoría (Pastel de subcategorías y Barras de tiempos)
            const catGraficas = (graficas.categorias && graficas.categorias[cat.id]) ? graficas.categorias[cat.id] : {};
            const filaGraficasCat = filaSiguiente + 1;

            if (catGraficas.distribucion) {
                incrustarImagen(wb, wsGeneral, catGraficas.distribucion, 0, filaGraficasCat - 1, 460, 250);
            }
            if (catGraficas.tiempos) {
                incrustarImagen(wb, wsGeneral, catGraficas.tiempos, 4, filaGraficasCat - 1, 480, 250);
            }

            filaSiguiente = filaGraficasCat + 15;
        });

        // --- HOJAS SECUNDARIAS: UNA PESTAÑA DEDICADA PARA CADA CATEGORÍA ---
        metricas.categoriasStats.forEach(cat => {
            const nombreHoja = limpiarNombreHoja(cat.nombre, nombresHojasUsados);
            const wsCat = wb.addWorksheet(nombreHoja);
            wsCat.views = [{ showGridLines: true }];

            // Título de la Categoría
            wsCat.mergeCells('A1:G2');
            const titCat = wsCat.getCell('A1');
            titCat.value = `CATEGORÍA: ${cat.nombre.toUpperCase()}`;
            titCat.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
            titCat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
            titCat.alignment = { vertical: 'middle', horizontal: 'center' };

            // Subtítulo con métricas de cabecera
            wsCat.mergeCells('A3:G3');
            const subCat = wsCat.getCell('A3');
            subCat.value = `Tickets: ${cat.total} | Resueltos: ${cat.resueltosCount} | Prom. Resolución: ${cat.promResolucionTexto} | 1ra Atención: ${cat.promAtencionTexto} | Ticket más rápido: ${cat.minResolucionTexto} | 🚫 Domingos excluidos`;
            subCat.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF334155' } };
            subCat.alignment = { vertical: 'middle', horizontal: 'left' };

            // Encabezados de tabla de subcategorías
            const rowHSub = wsCat.getRow(5);
            rowHSub.height = 22;
            ['Subcategoría', 'Tickets Registrados', 'Resueltos', 'Prom. Resolución', '1ra Atención', 'Tiempo Meta Base', 'Velocidad / Alerta'].forEach((h, i) => {
                const c = rowHSub.getCell(i + 1);
                c.value = h;
                c.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : (i >= 5 ? 'center' : 'right') };
                c.border = bordesEncabezado;
            });

            let fSub = 6;
            if (cat.subcategorias.length === 0 && cat.sinSubCount === 0) {
                const rowVacia = wsCat.getRow(fSub);
                wsCat.mergeCells(`A${fSub}:G${fSub}`);
                rowVacia.getCell(1).value = 'No hay incidencias ni subcategorías reportadas.';
                rowVacia.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
                rowVacia.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
                fSub++;
            } else {
                cat.subcategorias.forEach(sub => {
                    const r = wsCat.getRow(fSub);
                    r.height = 20;

                    r.getCell(1).value = sub.nombre;
                    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                    r.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true };

                    r.getCell(2).value = sub.count;
                    r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(3).value = sub.resueltosCount;
                    r.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(4).value = sub.promResolucionTexto;
                    r.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
                    r.getCell(4).font = { name: 'Segoe UI', size: 10, bold: sub.resueltosCount > 0 };

                    r.getCell(5).value = sub.promAtencionTexto;
                    r.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };

                    r.getCell(6).value = `${sub.tiempoBaseHoras} hrs`;
                    r.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };

                    const cAlerta = r.getCell(7);
                    cAlerta.value = sub.velocidadTexto;
                    aplicarEstiloAlerta(cAlerta, sub.velocidadTexto);

                    for (let col = 1; col <= 7; col++) {
                        if (col !== 7) r.getCell(col).border = bordesFinos;
                    }

                    fSub++;
                });

                if (cat.sinSubCount > 0) {
                    const rSin = wsCat.getRow(fSub);
                    rSin.height = 20;
                    rSin.getCell(1).value = 'General / Sin especificar';
                    rSin.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
                    rSin.getCell(2).value = cat.sinSubCount;
                    rSin.getCell(3).value = '-';
                    rSin.getCell(4).value = cat.sinSubPromResolucionTexto || 'N/A';
                    rSin.getCell(5).value = cat.sinSubPromAtencionTexto || 'N/A';
                    rSin.getCell(6).value = '-';
                    rSin.getCell(7).value = 'En atención';
                    aplicarEstiloAlerta(rSin.getCell(7), 'En atención');
                    for (let col = 1; col <= 7; col++) {
                        if (col !== 7) rSin.getCell(col).border = bordesFinos;
                    }
                    fSub++;
                }
            }

            wsCat.columns = [
                { width: 32 },
                { width: 20 },
                { width: 14 },
                { width: 20 },
                { width: 18 },
                { width: 18 },
                { width: 20 }
            ];

            // Incrustar gráficas de esta categoría (Pastel de subcategorías y Barras de tiempos)
            const catGraficas = (graficas.categorias && graficas.categorias[cat.id]) ? graficas.categorias[cat.id] : {};
            const filaGraficasCat = fSub + 2;

            if (catGraficas.distribucion) {
                incrustarImagen(wb, wsCat, catGraficas.distribucion, 0, filaGraficasCat - 1, 460, 260);
            }
            if (catGraficas.tiempos) {
                incrustarImagen(wb, wsCat, catGraficas.tiempos, 4, filaGraficasCat - 1, 480, 260);
            }
        });

    } else {
        // ==========================================
        // 3. REPORTE INDIVIDUAL DE CATEGORÍA
        // ==========================================
        const cat = metricas.categoriasStats.find(c => String(c.id) === String(categoriaId)) || metricas.categoriasStats[0];
        if (!cat) {
            throw new Error('La categoría solicitada no fue encontrada.');
        }

        const nombreHoja = limpiarNombreHoja(cat.nombre, nombresHojasUsados);
        const wsCat = wb.addWorksheet(nombreHoja);
        wsCat.views = [{ showGridLines: true }];

        // Título Principal
        wsCat.mergeCells('A1:G2');
        const tit = wsCat.getCell('A1');
        tit.value = `SISTEMA DE TICKETS - REPORTE DE CATEGORÍA: ${cat.nombre.toUpperCase()}`;
        tit.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
        tit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
        tit.alignment = { vertical: 'middle', horizontal: 'center' };

        // Subtítulo con nota de domingos
        wsCat.mergeCells('A3:G3');
        const sub = wsCat.getCell('A3');
        sub.value = `Generado el: ${fechaReporte} | Margen de Alerta: ${toleranciaPct}% | 🚫 Días Domingo: Totalmente excluidos (0 hrs)`;
        sub.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF334155' } };
        sub.alignment = { vertical: 'middle', horizontal: 'left' };

        // Tarjetas KPI de la Categoría (Fila 5 y 6)
        const kpisCat = [
            { titulo: 'TICKETS REGISTRADOS', valor: cat.total, color: 'FF3B82F6' },
            { titulo: 'RESUELTOS', valor: cat.resueltosCount, color: 'FF10B981' },
            { titulo: 'PROMEDIO RESOLUCIÓN', valor: cat.promResolucionTexto, color: 'FF0284C7' },
            { titulo: '1RA ATENCIÓN', valor: cat.promAtencionTexto, color: 'FF10B981' },
            { titulo: 'TICKET MÁS RÁPIDO', valor: cat.minResolucionTexto, color: 'FF16A34A' },
            { titulo: 'TIEMPO BASE PROMEDIO', valor: `${cat.tiempoBaseHoras} hrs`, color: 'FF64748B' },
            { titulo: 'VELOCIDAD GENERAL', valor: cat.velocidadTexto, color: 'FF0F172A' }
        ];

        const rowKpiTit = wsCat.getRow(5);
        const rowKpiVal = wsCat.getRow(6);
        rowKpiTit.height = 20;
        rowKpiVal.height = 26;

        kpisCat.forEach((kpi, idx) => {
            const colIdx = idx + 1;
            const cTit = rowKpiTit.getCell(colIdx);
            cTit.value = kpi.titulo;
            cTit.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FF475569' } };
            cTit.alignment = { vertical: 'middle', horizontal: 'center' };
            cTit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            cTit.border = bordesFinos;

            const cVal = rowKpiVal.getCell(colIdx);
            cVal.value = kpi.valor;
            cVal.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: kpi.color } };
            cVal.alignment = { vertical: 'middle', horizontal: 'center' };
            cVal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            cVal.border = bordesFinos;
        });

        // Título de la tabla
        wsCat.mergeCells('A8:G8');
        const titTabla = wsCat.getCell('A8');
        titTabla.value = '📁 Desglose y Tiempos de Resolución por Subcategoría';
        titTabla.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        titTabla.alignment = { vertical: 'middle', horizontal: 'left' };

        // Encabezados
        const rowH = wsCat.getRow(9);
        rowH.height = 22;
        ['Subcategoría', 'Tickets Registrados', 'Resueltos', 'Prom. Resolución', '1ra Atención', 'Tiempo Meta Base', 'Velocidad / Alerta'].forEach((h, i) => {
            const c = rowH.getCell(i + 1);
            c.value = h;
            c.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
            c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : (i >= 5 ? 'center' : 'right') };
            c.border = bordesEncabezado;
        });

        let f = 10;
        if (cat.subcategorias.length === 0 && cat.sinSubCount === 0) {
            const rowVacia = wsCat.getRow(f);
            wsCat.mergeCells(`A${f}:G${f}`);
            rowVacia.getCell(1).value = 'No hay subcategorías registradas para esta categoría.';
            rowVacia.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
            rowVacia.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
            f++;
        } else {
            cat.subcategorias.forEach(sub => {
                const r = wsCat.getRow(f);
                r.height = 20;

                r.getCell(1).value = sub.nombre;
                r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                r.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true };

                r.getCell(2).value = sub.count;
                r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };

                r.getCell(3).value = sub.resueltosCount;
                r.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };

                r.getCell(4).value = sub.promResolucionTexto;
                r.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
                r.getCell(4).font = { name: 'Segoe UI', size: 10, bold: sub.resueltosCount > 0 };

                r.getCell(5).value = sub.promAtencionTexto;
                r.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };

                r.getCell(6).value = `${sub.tiempoBaseHoras} hrs`;
                r.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };

                const cAlerta = r.getCell(7);
                cAlerta.value = sub.velocidadTexto;
                aplicarEstiloAlerta(cAlerta, sub.velocidadTexto);

                for (let col = 1; col <= 7; col++) {
                    if (col !== 7) r.getCell(col).border = bordesFinos;
                }

                f++;
            });

            if (cat.sinSubCount > 0) {
                const rSin = wsCat.getRow(f);
                rSin.height = 20;
                rSin.getCell(1).value = 'General / Sin especificar';
                rSin.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
                rSin.getCell(2).value = cat.sinSubCount;
                rSin.getCell(3).value = '-';
                rSin.getCell(4).value = cat.sinSubPromResolucionTexto || 'N/A';
                rSin.getCell(5).value = cat.sinSubPromAtencionTexto || 'N/A';
                rSin.getCell(6).value = '-';
                rSin.getCell(7).value = 'En atención';
                aplicarEstiloAlerta(rSin.getCell(7), 'En atención');
                for (let col = 1; col <= 7; col++) {
                    if (col !== 7) rSin.getCell(col).border = bordesFinos;
                }
                f++;
            }
        }

        wsCat.columns = [
            { width: 32 },
            { width: 20 },
            { width: 14 },
            { width: 20 },
            { width: 18 },
            { width: 18 },
            { width: 20 }
        ];

        // Incrustar gráficas de la categoría
        const filaGraficas = f + 2;
        if (graficas.distribucion) {
            incrustarImagen(wb, wsCat, graficas.distribucion, 0, filaGraficas - 1, 480, 270);
        }
        if (graficas.tiempos) {
            incrustarImagen(wb, wsCat, graficas.tiempos, 4, filaGraficas - 1, 500, 270);
        }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return buffer;
}

module.exports = {
    generarExcelDashboards,
    limpiarNombreHoja
};
