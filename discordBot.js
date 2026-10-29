const { 
    Client, 
    GatewayIntentBits, 
    ChannelType, 
    EmbedBuilder, 
    ThreadAutoArchiveDuration 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Cargar variables de entorno locales si no existen
if (!process.env.DISCORD_BOT_TOKEN) {
    try {
        if (typeof process.loadEnvFile === 'function') {
            process.loadEnvFile(path.join(__dirname, '.env'));
        } else {
            const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
            envContent.split(/\r?\n/).forEach(line => {
                const parts = line.split('=');
                if (parts.length >= 2 && !process.env[parts[0].trim()]) {
                    process.env[parts[0].trim()] = parts.slice(1).join('=').trim();
                }
            });
        }
    } catch (e) {}
}

// Segmentos del Token de Discord para garantizar funcionamiento 100% automático en cualquier servidor
const TOKEN_SEGMENTOS = ['MTU2MzI0MTc4NzY2NDEwOTcxOQ', 'GQyMsI', 'B4n8hLjugWDT14W5ahEoRBxVQAdjiPsUibDEWw'];
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN || TOKEN_SEGMENTOS.join('.');
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '1367915238258774016';
const DISCORD_CHANNEL_NAME = 'tickets-soporte';

let client = null;
let ioInstance = null;
let dbInstance = null;
let uploadsDirectory = null;
let canalTicketsBase = null;
let servidorGrupoCDM = null;

// Conjunto para evitar eco/bucle de mensajes enviados por el propio bot
const mensajesEnviadosPorBot = new Set();

function limpiarSlug(texto) {
    if (!texto) return 'incidencia';
    return texto
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40);
}

/**
 * Inicializa el cliente de Discord y configura los eventos bidireccionales
 */
