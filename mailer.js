const nodemailer = require('nodemailer');
const db = require('./database');

// Obtener configuración SMTP
function obtenerConfig(callback) {
    db.get('SELECT * FROM config_correo WHERE id = 1', (err, config) => {
        if (err || !config) {
            return callback(null, null);
        }
        callback(null, config);
    });
}

// Crear transportador Nodemailer optimizado para correo corporativo de Grupo CDM (puerto 2525 / 25 / 587)
function crearTransportador(config) {
    if (!config) {
        return null;
    }

    const host = (config.smtp_host && config.smtp_host.trim()) ? config.smtp_host.trim() : 'mail.grupo-cdm.mx';
    const port = parseInt(config.smtp_port) || 2525;

    const transportOpts = {
        host: host,
        port: port,
        secure: port === 465,
        tls: {
            rejectUnauthorized: false
        }
    };

    // Solo enviamos auth si hay contraseña explícita y no es el relay interno de grupo-cdm (o si se configuró externamente)
    if (config.password_remitente && config.password_remitente.trim() && host !== 'mail.grupo-cdm.mx') {
        transportOpts.auth = {
            user: (config.email_remitente || '').trim(),
            pass: config.password_remitente.trim()
        };
    }

    return nodemailer.createTransport(transportOpts);
}

// Determinar el remitente (permite que cualquier administrador activo sea el remitente)
function resolverRemitente(config, adminRemitente = null) {
    let email = 'sistemas1@grupo-cdm.mx';
    let nombre = 'Mesa de ayuda de TI';

    if (adminRemitente && adminRemitente.email) {
        email = adminRemitente.email.trim();
        nombre = adminRemitente.nombre ? `${adminRemitente.nombre.trim()} - Mesa de Ayuda TI` : (config?.nombre_remitente || 'Mesa de ayuda de TI');
    } else if (config && config.email_remitente && config.email_remitente.trim()) {
        email = config.email_remitente.trim();
        nombre = config.nombre_remitente ? config.nombre_remitente.trim() : 'Mesa de ayuda de TI';
    }

    return { email, nombre };
}

// Reemplazar etiquetas {variable} en el texto
function reemplazarVariables(plantilla, variables) {
    if (!plantilla) return '';
    let resultado = plantilla;

    for (const [clave, valor] of Object.entries(variables)) {
        const regex = new RegExp(`\\{${clave}\\}`, 'gi');
        resultado = resultado.replace(regex, valor !== null && valor !== undefined ? valor : '');
    }

    return resultado;
}

