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

// Crear transportador Nodemailer optimizado para Outlook / Office 365
function crearTransportador(config) {
    if (!config || !config.email_remitente) {
        return null;
    }

    const host = (config.smtp_host && config.smtp_host.trim()) ? config.smtp_host.trim() : 'smtp-mail.outlook.com';
    const port = parseInt(config.smtp_port) || 587;

    const transportOpts = {
        host: host,
        port: port,
        secure: port === 465,
        tls: {
            ciphers: 'SSLv3',
            rejectUnauthorized: false
        }
    };

    // Si tiene contraseña configurada, se usa autenticación SMTP.
    // Si no tiene contraseña (ej. Direct Send en puerto 25), se conecta sin auth.
    if (config.password_remitente && config.password_remitente.trim()) {
        transportOpts.auth = {
            user: config.email_remitente.trim(),
            pass: config.password_remitente.trim()
        };
    }

    return nodemailer.createTransport(transportOpts);
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

// Generar versión HTML bonita para Outlook y otros clientes
function generarHtml(asunto, cuerpoTexto, datos) {
    const textoSeguro = cuerpoTexto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

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
                <h1>Sistema de Tickets y Soporte</h1>
            </div>
            <div class="mail-body">
                <div class="ticket-badge">Ticket #${datos.id || ''}</div>
                <div style="font-size: 14px; line-height: 1.6;">
                    ${textoSeguro}
                </div>
            </div>
            <div class="mail-footer">
                Este es un mensaje automático generado por el Sistema de Tickets. Por favor no respondas a este correo.
            </div>
        </div>
    </body>
    </html>
    `;
}

// 1. Enviar notificación de NUEVO TICKET a los administradores
function notificarNuevoTicketAdmin(ticketId, datosTicket) {
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
                const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables);

                const mailOptions = {
                    from: `"${config.nombre_remitente || 'Sistema de Tickets'}" <${config.email_remitente}>`,
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
function notificarTicketCreadoUsuario(ticketId, datosTicket) {
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
            const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables);

            const mailOptions = {
                from: `"${config.nombre_remitente || 'Sistema de Tickets'}" <${config.email_remitente}>`,
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
function notificarCambioEstatusUsuario(ticketId, nuevoEstatus, datosResolucion = {}) {
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

        // Consultar información del ticket y del usuario que lo creó
        const queryTicket = `
            SELECT tickets.*, usuarios.nombre AS usuario_nombre, usuarios.email AS usuario_email
            FROM tickets
            JOIN usuarios ON tickets.usuario_id = usuarios.id
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
                const cuerpoHtmlFinal = generarHtml(asuntoFinal, cuerpoTextoFinal, variables);

                const mailOptions = {
                    from: `"${config.nombre_remitente || 'Sistema de Tickets'}" <${config.email_remitente}>`,
                    to: ticket.usuario_email,
                    subject: asuntoFinal,
                    text: cuerpoTextoFinal,
                    html: cuerpoHtmlFinal
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error(`[Correo] Error al enviar correo de cambio de estatus a ${ticket.usuario_email}:`, error.message);
                    } else {
                        console.log(`[Correo] Notificación enviada con éxito a ${ticket.usuario_email}:`, info.messageId);
                    }
                });
            });
        });
    });
}

// 3. Enviar correo de prueba para validar credenciales SMTP
function enviarCorreoPrueba(destinatario, callback) {
    obtenerConfig((errConf, config) => {
        if (!config) {
            return callback(new Error('No se pudo cargar la configuración de correo.'));
        }

        if (!config.email_remitente) {
            return callback(new Error('Debes ingresar al menos tu correo remitente antes de enviar una prueba.'));
        }

        const transporter = crearTransportador(config);
        if (!transporter) {
            return callback(new Error('No se pudo inicializar la conexión con el servidor SMTP.'));
        }

        const mailOptions = {
            from: `"${config.nombre_remitente || 'Sistema de Tickets'}" <${config.email_remitente}>`,
            to: destinatario,
            subject: '✅ Correo de Prueba - Conexión de Outlook Exitosa',
            text: '¡Hola!\n\nEste es un correo de prueba enviado desde tu Sistema de Tickets. La configuración de Outlook / SMTP está funcionando correctamente.',
            html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f9;">
                <div style="background: white; padding: 25px; border-radius: 8px; border-left: 5px solid #10b981; max-width: 500px; margin: auto;">
                    <h2 style="color: #10b981; margin-top: 0;">✅ Conexión Exitosa</h2>
                    <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                        ¡Excelente! Tu cuenta de Outlook está vinculada y lista para enviar notificaciones automáticas de tickets y cambios de estatus.
                    </p>
                    <p style="font-size: 12px; color: #64748b; margin-top: 15px;">
                        Remitente: <strong>${config.email_remitente}</strong><br>
                        Servidor: <strong>${config.smtp_host}</strong> (Puerto ${config.smtp_port})
                    </p>
                </div>
            </div>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return callback(error);
            }
            callback(null, info);
        });
    });
}

module.exports = {
    obtenerConfig,
    notificarNuevoTicketAdmin,
    notificarTicketCreadoUsuario,
    notificarCambioEstatusUsuario,
    enviarCorreoPrueba
};