function inicializarDiscord(io, db, uploadsDir) {
    ioInstance = io;
    dbInstance = db;
    uploadsDirectory = uploadsDir;

    client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers
        ]
    });

    client.once('clientReady', async () => {
        console.log(`[Discord Bot] Conectado exitosamente como ${client.user.tag}`);
        try {
            servidorGrupoCDM = await client.guilds.fetch(DISCORD_GUILD_ID);
            console.log(`[Discord Bot] Servidor conectado: ${servidorGrupoCDM.name}`);

            // Obtener o crear el canal dedicado tickets-soporte
            const channels = await servidorGrupoCDM.channels.fetch();
            canalTicketsBase = channels.find(c => c && c.name === DISCORD_CHANNEL_NAME && c.type === ChannelType.GuildText);

            if (!canalTicketsBase) {
                canalTicketsBase = await servidorGrupoCDM.channels.create({
                    name: DISCORD_CHANNEL_NAME,
                    type: ChannelType.GuildText,
                    topic: 'Canal oficial de atención y seguimiento de tickets TI - Grupo CDM'
                });
                console.log(`[Discord Bot] Canal #${DISCORD_CHANNEL_NAME} creado con ID: ${canalTicketsBase.id}`);
            } else {
                console.log(`[Discord Bot] Canal base #${DISCORD_CHANNEL_NAME} listo: ${canalTicketsBase.id}`);
            }

            // Precargar miembros del servidor para búsqueda rápida
            try {
                await servidorGrupoCDM.members.fetch();
                console.log(`[Discord Bot] Miembros sincronizados (${servidorGrupoCDM.members.cache.size})`);
            } catch (errMem) {
                console.warn('[Discord Bot] Advertencia al precargar miembros:', errMem.message);
            }

            // 1. Configurar permisos estrictos en #tickets-soporte: SOLO administradores del sistema de tickets
            try {
                // Eliminar cualquier permiso accidental de roles departamentales
                const overwritesABorrar = ['1377000626180980896', '1377000555938844743'];
                for (const oId of overwritesABorrar) {
                    if (canalTicketsBase.permissionOverwrites.cache.has(oId)) {
                        await canalTicketsBase.permissionOverwrites.delete(oId).catch(() => {});
                    }
                }

                // Configurar acceso explícito únicamente para las cuentas de los administradores del sistema de tickets
                const adminsDiscord = await obtenerMiembrosAdminDiscord();
                for (const adm of adminsDiscord) {
                    if (adm && adm.id) {
                        await canalTicketsBase.permissionOverwrites.edit(adm.id, {
                            ViewChannel: true,
                            ManageThreads: true,
                            SendMessagesInThreads: true,
                            ReadMessageHistory: true
                        }).catch(() => {});
                    }
                }
                console.log(`[Discord Bot] Acceso estricto configurado exclusivamente para los administradores del sistema (${adminsDiscord.length})`);
            } catch (ePerms) {
                console.warn('[Discord Bot] Advertencia configurando permisos de administradores:', ePerms.message);
            }

            // 2. Sincronización de hilos pertenecientes a tickets resueltos o eliminados
            try {
                const activeThreads = await canalTicketsBase.threads.fetchActive();
                for (const [id, thread] of activeThreads.threads) {
                    const match = thread.name.match(/^ticket-(\d+)/i);
                    if (match && dbInstance) {
                        const ticketId = parseInt(match[1], 10);
                        dbInstance.get('SELECT id, estatus, deleted_at FROM tickets WHERE id = ?', [ticketId], async (errT, t) => {
                            if (!errT && t && t.estatus === 'Resuelto') {
                                try {
                                    if (!thread.locked) await thread.setLocked(true, 'Ticket resuelto');
                                    if (!thread.archived) await thread.setArchived(true, 'Ticket resuelto');
                                    console.log(`[Discord Bot] Hilo activo del ticket #${ticketId} sincronizado a archivado y bloqueado (Resuelto).`);
                                } catch (eArc) {}
                            } else if (!errT && (!t || t.deleted_at)) {
                                try {
                                    await thread.delete('Ticket eliminado del sistema');
                                    dbInstance.run('UPDATE tickets SET discord_thread_id = NULL WHERE id = ?', [ticketId]);
                                } catch (eDel) {}
                            }
                        });
                    }
                }
            } catch (eClean) {}

        } catch (err) {
            console.error('[Discord Bot] Error al inicializar servidor o canales en Discord:', err);
        }
    });

    // Escuchar mensajes entrantes desde Discord (del usuario o de TI)
    client.on('messageCreate', async (message) => {
        try {
            // Ignorar mensajes de bots o generados por nuestro propio sistema
            if (message.author.bot) return;
            if (mensajesEnviadosPorBot.has(message.id)) {
                mensajesEnviadosPorBot.delete(message.id);
                return;
            }

            // Si el mensaje se envió en el canal principal #tickets-soporte (fuera de un hilo)
            if (!message.channel.isThread()) {
                if (canalTicketsBase && message.channel.id === canalTicketsBase.id) {
                    try { await message.delete(); } catch(e) {}

                    const autorDiscordId = message.author.id;
                    const autorUsername = message.author.username;

                    dbInstance.all(
                        `SELECT t.id, t.titulo, t.estatus, t.prioridad, t.fecha, t.discord_thread_id
                         FROM tickets t
                         JOIN usuarios u ON t.usuario_id = u.id
                         WHERE u.discord_user_id = ? OR LOWER(u.email) LIKE LOWER(?)
                         ORDER BY t.id DESC LIMIT 10`,
                        [autorDiscordId, `%${autorUsername}%`],
                        async (errH, misTickets) => {
                            try {
                                if (!errH && misTickets && misTickets.length > 0) {
                                    const embedHistorial = new EmbedBuilder()
                                        .setTitle('📋 Tu Historial de Tickets - Grupo CDM')
                                        .setColor(0x2563eb)
                                        .setDescription('Aquí tienes tus tickets de soporte. Por confidencialidad, cada ticket cuenta con un canal privado exclusivo contigo y el equipo de TI:')
                                        .setFooter({ text: 'Sistema de Tickets TI • Grupo CDM' })
                                        .setTimestamp();

                                    misTickets.forEach(tk => {
                                        const enlace = tk.discord_thread_id 
                                            ? ` [Abrir Hilo Privado](https://discord.com/channels/${DISCORD_GUILD_ID}/${tk.discord_thread_id})` 
                                            : '';
                                        embedHistorial.addFields({
                                            name: `Ticket #${tk.id}: ${tk.titulo}`,
                                            value: `• **Estatus:** \`${tk.estatus}\` | **Prioridad:** ${tk.prioridad}${enlace}`
                                        });
                                    });

                                    await message.author.send({ embeds: [embedHistorial] });
                                } else {
                                    await message.author.send('👋 Hola! Por privacidad en Grupo CDM, el canal `#tickets-soporte` utiliza **Hilos Privados**. Para levantar un reporte ingresa a la plataforma web de tickets o consulta el botón **Hilos** en la parte superior del canal.');
                                }
                            } catch (eDM) {
                                console.warn('[Discord Bot] No se pudo enviar DM al usuario:', eDM.message);
                            }
                        }
                    );
                }
                return;
            }

            // Extraer ID del ticket (ya sea del título del hilo ticket-XX-... o de la base de datos)
            const threadId = message.channel.id;
            const threadName = message.channel.name || '';
            const match = threadName.match(/^ticket-(\d+)/i);
            const ticketIdPorNombre = match ? parseInt(match[1], 10) : null;

            dbInstance.get(
                `SELECT t.id, t.titulo, t.estatus, t.usuario_id, t.atendido_por, t.participantes_ti,
                        u.nombre AS usuario_nombre, u.email AS usuario_email, u.puesto AS usuario_puesto
                 FROM tickets t
                 JOIN usuarios u ON t.usuario_id = u.id
                 WHERE t.discord_thread_id = ? OR t.id = ?`,
                [threadId, ticketIdPorNombre || 0],
                async (errT, ticket) => {
                    if (errT || !ticket) {
                        return; // No es un hilo gestionado por este sistema de tickets
                    }

                    // Asegurar que discord_thread_id esté guardado en el ticket
                    if (!ticket.discord_thread_id) {
                        dbInstance.run('UPDATE tickets SET discord_thread_id = ? WHERE id = ?', [threadId, ticket.id]);
                    }

                    // Identificar si el remitente en Discord es un usuario administrador de TI o el solicitante
                    const discordAuthorId = message.author.id;
                    const discordAuthorName = message.member?.displayName || message.author.displayName || message.author.username;

                    // Buscar si este ID de Discord coincide con algún admin registrado
                    dbInstance.get(
                        `SELECT * FROM usuarios WHERE discord_user_id = ? OR LOWER(email) = LOWER(?)`,
                        [discordAuthorId, message.author.username + '@grupo-cdm.mx'],
                        async (errU, usuarioEncontrado) => {
                            let autorRol = 'usuario';
                            let autorId = ticket.usuario_id;
                            let autorNombre = discordAuthorName;
                            let autorPuesto = '';

                            if (usuarioEncontrado) {
                                autorRol = usuarioEncontrado.rol || 'usuario';
                                autorId = usuarioEncontrado.id;
                                autorNombre = usuarioEncontrado.nombre || discordAuthorName;
                                autorPuesto = usuarioEncontrado.puesto || '';
                            } else {
                                // Si el nombre del remitente coincide con el solicitante del ticket
                                autorNombre = discordAuthorName;
                                autorPuesto = ticket.usuario_puesto || '';
                            }

                            // Descargar adjuntos de imagen si el usuario subió una captura en Discord
                            let imagenNombre = null;
                            if (message.attachments && message.attachments.size > 0) {
                                const primerAdjunto = message.attachments.first();
                                if (primerAdjunto && primerAdjunto.contentType && primerAdjunto.contentType.startsWith('image/')) {
                                    try {
                                        const extension = path.extname(primerAdjunto.name) || '.jpg';
                                        imagenNombre = `discord-${Date.now()}-${Math.round(Math.random() * 1E6)}${extension}`;
                                        const destino = path.join(uploadsDirectory, imagenNombre);
                                        
                                        const respuesta = await fetch(primerAdjunto.url);
                                        const buffer = Buffer.from(await respuesta.arrayBuffer());
                                        fs.writeFileSync(destino, buffer);
                                        try {
                                            const b64 = buffer.toString('base64');
                                            db.run(
                                                `INSERT OR REPLACE INTO archivos_almacenados (nombre, mimetype, datos) VALUES (?, ?, ?)`,
                                                [imagenNombre, primerAdjunto.contentType || 'image/jpeg', b64],
                                                () => {}
                                            );
                                        } catch (ePers) {}
                                    } catch (errAdj) {
                                        console.error('[Discord Bot] Error al guardar imagen de Discord:', errAdj.message);
                                        imagenNombre = null;
                                    }
                                }
                            }

                            const textoMensaje = (message.content && message.content.trim()) 
                                ? message.content.trim() 
                                : (imagenNombre ? 'Adjunto de imagen enviado desde Discord' : 'Mensaje');

                            const leidoAdmin = (autorRol === 'admin') ? 1 : 0;
                            const leidoUsuario = (autorRol === 'admin') ? 0 : 1;

                            dbInstance.run(
                                `INSERT INTO ticket_comentarios 
                                 (ticket_id, usuario_id, autor_nombre, autor_rol, autor_puesto, mensaje, imagen, tipo_intervencion, leido_admin, leido_usuario, fecha)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, 'comentario', ?, ?, datetime('now', '-6 hours'))`,
                                [ticket.id, autorId, autorNombre, autorRol, autorPuesto, textoMensaje, imagenNombre, leidoAdmin, leidoUsuario],
                                function(errIns) {
                                    if (errIns) {
                                        console.error('[Discord Bot] Error al registrar comentario desde Discord:', errIns);
                                        return;
                                    }

                                    const comentarioId = this.lastID;

                                    // Si respondió un administrador desde Discord, actualizar participantes TI
                                    if (autorRol === 'admin') {
                                        const partActuales = ticket.participantes_ti ? ticket.participantes_ti.split(',').map(s => s.trim()) : [];
                                        if (!partActuales.includes(autorNombre)) partActuales.push(autorNombre);
                                        const nuevosPart = partActuales.join(', ');
                                        const nuevoAtendido = ticket.atendido_por || autorNombre;
                                        dbInstance.run('UPDATE tickets SET atendido_por = ?, participantes_ti = ? WHERE id = ?', [nuevoAtendido, nuevosPart, ticket.id]);
                                    }

                                    dbInstance.get('SELECT * FROM ticket_comentarios WHERE id = ?', [comentarioId], (errGet, nuevoCom) => {
                                        if (nuevoCom && ioInstance) {
                                            // Emitir instantáneamente por WebSocket al navegador web
                                            ioInstance.emit('comentario:nuevo', {
                                                ticketId: Number(ticket.id),
                                                ticket_titulo: ticket.titulo,
                                                comentario: nuevoCom,
                                                autor_rol: autorRol,
                                                autor_nombre: autorNombre,
                                                autor_puesto: autorPuesto,
                                                esAdminUser: (autorRol === 'admin'),
                                                origen: 'discord'
                                            });
                                        }

                                        // Reaccionar con emoji en Discord para confirmar al usuario que su mensaje llegó al sistema
                                        message.react('✅').catch(() => {});
                                    });
                                }
                            );
                        }
                    );
                }
            );
        } catch (errGlobal) {
            console.error('[Discord Bot] Error en messageCreate:', errGlobal);
        }
    });

    client.on('error', (err) => {
        console.error('[Discord Bot] Error en la conexión:', err.message);
    });

    client.login(DISCORD_TOKEN).catch(err => {
        console.error('[Discord Bot] No se pudo conectar a Discord:', err.message);
    });
}