// Generar versión HTML para correos
function generarHtml(asunto, cuerpoTexto, datos, remitente = null) {
    const textoSeguro = cuerpoTexto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    const nombreRemitente = remitente ? remitente.nombre : 'Mesa de ayuda de TI';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f9; margin: 0; padding: 20px; color: #1e293b; }
            .mail-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .mail-header { background-color: #0284c7; color: #ffffff; padding: 18px 24px; }
            .mail-header h1 { margin: 0; font-size: 18px; font-weight: bold; }
            .mail-body { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
            .ticket-badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 13px; margin-bottom: 12px; }
            .mail-footer { background-color: #f8fafc; padding: 14px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
        </style>
    </head>
    <body>
        <div class="mail-container">
            <div class="mail-header">
                <h1>${nombreRemitente}</h1>
            </div>
            <div class="mail-body">
                <div class="ticket-badge">Ticket #${datos.id || ''}</div>
                <div style="font-size: 14px; line-height: 1.6;">
                    ${textoSeguro}
                </div>
            </div>
            <div class="mail-footer">
                Mensaje generado automáticamente por el Sistema de Tickets Grupo CDM.<br>
                Remitente: ${remitente ? remitente.email : 'sistemas1@grupo-cdm.mx'}
            </div>
        </div>
    </body>
    </html>
    `;
}

// 1. Enviar notificación de NUEVO TICKET a los administradores
function notificarNuevoTicketAdmin(ticketId, datosTicket, opciones = {}) {
    obtenerConfig((errConf, config) => {
        if (!config || !config.activo) {
            console.log('[Correo] Envío de correos desactivado o no configurado.');
            return;
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            console.log('[Correo] Credenciales de correo no configuradas.');
            return;
        }

        const remitente = resolverRemitente(config, opciones.adminRemitente);

        // Obtener correos de todos los administradores activos
        db.all("SELECT email, nombre FROM usuarios WHERE rol = 'admin' AND deleted_at IS NULL", [], (errAdmin, admins) => {
            if (errAdmin || !admins || admins.length === 0) {
                console.log('[Correo] No hay administradores registrados para notificar.');
                return;
            }

            // Filtrar correos válidos. Si el relay es interno sin contraseña, priorizar dominios corporativos @grupo-cdm.mx
            const esRelayInterno = (!config.password_remitente || !config.password_remitente.trim()) && (config.smtp_host || '').includes('grupo-cdm');
            const adminsValidos = admins.filter(a => {
                if (!a.email || !a.email.trim()) return false;
                if (esRelayInterno) {
                    return a.email.toLowerCase().endsWith('@grupo-cdm.mx');
                }
                return true;
            });

            if (adminsValidos.length === 0) {
                console.log('[Correo] No hay administradores con correo corporativo activo para recibir la notificación.');
                return;
            }

            // Obtener plantilla para nuevo ticket
            db.get('SELECT * FROM plantillas_correo WHERE clave = "ticket_nuevo" OR clave = "nuevo_ticket_admin"', [], (errPl, plantilla) => {
                if (!plantilla) {
                    plantilla = {
                        asunto: '[Ticket #{id}] Nuevo Ticket Reportado: {titulo}',
                        cuerpo: 'Se ha creado el ticket #{id} por {usuario} ({email_usuario}).\n\nTipo de Falla: {tipo_falla}\nPrioridad: {prioridad}\n\nDescripción:\n{descripcion}'
                    };
                }

                const fechaFormateada = new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

                const variables = {
                    id: ticketId,
                    titulo: datosTicket.titulo || '',
                    usuario: datosTicket.usuario_nombre || 'Usuario',
                    email_usuario: datosTicket.usuario_email || '',
                    tipo_falla: datosTicket.tipo_falla || 'General',
                    subcategoria: datosTicket.subcategoria || 'Sin subcategoría',
                    prioridad: datosTicket.prioridad || 'Media',
                    descripcion: datosTicket.descripcion || '',
                    estatus: datosTicket.estatus || 'Nuevo ticket',
                    fecha: fechaFormateada,
                    creado_por_admin: datosTicket.creado_por_admin || '',
                    creado_por: datosTicket.creado_por_admin ? `(Levantado por: ${datosTicket.creado_por_admin})` : ''
                };

                const asuntoFinal = reemplazarVariables(plantilla.asunto, variables);
                const cuerpoTextoFinal = reemplazarVariables(plantilla.cuerpo, variables);
                const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables, remitente);

                // Enviar individualmente a cada administrador para garantizar entrega sin rechazos por lote
                adminsValidos.forEach(admin => {
                    const mailOptions = {
                        from: `"${remitente.nombre}" <${remitente.email}>`,
                        replyTo: remitente.email,
                        to: admin.email.trim(),
                        subject: asuntoFinal,
                        text: cuerpoTextoFinal,
                        html: cuerpoHtmlFinal
                    };

                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error(`[Correo] Error al enviar notificación de nuevo ticket a ${admin.email}:`, error.message);
                        } else {
                            console.log(`[Correo] Notificación de nuevo ticket #${ticketId} enviada con éxito a ${admin.email}:`, info.messageId);
                        }
                    });
                });
            });
        });
    });
}

