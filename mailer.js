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
        db.all('SELECT email, nombre FROM usuarios WHERE rol = "admin" AND deleted_at IS NULL', [], (errAdmin, admins) => {
            if (errAdmin || !admins || admins.length === 0) {
                console.log('[Correo] No hay administradores registrados para notificar.');
                return;
            }

            const adminEmails = admins.map(a => a.email).filter(Boolean);
            if (adminEmails.length === 0) return;

            // Obtener plantilla para nuevo ticket
            db.get('SELECT * FROM plantillas_correo WHERE clave = "ticket_nuevo" OR clave = "nuevo_ticket_admin"', [], (errPl, plantilla) => {
                if (!plantilla) {
                    plantilla = {
                        asunto: '🔔 [Ticket #{id}] Nuevo Ticket Reportado: {titulo}',
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

                const mailOptions = {
                    from: `"${remitente.nombre}" <${remitente.email}>`,
                    replyTo: remitente.email,
                    to: adminEmails.join(','),
                    subject: asuntoFinal,
                    text: cuerpoTextoFinal,
                    html: cuerpoHtmlFinal
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error('[Correo] Error al enviar notificación a administradores:', error.message);
                    } else {
                        console.log('[Correo] Notificación de nuevo ticket enviada con éxito a los admins:', info.messageId);
                    }
                });
            });
        });
    });
}

// 1.1 Enviar notificación al USUARIO confirmando que se levantó su ticket
function notificarTicketCreadoUsuario(ticketId, datosTicket, opciones = {}) {
    if (!datosTicket || !datosTicket.usuario_email) {
        return;
    }

    obtenerConfig((errConf, config) => {
        if (!config || !config.activo) {
            return;
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            return;
        }

        const remitente = resolverRemitente(config, opciones.adminRemitente);

        db.get('SELECT * FROM plantillas_correo WHERE clave = "ticket_creado_usuario"', [], (errPl, plantilla) => {
            if (!plantilla) {
                plantilla = {
                    asunto: '📋 [Ticket #{id}] Se ha registrado tu ticket de soporte: {titulo}',
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

            const mailOptions = {
                from: `"${remitente.nombre}" <${remitente.email}>`,
                replyTo: remitente.email,
                to: datosTicket.usuario_email,
                subject: asuntoFinal,
                text: cuerpoTextoFinal,
                html: cuerpoHtmlFinal
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error(`[Correo] Error al enviar confirmación de ticket a ${datosTicket.usuario_email}:`, error.message);
                } else {
                    console.log(`[Correo] Confirmación enviada exitosamente a ${datosTicket.usuario_email}:`, info.messageId);
                }
            });
        });
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

        // Consultar información del ticket y del usuario que lo creó (LEFT JOIN para no perder datos si usuario difiere)
        const queryTicket = `
            SELECT tickets.*, 
                   COALESCE(usuarios.nombre, tickets.creado_por_admin, 'Usuario') AS usuario_nombre, 
                   usuarios.email AS usuario_email
            FROM tickets
            LEFT JOIN usuarios ON tickets.usuario_id = usuarios.id
            WHERE tickets.id = ?
        `;

        db.get(queryTicket, [ticketId], (errTick, ticket) => {
            if (errTick || !ticket || !ticket.usuario_email) {
                console.log('[Correo] No se encontró el ticket o el usuario no tiene correo registrado.');
                return;
            }

            // Seleccionar clave de plantilla según el estatus
            let clavePlantilla = 'estatus_en_proceso';
            if (nuevoEstatus === 'En proceso') {
                clavePlantilla = 'estatus_en_proceso';
            } else if (nuevoEstatus === 'Pendiente') {
                clavePlantilla = 'estatus_pendiente';
            } else if (nuevoEstatus === 'Resuelto') {
                clavePlantilla = 'estatus_resuelto';
            }

            db.get('SELECT * FROM plantillas_correo WHERE clave = ?', [clavePlantilla], (errPl, plantilla) => {
                if (!plantilla) {
                    plantilla = {
                        asunto: `[Ticket #{id}] Actualización de estatus: ${nuevoEstatus}`,
                        cuerpo: `Hola {usuario},\n\nTu ticket #{id} ("{titulo}") ha cambiado de estatus a: ${nuevoEstatus}.`
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
                    estatus: nuevoEstatus,
                    fecha: fechaFormateada,
                    tecnico: datosResolucion.tecnico_resolvio || ticket.tecnico_resolvio || 'Personal técnico de sistemas',
                    categoria_resolucion: datosResolucion.categoria_resolucion || ticket.categoria_resolucion || 'N/A',
                    comentario_resolucion: datosResolucion.comentario_resolucion || ticket.comentario_resolucion || 'Sin comentarios adicionales',
                    equipo_nuevo: datosResolucion.tipo_equipo_nuevo || ticket.tipo_equipo_nuevo || 'N/A',
                    modelo_nuevo: datosResolucion.modelo_nuevo || ticket.modelo_nuevo || 'N/A',
                    numero_serie_nuevo: datosResolucion.numero_serie_nuevo || ticket.numero_serie_nuevo || 'N/A'
                };

                const asuntoFinal = reemplazarVariables(plantilla.asunto, variables);
                const cuerpoTextoFinal = reemplazarVariables(plantilla.cuerpo, variables);
                const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables, remitente);

                const mailOptions = {
                    from: `"${remitente.nombre}" <${remitente.email}>`,
                    replyTo: remitente.email,
                    to: ticket.usuario_email,
                    subject: asuntoFinal,
                    text: cuerpoTextoFinal,
                    html: cuerpoHtmlFinal
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error(`[Correo] Error al enviar correo de cambio de estatus a ${ticket.usuario_email}:`, error.message);
                    } else {
                        console.log(`[Correo] Notificación enviada con éxito desde ${remitente.email} a ${ticket.usuario_email}:`, info.messageId);
                    }
                });
            });
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
            subject: `✅ Correo de Prueba - Enviado por ${remitente.nombre}`,
            text: `¡Hola!\n\nEste es un correo de prueba enviado desde tu Sistema de Tickets por el administrador remitente ${remitente.nombre} (${remitente.email}).\nEl servidor de correo (${config.smtp_host}:${config.smtp_port}) está operando correctamente.`,
            html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f9;">
                <div style="background: white; padding: 25px; border-radius: 8px; border-left: 5px solid #10b981; max-width: 500px; margin: auto;">
                    <h2 style="color: #10b981; margin-top: 0;">✅ Conexión de Correo Exitosa</h2>
                    <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                        ¡Excelente! El sistema de notificaciones está vinculado y listo para enviar correos automáticos.
                    </p>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 15px 0; font-size: 13px; color: #475569;">
                        👤 <strong>Administrador Remitente:</strong> ${remitente.nombre}<br>
                        📧 <strong>Correo Remitente:</strong> ${remitente.email}<br>
                        🌐 <strong>Servidor:</strong> ${config.smtp_host} (Puerto ${config.smtp_port})
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

module.exports = {
    obtenerConfig,
    notificarNuevoTicketAdmin,
    notificarTicketCreadoUsuario,
    notificarCambioEstatusUsuario,
    enviarCorreoPrueba,
    resolverRemitente
};