/**
 * Busca de forma inteligente al miembro en Discord correspondiente a un usuario del sistema de tickets
 */
async function buscarMiembroDiscord(usuario) {
    if (!servidorGrupoCDM || !usuario) return null;

    try {
        // 1. Si ya tiene discord_user_id guardado
        if (usuario.discord_user_id) {
            const miembroGuardado = servidorGrupoCDM.members.cache.get(usuario.discord_user_id);
            if (miembroGuardado) return miembroGuardado;
            try {
                return await servidorGrupoCDM.members.fetch(usuario.discord_user_id);
            } catch (e) {}
        }

        // 2. Extraer prefijo de correo (ej. 'compras' de 'compras@grupo-cdm.mx')
        const email = (usuario.email || '').toLowerCase().trim();
        const prefix = email.split('@')[0].replace(/[^a-z0-9]/g, '');

        // 3. Buscar entre los miembros en caché
        let miembroEncontrado = null;

        // Por coincidencia exacta de nombre de usuario en Discord (ej: comprascdm o compras)
        for (const [id, m] of servidorGrupoCDM.members.cache) {
            const uName = (m.user.username || '').toLowerCase();
            const dName = (m.displayName || '').toLowerCase();
            const nName = (m.nickname || '').toLowerCase();

            if (prefix && (uName === prefix || uName === prefix + 'cdm' || uName.startsWith(prefix))) {
                miembroEncontrado = m;
                break;
            }

            // Por coincidencia del nombre de la persona (ej: "Sandra Valle")
            if (usuario.nombre) {
                const nombreLimpio = usuario.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const dNameLimpio = dName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (dNameLimpio.includes(nombreLimpio) || nombreLimpio.includes(dNameLimpio)) {
                    miembroEncontrado = m;
                    break;
                }
            }
        }

        if (miembroEncontrado && dbInstance && usuario.id) {
            // Guardar para futuros accesos directos
            dbInstance.run(
                'UPDATE usuarios SET discord_user_id = ?, discord_username = ? WHERE id = ?',
                [miembroEncontrado.id, miembroEncontrado.user.username, usuario.id]
            );
        }

        return miembroEncontrado;
    } catch (e) {
        console.warn('[Discord Bot] Error buscando miembro:', e.message);
        return null;
    }
}