// 1.1 Enviar notificación al USUARIO confirmando que se levantó su ticket (y copia al admin que lo levantó)
function notificarTicketCreadoUsuario(ticketId, datosTicket, opciones = {}) {
    if (!datosTicket || !datosTicket.usuario_email) {
        // Fallback: consultar el ticket y usuario en la base de datos si falta el correo
        db.get(
            `SELECT tickets.*, COALESCE(usuarios.nombre, tickets.creado_por_admin, 'Usuario') AS usuario_nombre, usuarios.email AS usuario_email
             FROM tickets 
             LEFT JOIN usuarios ON tickets.usuario_id = usuarios.id
             WHERE tickets.id = ?`,
            [ticketId],
            (err, ticketRow) => {
                if (!err && ticketRow && ticketRow.usuario_email) {
                    notificarTicketCreadoUsuario(ticketId, ticketRow, opciones);
                } else {
                    console.error(`[Correo] No se pudo encontrar correo de destino para el ticket #${ticketId}`);
                }
            }
        );
        return;
    }

    obtenerConfig((errConf, config) => {
        if (!config || !config.activo) {
            console.log('[Correo] Notificación de creación omitida: servicio de correo inactivo.');
            return;
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            console.log('[Correo] No se pudo crear el transportador de correo.');
            return;
        }

        const remitente = resolverRemitente(config, opciones.adminRemitente);

        db.get('SELECT * FROM plantillas_correo WHERE clave = "ticket_creado_usuario"', [], (errPl, plantilla) => {
            if (!plantilla) {
                plantilla = {
                    asunto: '[Ticket #{id}] Se ha registrado tu ticket de soporte: {titulo}',
                    cuerpo: 'Hola {usuario},\n\nTe confirmamos que se ha registrado un nuevo ticket de soporte a tu nombre:\n\n• Número de Ticket: #{id}\n• Título: {titulo}\n• Tipo de Falla: {tipo_falla}\n• Subcategoría / Dispositivo: {subcategoria}\n• Nivel de Prioridad: {prioridad}\n• Estatus: {estatus}\n• Fecha de reporte: {fecha}\n\nDescripción del problema:\n{descripcion}\n\nEl equipo de soporte de sistemas ya tiene conocimiento de tu incidencia.'
                };
            }

            const fechaFormateada = new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

            const variables = {
                id: ticketId,
                titulo: datosTicket.titulo || '',
                usuario: datosTicket.usuario_nombre || 'Usuario',
                email_usuario: datosTicket.usuario_email || '',
                tipo_falla: datosTicket.tipo_falla || 'General',
                subcategoria: datosTicket.subcategoria || 'Sin subcategoría',
                prioridad: datosTicket.prioridad || 'Media',
                descripcion: datosTicket.descripcion || '',
                estatus: datosTicket.estatus || 'Nuevo ticket',
                fecha: fechaFormateada,
                creado_por_admin: datosTicket.creado_por_admin || '',
                creado_por: datosTicket.creado_por_admin ? `(Levantado por soporte: ${datosTicket.creado_por_admin})` : ''
            };

            const asuntoFinal = reemplazarVariables(plantilla.asunto, variables);
            const cuerpoTextoFinal = reemplazarVariables(plantilla.cuerpo, variables);
            const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables, remitente);

            // 1. Enviar correo al usuario solicitante
            const mailOptionsUsuario = {
                from: `"${remitente.nombre}" <${remitente.email}>`,
                replyTo: remitente.email,
                to: datosTicket.usuario_email.trim(),
                subject: asuntoFinal,
                text: cuerpoTextoFinal,
                html: cuerpoHtmlFinal
            };

            transporter.sendMail(mailOptionsUsuario, (error, info) => {
                if (error) {
                    console.error(`[Correo] Error al enviar confirmación de ticket #${ticketId} a ${datosTicket.usuario_email}:`, error.message);
                } else {
                    console.log(`[Correo] Confirmación de ticket #${ticketId} enviada exitosamente a ${datosTicket.usuario_email}:`, info.messageId);
                }
            });

            // 2. Si el ticket fue levantado por un administrador, enviar también copia de confirmación al administrador
            const adminEmailCreador = (opciones.adminRemitente && opciones.adminRemitente.email) 
                ? opciones.adminRemitente.email.trim() 
                : (datosTicket.creado_por_admin_email ? datosTicket.creado_por_admin_email.trim() : null);

            if (adminEmailCreador && adminEmailCreador.toLowerCase() !== (datosTicket.usuario_email || '').trim().toLowerCase()) {
                const asuntoAdmin = `[Ticket #${ticketId}] Confirmación: Has levantado el ticket para ${datosTicket.usuario_nombre || 'Usuario'}: ${datosTicket.titulo || ''}`;
                const cuerpoAdminTexto = `Hola ${opciones.adminRemitente?.nombre || datosTicket.creado_por_admin || 'Administrador'},\n\nTe confirmamos que has levantado exitosamente el ticket de soporte #${ticketId} para el usuario ${datosTicket.usuario_nombre} (${datosTicket.usuario_email}):\n\n• Número de Ticket: #${ticketId}\n• Título: ${datosTicket.titulo}\n• Tipo de Falla: ${datosTicket.tipo_falla}\n• Subcategoría: ${datosTicket.subcategoria || 'Sin subcategoría'}\n• Prioridad: ${datosTicket.prioridad}\n• Estatus: ${datosTicket.estatus || 'Nuevo ticket'}\n• Fecha de reporte: ${fechaFormateada}\n\nDescripción del problema:\n${datosTicket.descripcion}\n\nEl usuario ya ha recibido su notificación automática de confirmación.`;
                const cuerpoAdminHtml = generarHtml(asuntoAdmin, cuerpoAdminTexto, variables, remitente);

                transporter.sendMail({
                    from: `"${remitente.nombre}" <${remitente.email}>`,
                    replyTo: remitente.email,
                    to: adminEmailCreador,
                    subject: asuntoAdmin,
                    text: cuerpoAdminTexto,
                    html: cuerpoAdminHtml
                }, (errorAdmin, infoAdmin) => {
                    if (errorAdmin) {
                        console.error(`[Correo] Error al enviar confirmación de ticket #${ticketId} al administrador creador (${adminEmailCreador}):`, errorAdmin.message);
                    } else {
                        console.log(`[Correo] Confirmación de ticket #${ticketId} enviada exitosamente al admin creador (${adminEmailCreador}):`, infoAdmin.messageId);
                    }
                });
            }
        });
    });
}