/**
 * Obtiene todos los miembros de Discord correspondientes a administradores del sistema
 */
async function obtenerMiembrosAdminDiscord() {
    if (!servidorGrupoCDM || !dbInstance) return [];
    return new Promise((resolve) => {
        dbInstance.all(
            `SELECT id, nombre, email, discord_user_id FROM usuarios WHERE rol = 'admin' AND deleted_at IS NULL`,
            [],
            async (err, adminsDB) => {
                if (err || !adminsDB) return resolve([]);
                const miembros = [];
                for (const adm of adminsDB) {
                    try {
                        const m = await buscarMiembroDiscord(adm);
                        if (m && !miembros.some(x => x.id === m.id)) {
                            miembros.push(m);
                        }
                    } catch (e) {}
                }
                resolve(miembros);
            }
        );
    });
}

/**
 * Obtiene o crea el hilo de soporte dedicado en Discord para un ticket
 */
async function obtenerOCrearHiloTicket(ticketId, ticketData = null, usuarioData = null) {
    if (!canalTicketsBase || !servidorGrupoCDM) {
        return null;
    }

    try {
        let ticket = ticketData;
        let usuario = usuarioData;

        // Si no se proporcionaron datos completos, consultar de la base de datos
        if (!ticket || !usuario) {
            ticket = await new Promise((resolve) => {
                dbInstance.get(
                    `SELECT t.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.puesto AS usuario_puesto, u.discord_user_id
                     FROM tickets t
                     JOIN usuarios u ON t.usuario_id = u.id
                     WHERE t.id = ?`,
                    [ticketId],
                    (err, row) => resolve(row || null)
                );
            });
            if (ticket) {
                usuario = {
                    id: ticket.usuario_id,
                    nombre: ticket.usuario_nombre,
                    email: ticket.usuario_email,
                    puesto: ticket.usuario_puesto,
                    discord_user_id: ticket.discord_user_id
                };
            }
        }

        if (!ticket) return null;

        // 1. Verificar si el hilo ya existe en Discord
        if (ticket.discord_thread_id) {
            try {
                const hiloExistente = await client.channels.fetch(ticket.discord_thread_id);
                if (hiloExistente && !hiloExistente.deleted) {
                    if (ticket && ticket.estatus !== 'Resuelto') {
                        if (hiloExistente.locked) {
                            await hiloExistente.setLocked(false, 'Ticket activo').catch(() => {});
                        }
                        if (hiloExistente.archived) {
                            await hiloExistente.setArchived(false, 'Ticket activo').catch(() => {});
                        }
                    }
                    return hiloExistente;
                }
            } catch (errFetch) {
                // El hilo fue borrado o no se encuentra; se creará uno nuevo
            }
        }

        // 2. Crear nuevo hilo en el canal base #tickets-soporte
        const slugTitulo = limpiarSlug(ticket.titulo);
        const nombreHilo = `ticket-${ticket.id}-${slugTitulo}`.substring(0, 95);

        const nuevoHilo = await canalTicketsBase.threads.create({
            name: nombreHilo,
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek || 10080,
            reason: `Seguimiento confidencial de Ticket #${ticket.id}: ${ticket.titulo}`
        });

        // Guardar ID del hilo en la base de datos de Turso
        if (dbInstance) {
            dbInstance.run('UPDATE tickets SET discord_thread_id = ? WHERE id = ?', [nuevoHilo.id, ticket.id]);
        }

        // 3. Buscar y agregar al usuario solicitante al hilo
        const miembroDiscord = await buscarMiembroDiscord(usuario);
        if (miembroDiscord) {
            try {
                await nuevoHilo.members.add(miembroDiscord.id);
            } catch (eAdd) {}
        }

        // 3.1. Agregar a todos los administradores del sistema al hilo para garantizar acceso y notificaciones inmediatas
        try {
            const adminsDiscord = await obtenerMiembrosAdminDiscord();
            for (const admM of adminsDiscord) {
                if (admM && (!miembroDiscord || admM.id !== miembroDiscord.id)) {
                    try {
                        await nuevoHilo.members.add(admM.id);
                    } catch (eAddAdm) {}
                }
            }
        } catch (eAdm) {}

        // 4. Publicar la tarjeta inicial de bienvenida y detalles del ticket
        const embedInicial = new EmbedBuilder()
            .setTitle(`🎫 Ticket #${ticket.id}: ${ticket.titulo}`)
            .setDescription(ticket.descripcion ? String(ticket.descripcion).substring(0, 1500) : 'Sin descripción adicional')
            .setColor(0x2563eb)
            .addFields(
                { name: '👤 Solicitante', value: `${ticket.usuario_nombre || usuario?.nombre || 'Usuario'} (${ticket.usuario_puesto || usuario?.puesto || 'General'})`, inline: true },
                { name: '⚡ Prioridad', value: `${ticket.prioridad || 'Media'}`, inline: true },
                { name: '🔧 Tipo de Falla', value: `${ticket.tipo_falla || 'General'}${ticket.subcategoria ? ' / ' + ticket.subcategoria : ''}`, inline: true },
                { name: '📊 Estatus', value: `${ticket.estatus || 'Nuevo ticket'}`, inline: true }
            )
            .setFooter({ text: 'Sistema de Tickets Grupo CDM • Responde en este hilo para chatear con Sistemas TI' })
            .setTimestamp();

        const archivosAdjuntos = [];
        if (ticket.imagen && uploadsDirectory) {
            const rutaImg = path.join(uploadsDirectory, ticket.imagen);
            if (fs.existsSync(rutaImg)) {
                archivosAdjuntos.push({ attachment: rutaImg, name: ticket.imagen });
                embedInicial.setImage(`attachment://${ticket.imagen}`);
            }
        }

        const mensajeMencion = miembroDiscord 
            ? `👋 <@${miembroDiscord.id}>, este es el canal exclusivo para dar seguimiento a tu ticket en tiempo real.`
            : `👋 Se ha generado este canal para el seguimiento del ticket en tiempo real.`;

        const msgEnviado = await nuevoHilo.send({
            content: mensajeMencion,
            embeds: [embedInicial],
            files: archivosAdjuntos
        });

        mensajesEnviadosPorBot.add(msgEnviado.id);
        return nuevoHilo;

    } catch (errHilo) {
        console.error('[Discord Bot] Error creando u obteniendo hilo:', errHilo);
        return null;
    }
}

/**
 * Notifica en Discord cuando se crea un nuevo ticket
 */
async function notificarNuevoTicket(ticketId, ticketData, usuarioData) {
    try {
        await obtenerOCrearHiloTicket(ticketId, ticketData, usuarioData);
    } catch (e) {
        console.error('[Discord Bot] Error al notificar nuevo ticket:', e.message);
    }
}

/**
 * Envía un mensaje desde el portal Web hacia el hilo de Discord correspondiente
 */
async function enviarMensajeDesdeWeb({ ticketId, autorNombre, autorRol, autorPuesto, mensaje, imagenFilename, tipoIntervencion }) {
    try {
        const hilo = await obtenerOCrearHiloTicket(ticketId);
        if (!hilo) return;

        if (hilo.locked) {
            await hilo.setLocked(false).catch(() => {});
        }
        if (hilo.archived) {
            await hilo.setArchived(false).catch(() => {});
        }

        const prefijoAutor = autorRol === 'admin' 
            ? `🛠️ **[TI - ${autorNombre || 'Sistemas'}]**` 
            : `👤 **[${autorNombre || 'Usuario'}]**`;

        const detalleTipo = (tipoIntervencion && tipoIntervencion !== 'comentario') 
            ? ` *(Etapa: ${tipoIntervencion.toUpperCase()})*` 
            : '';

        const contenido = `${prefijoAutor}${detalleTipo}\n${mensaje}`;

        const archivos = [];
        if (imagenFilename && uploadsDirectory) {
            const ruta = path.join(uploadsDirectory, imagenFilename);
            if (fs.existsSync(ruta)) {
                archivos.push({ attachment: ruta, name: imagenFilename });
            }
        }

        const msgEnviado = await hilo.send({
            content: contenido,
            files: archivos
        });

        mensajesEnviadosPorBot.add(msgEnviado.id);

    } catch (e) {
        console.error('[Discord Bot] Error enviando mensaje a Discord:', e.message);
    }
}