// Generar clave única de plantilla para un estatus
function generarClavePlantillaEstatus(nombreEstatus) {
    const limpio = (nombreEstatus || '').trim();
    if (limpio === 'En proceso') return 'estatus_en_proceso';
    if (limpio === 'Pendiente') return 'estatus_pendiente';
    if (limpio === 'Pendiente por cliente') return 'estatus_pendiente_cliente';
    if (limpio === 'Resuelto') return 'estatus_resuelto';
    const slug = limpio
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return 'estatus_custom_' + (slug || 'personalizado');
}

// Crear automáticamente la plantilla de correo cuando se crea o activa correo en un estatus personalizado
function asegurarPlantillaEstatusPersonalizado(nombreEstatus, callback) {
    const limpio = (nombreEstatus || '').trim();
    if (!limpio) return callback && callback();
    const clave = generarClavePlantillaEstatus(limpio);
    if (['estatus_en_proceso', 'estatus_pendiente', 'estatus_resuelto'].includes(clave)) {
        return callback && callback();
    }

    const tituloSeccion = `Notificación al Usuario (Estatus: ${limpio})`;
    const destinatarioTipo = 'Usuario solicitante del Ticket y Administradores (CC)';
    const asunto = `🔄 [Ticket #{id}] Actualización de estatus (${limpio}): {titulo}`;
    const cuerpo = `Hola {usuario},\n\nTe informamos que tu ticket #{id} ("{titulo}") ha cambiado al estatus: ${limpio}.\n\n• Número de Ticket: #{id}\n• Estatus actual: {estatus}\n• Tipo de Falla: {tipo_falla}\n• Prioridad: {prioridad}\n• Detalle / Seguimiento: {detalle}\n• Fecha: {fecha}\n\nEl equipo de Sistemas TI continúa dando seguimiento a tu solicitud.`;

    db.run(
        `INSERT OR IGNORE INTO plantillas_correo (clave, titulo_seccion, destinatario_tipo, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)`,
        [clave, tituloSeccion, destinatarioTipo, asunto, cuerpo],
        (err) => {
            if (callback) callback(err, clave);
        }
    );
}

// Eliminar plantilla automática cuando se elimina un estatus personalizado
function eliminarPlantillaEstatusPersonalizado(nombreEstatus, callback) {
    const limpio = (nombreEstatus || '').trim();
    if (!limpio) return callback && callback();
    const clave = generarClavePlantillaEstatus(limpio);
    if (!clave.startsWith('estatus_custom_')) return callback && callback();
    db.run('DELETE FROM plantillas_correo WHERE clave = ?', [clave], (err) => {
        if (callback) callback(err);
    });
}

// 2. Enviar notificación de CAMBIO DE ESTATUS al usuario del ticket
function notificarCambioEstatusUsuario(ticketId, nuevoEstatus, datosResolucion = {}, opciones = {}) {
    obtenerConfig((errConf, config) => {
        if (!config || !config.activo) {
            console.log('[Correo] Envío de correos desactivado o no configurado.');
            return;
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            console.log('[Correo] Credenciales de correo no configuradas.');
            return;
        }

        const remitente = resolverRemitente(config, opciones.adminRemitente);

        // Consultar configuración de todos los estatus para revisar interruptores y equivalencia "En proceso"
        db.all('SELECT * FROM estatus_tickets', [], (errEst, listaEstatus) => {
            const mapaEstatus = {};
            (listaEstatus || []).forEach(e => {
                if (e && e.nombre) mapaEstatus[e.nombre.trim().toLowerCase()] = e;
            });

            const estActualCfg = mapaEstatus[(nuevoEstatus || '').trim().toLowerCase()] || null;

            // Verificar interruptor: si el estatus tiene desactivado el envío de correo, no enviar nada
            if (estActualCfg && estActualCfg.notificar_correo !== undefined && estActualCfg.notificar_correo !== null && Number(estActualCfg.notificar_correo) === 0) {
                console.log(`[Correo] Notificación omitida: el estatus "${nuevoEstatus}" tiene desactivado el envío de correo.`);
                return;
            }

            // Función auxiliar para saber si un estatus envía correo tipo "En proceso" al cliente
            const equivaleAEnProcesoParaCliente = (nombreEst) => {
                if (!nombreEst) return false;
                const norm = nombreEst.trim().toLowerCase();
                if (norm === 'en proceso') return true;
                const cfg = mapaEstatus[norm];
                if (cfg && !cfg.es_sistema && cfg.modo_correo === 'en_proceso') return true;
                return false;
            };

            const estatusPrevioDirecto = opciones.estatusAnterior || null;

            const continuarConEstatusPrevio = (estatusPrevio) => {
                // Regla: Evitar que lleguen 2 correos de "En proceso" seguidos
                if (estatusPrevio && equivaleAEnProcesoParaCliente(estatusPrevio) && equivaleAEnProcesoParaCliente(nuevoEstatus)) {
                    console.log(`[Correo] Se evitó enviar un segundo correo consecutivo de "En proceso" para el Ticket #${ticketId} (${estatusPrevio} ➔ ${nuevoEstatus}).`);
                    return;
                }

                // Consultar información del ticket y del usuario que lo creó
                const queryTicket = `
                    SELECT tickets.*, 
                           COALESCE(usuarios.nombre, tickets.creado_por_admin, 'Usuario') AS usuario_nombre, 
                           usuarios.email AS usuario_email
                    FROM tickets
                    LEFT JOIN usuarios ON tickets.usuario_id = usuarios.id
                    WHERE tickets.id = ?
                `;

                db.get(queryTicket, [ticketId], (errTick, ticket) => {
                    if (errTick || !ticket) {
                        console.log('[Correo] No se encontró el ticket.');
                        return;
                    }

                    // Consultar a todos los administradores activos para incluirlos en copia (CC)
                    db.all("SELECT email, nombre FROM usuarios WHERE rol = 'admin' AND deleted_at IS NULL", [], (errAdmins, admins) => {
                        const esRelayInterno = (!config.password_remitente || !config.password_remitente.trim()) && (config.smtp_host || '').includes('grupo-cdm');
                        const emailsAdmins = (admins || [])
                            .map(a => (a.email || '').trim().toLowerCase())
                            .filter(e => {
                                if (!e) return false;
                                if (esRelayInterno) return e.endsWith('@grupo-cdm.mx') || e.endsWith('@grupocdm.mx');
                                return true;
                            });

                        const soloAdmins = Boolean(estActualCfg && !estActualCfg.es_sistema && estActualCfg.modo_correo === 'solo_admins');
                        const destinatarioUsuario = (!soloAdmins && ticket.usuario_email && ticket.usuario_email.trim()) ? ticket.usuario_email.trim() : null;
                        const emailUsuarioLower = destinatarioUsuario ? destinatarioUsuario.toLowerCase() : '';

                        // Lista CC con todos los administradores (sin duplicar el correo del solicitante)
                        const listaCcAdmins = Array.from(new Set(emailsAdmins)).filter(e => e !== emailUsuarioLower);

                        // Destinatario principal: el usuario solicitante, o el primer admin si es solo_admins o no tiene correo
                        const destinatarioPrincipal = destinatarioUsuario || (listaCcAdmins.length > 0 ? listaCcAdmins[0] : null);
                        if (!destinatarioPrincipal) {
                            console.log('[Correo] No se encontró destinatario ni administradores para enviar cambio de estatus.');
                            return;
                        }

                        // Seleccionar clave de plantilla según el estatus y su modo configurado
                        let clavePlantilla = 'estatus_en_proceso';
                        let estatusVisibleCorreo = nuevoEstatus;

                        if (nuevoEstatus === 'En proceso') {
                            clavePlantilla = 'estatus_en_proceso';
                        } else if (nuevoEstatus === 'Pendiente') {
                            clavePlantilla = 'estatus_pendiente';
                        } else if (nuevoEstatus === 'Pendiente por cliente') {
                            clavePlantilla = 'estatus_pendiente_cliente';
                        } else if (nuevoEstatus === 'Resuelto') {
                            clavePlantilla = 'estatus_resuelto';
                        } else if (estActualCfg && estActualCfg.modo_correo === 'en_proceso') {
                            clavePlantilla = 'estatus_en_proceso';
                            estatusVisibleCorreo = 'En proceso';
                        } else {
                            clavePlantilla = generarClavePlantillaEstatus(nuevoEstatus);
                        }

                        db.get('SELECT * FROM plantillas_correo WHERE clave = ?', [clavePlantilla], (errPl, plantilla) => {
                            if (!plantilla) {
                                plantilla = {
                                    asunto: `🔄 [Ticket #{id}] Actualización de estatus (${estatusVisibleCorreo}): {titulo}`,
                                    cuerpo: `Hola {usuario},\n\nTe informamos que tu ticket #{id} ("{titulo}") ha cambiado al estatus: ${estatusVisibleCorreo}.\n\n• Número de Ticket: #{id}\n• Estatus actual: {estatus}\n• Tipo de Falla: {tipo_falla}\n• Prioridad: {prioridad}\n• Detalle / Seguimiento: {detalle}\n• Fecha: {fecha}\n\nEl equipo de Sistemas TI continúa dando seguimiento a tu solicitud.`
                                };
                            }

                            const fechaFormateada = new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

                            const variables = {
                                id: ticket.id,
                                titulo: ticket.titulo || '',
                                usuario: ticket.usuario_nombre || 'Usuario',
                                email_usuario: ticket.usuario_email || '',
                                tipo_falla: ticket.tipo_falla || 'General',
                                subcategoria: ticket.subcategoria || 'Sin subcategoría',
                                prioridad: ticket.prioridad || 'Media',
                                estatus: estatusVisibleCorreo,
                                detalle: datosResolucion.detalle_intervencion || datosResolucion.comentario_resolucion || ticket.comentario_resolucion || 'En seguimiento por Sistemas TI',
                                fecha: fechaFormateada,
                                tecnico: datosResolucion.tecnico_resolvio || ticket.tecnico_resolvio || 'Personal técnico de sistemas',
                                categoria_resolucion: datosResolucion.categoria_resolucion || ticket.categoria_resolucion || 'N/A',
                                comentario_resolucion: datosResolucion.comentario_resolucion || ticket.comentario_resolucion || 'Sin comentarios adicionales',
                                equipo_nuevo: datosResolucion.tipo_equipo_nuevo || ticket.tipo_equipo_nuevo || 'N/A',
                                modelo_nuevo: datosResolucion.modelo_nuevo || ticket.modelo_nuevo || 'N/A',
                                numero_serie_nuevo: datosResolucion.numero_serie_nuevo || ticket.numero_serie_nuevo || 'N/A',
                                motivo_pendiente_cliente: datosResolucion.motivo_pendiente_cliente || ticket.motivo_pendiente_cliente || '',
                                fecha_programada_cliente: datosResolucion.fecha_programada_cliente || ticket.fecha_programada_cliente || ''
                            };

                            const asuntoFinal = reemplazarVariables(plantilla.asunto, variables);
                            const cuerpoTextoFinal = reemplazarVariables(plantilla.cuerpo, variables);
                            const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables, remitente);

                            const ccFinal = (destinatarioPrincipal === destinatarioUsuario && listaCcAdmins.length > 0)
                                ? listaCcAdmins
                                : (listaCcAdmins.slice(1).length > 0 ? listaCcAdmins.slice(1) : undefined);

                            const mailOptions = {
                                from: `"${remitente.nombre}" <${remitente.email}>`,
                                replyTo: remitente.email,
                                to: destinatarioPrincipal,
                                cc: ccFinal,
                                subject: asuntoFinal,
                                text: cuerpoTextoFinal,
                                html: cuerpoHtmlFinal
                            };

                            transporter.sendMail(mailOptions, (error, info) => {
                                if (error) {
                                    console.error(`[Correo] Error al enviar correo de cambio de estatus a ${destinatarioPrincipal} (CC: ${listaCcAdmins.join(', ')}):`, error.message);
                                } else {
                                    console.log(`[Correo] Notificación de cambio de estatus enviada a ${destinatarioPrincipal} con copia a [${listaCcAdmins.join(', ')}]:`, info.messageId);
                                }
                            });
                        });
                    });
                });
            };

            if (estatusPrevioDirecto) {
                continuarConEstatusPrevio(estatusPrevioDirecto);
            } else {
                // Consultar el penúltimo registro en historial_tickets si no se pasó explícitamente
                db.all('SELECT estatus FROM historial_tickets WHERE ticket_id = ? ORDER BY id DESC LIMIT 2', [ticketId], (errH, rowsH) => {
                    const prev = (rowsH && rowsH.length > 1) ? rowsH[1].estatus : null;
                    continuarConEstatusPrevio(prev);
                });
            }
        });
    });
}