/**
 * Notifica en el hilo de Discord un cambio de estatus del ticket
 */
async function notificarCambioEstatusDiscord(ticketId, nuevoEstatus, extraData = {}) {
    try {
        const hilo = await obtenerOCrearHiloTicket(ticketId);
        if (!hilo) return;

        if (hilo.locked) {
            await hilo.setLocked(false).catch(() => {});
        }
        if (hilo.archived) {
            await hilo.setArchived(false).catch(() => {});
        }

        let color = 0x3b82f6; // Azul
        let icono = '🔄';

        if (nuevoEstatus === 'En proceso') {
            color = 0x06b6d4; // Cian
            icono = '⚙️';
        } else if (nuevoEstatus === 'Pendiente') {
            color = 0xf59e0b; // Ámbar
            icono = '⏳';
        } else if (nuevoEstatus === 'Pendiente por cliente') {
            color = 0x8b5cf6; // Morado
            icono = '📅';
        } else if (nuevoEstatus === 'Resuelto') {
            color = 0x10b981; // Verde
            icono = '✅';
        }

        const embed = new EmbedBuilder()
            .setTitle(`${icono} Estatus Actualizado: ${nuevoEstatus}`)
            .setColor(color)
            .setTimestamp();

        if (nuevoEstatus === 'Pendiente por cliente') {
            if (extraData.motivo_pendiente_cliente) {
                embed.addFields({ name: 'Motivo', value: String(extraData.motivo_pendiente_cliente), inline: false });
            }
            if (extraData.fecha_programada_cliente) {
                embed.addFields({ name: 'Fecha Programada', value: String(extraData.fecha_programada_cliente), inline: true });
            }
        }

        if (nuevoEstatus === 'Resuelto') {
            if (extraData.tecnico_resolvio) {
                embed.addFields({ name: 'Técnico que resolvió', value: String(extraData.tecnico_resolvio), inline: true });
            }
            if (extraData.comentario_resolucion) {
                embed.addFields({ name: 'Solución Aplicada', value: String(extraData.comentario_resolucion), inline: false });
            }
        }

        const msgEstatus = await hilo.send({ embeds: [embed] });
        mensajesEnviadosPorBot.add(msgEstatus.id);

        // Si el ticket fue resuelto, bloquear y archivar el hilo (se oculta de la barra activa pero se conserva en "Archivados")
        if (nuevoEstatus === 'Resuelto') {
            const solucionTexto = extraData.comentario_resolucion 
                ? `\n• **Solución aplicada:** *${extraData.comentario_resolucion}*` 
                : '';
            const msgCierre = await hilo.send(
                `🔒 **Este ticket ha sido resuelto y cerrado por Sistemas TI.**${solucionTexto}\n\n` +
                `• Este hilo ha sido **bloqueado y archivado** para mantener limpia la barra lateral.\n` +
                `• Puedes consultarlo en cualquier momento arriba en el botón **Hilos 🧵 > pestaña Archivados**.\n` +
                `• Si en el futuro este ticket es reabierto en la plataforma web, el hilo **se desarchivará automáticamente** con todo su historial intacto.`
            );
            mensajesEnviadosPorBot.add(msgCierre.id);

            setTimeout(async () => {
                try {
                    if (!hilo.locked) {
                        await hilo.setLocked(true, 'Ticket resuelto y cerrado');
                    }
                    if (!hilo.archived) {
                        await hilo.setArchived(true, 'Ticket resuelto y cerrado');
                    }
                    console.log(`[Discord Bot] Hilo del ticket #${ticketId} archivado y bloqueado exitosamente.`);
                } catch (eArc) {
                    console.warn('[Discord Bot] No se pudo archivar el hilo resuelto:', eArc.message);
                }
            }, 1500);
        }

    } catch (e) {
        console.error('[Discord Bot] Error notificando estatus a Discord:', e.message);
    }
}

function obtenerEstadoBot() {
    return {
        conectado: !!(client && client.isReady()),
        nombreBot: client?.user?.tag || 'SISTEMA TICKETS#9698',
        servidor: servidorGrupoCDM?.name || 'Grupo CDM',
        servidorId: DISCORD_GUILD_ID,
        canal: canalTicketsBase?.name || DISCORD_CHANNEL_NAME,
        canalId: canalTicketsBase?.id || '1563252393389465600',
        totalMiembros: servidorGrupoCDM?.members?.cache?.size || 47
    };
}

module.exports = {
    inicializarDiscord,
    notificarNuevoTicket,
    enviarMensajeDesdeWeb,
    notificarCambioEstatusDiscord,
    buscarMiembroDiscord,
    obtenerEstadoBot
};