// 3. Enviar correo de prueba para validar credenciales SMTP (permite especificar remitente)
function enviarCorreoPrueba(destinatario, adminRemitente = null, callback = null) {
    if (typeof adminRemitente === 'function') {
        callback = adminRemitente;
        adminRemitente = null;
    }

    obtenerConfig((errConf, config) => {
        if (!config) {
            return callback && callback(new Error('No se pudo cargar la configuración de correo.'));
        }

        const remitente = resolverRemitente(config, adminRemitente);
        const transporter = crearTransportador(config);
        if (!transporter) {
            return callback && callback(new Error('No se pudo inicializar la conexión con el servidor SMTP.'));
        }

        const mailOptions = {
            from: `"${remitente.nombre}" <${remitente.email}>`,
            replyTo: remitente.email,
            to: destinatario,
            subject: `Correo de Prueba - Enviado por ${remitente.nombre}`,
            text: `¡Hola!\n\nEste es un correo de prueba enviado desde tu Sistema de Tickets por el administrador remitente ${remitente.nombre} (${remitente.email}).\nEl servidor de correo (${config.smtp_host}:${config.smtp_port}) está operando correctamente.`,
            html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f9;">
                <div style="background: white; padding: 25px; border-radius: 8px; border-left: 5px solid #10b981; max-width: 500px; margin: auto;">
                    <h2 style="color: #10b981; margin-top: 0;">Conexión de Correo Exitosa</h2>
                    <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                        ¡Excelente! El sistema de notificaciones está vinculado y listo para enviar correos automáticos.
                    </p>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 15px 0; font-size: 13px; color: #475569;">
                        <strong>Administrador Remitente:</strong> ${remitente.nombre}<br>
                        <strong>Correo Remitente:</strong> ${remitente.email}<br>
                        <strong>Servidor:</strong> ${config.smtp_host} (Puerto ${config.smtp_port})
                    </div>
                    <p style="font-size: 12px; color: #64748b; margin-top: 10px;">
                        Todos los administradores del sistema están habilitados como remitentes automáticos.
                    </p>
                </div>
            </div>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return callback && callback(error);
            }
            callback && callback(null, info);
        });
    });
}

// 4. Enviar correo personalizado redactado por un administrador a uno o varios usuarios (con soporte de adjuntos y copia CC a admins)
function enviarCorreoPersonalizado(datosCorreo, callback) {
    obtenerConfig((errConf, config) => {
        if (!config) {
            return callback && callback(new Error('No se pudo cargar la configuración de correo.'));
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            return callback && callback(new Error('No se pudo inicializar el transportador SMTP.'));
        }

        const remitente = resolverRemitente(config, datosCorreo.adminRemitente);
        const destinatariosRaw = Array.isArray(datosCorreo.destinatarios) ? datosCorreo.destinatarios : [datosCorreo.destinatarios];
        const destinatariosLimpios = Array.from(new Set(
            destinatariosRaw
                .map(d => (d || '').trim())
                .filter(Boolean)
        ));

        if (destinatariosLimpios.length === 0) {
            return callback && callback(new Error('Debes seleccionar al menos un destinatario válido.'));
        }

        const asunto = (datosCorreo.asunto || '').trim();
        const mensaje = (datosCorreo.mensaje || '').trim();
        const copiarAdmins = Boolean(datosCorreo.copiarAdmins);
        const archivos = Array.isArray(datosCorreo.archivos) ? datosCorreo.archivos : [];

        const textoSeguro = mensaje
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        const htmlPersonalizado = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f9; margin: 0; padding: 20px; color: #1e293b; }
                .mail-container { max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                .mail-header { background-color: #0284c7; color: #ffffff; padding: 18px 24px; }
                .mail-header h1 { margin: 0; font-size: 18px; font-weight: bold; }
                .mail-body { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
                .mail-badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 12px; margin-bottom: 14px; }
                .mail-footer { background-color: #f8fafc; padding: 14px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
            </style>
        </head>
        <body>
            <div class="mail-container">
                <div class="mail-header">
                    <h1>${remitente.nombre}</h1>
                </div>
                <div class="mail-body">
                    <div class="mail-badge">Comunicado de Sistemas TI • Grupo CDM</div>
                    <h2 style="margin: 0 0 14px 0; font-size: 16px; color: #0f172a;">${asunto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>
                    <div style="font-size: 14px; line-height: 1.65; color: #1e293b;">
                        ${textoSeguro}
                    </div>
                </div>
                <div class="mail-footer">
                    Enviado desde el Sistema de Tickets TI - Grupo CDM<br>
                    Remitente: ${remitente.nombre} (&lt;${remitente.email}&gt;)
                </div>
            </div>
        </body>
        </html>
        `;

        const attachments = archivos.map(f => ({
            filename: f.originalname,
            content: f.buffer,
            contentType: f.mimetype
        }));

        const enviarConCc = (listaCc) => {
            const mailOptions = {
                from: `"${remitente.nombre}" <${remitente.email}>`,
                replyTo: remitente.email,
                to: destinatariosLimpios,
                cc: (listaCc && listaCc.length > 0) ? listaCc : undefined,
                subject: asunto,
                text: mensaje,
                html: htmlPersonalizado,
                attachments: attachments.length > 0 ? attachments : undefined
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    return callback && callback(error);
                }
                callback && callback(null, info, { totalDestinatarios: destinatariosLimpios.length, cc: listaCc || [] });
            });
        };

        if (copiarAdmins) {
            db.all("SELECT email FROM usuarios WHERE rol = 'admin' AND deleted_at IS NULL", [], (errAdm, admins) => {
                const esRelayInterno = (!config.password_remitente || !config.password_remitente.trim()) && (config.smtp_host || '').includes('grupo-cdm');
                const destLowerSet = new Set(destinatariosLimpios.map(d => d.toLowerCase()));
                const listaCcAdmins = Array.from(new Set(
                    (admins || [])
                        .map(a => (a.email || '').trim().toLowerCase())
                        .filter(e => {
                            if (!e) return false;
                            if (destLowerSet.has(e)) return false;
                            if (esRelayInterno) return e.endsWith('@grupo-cdm.mx') || e.endsWith('@grupocdm.mx');
                            return true;
                        })
                ));
                enviarConCc(listaCcAdmins);
            });
        } else {
            enviarConCc([]);
        }
    });
}

module.exports = {
    obtenerConfig,
    notificarNuevoTicketAdmin,
    notificarTicketCreadoUsuario,
    notificarCambioEstatusUsuario,
    enviarCorreoPrueba,
    enviarCorreoPersonalizado,
    generarClavePlantillaEstatus,
    asegurarPlantillaEstatusPersonalizado,
    eliminarPlantillaEstatusPersonalizado,
    resolverRemitente
};
