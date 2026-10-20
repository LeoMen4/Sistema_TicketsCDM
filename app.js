const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { generarCaptcha, validarCaptcha } = require('./captcha');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const mailer = require('./mailer');
const ExcelJS = require('exceljs');
const { generarExcelDashboards } = require('./excelReporter');

const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Configurar carpeta pública e imágenes cargadas por los usuarios
const publicDir = path.join(__dirname, 'public');
try {
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }
} catch (e) {}
app.use(express.static(publicDir));

// Ruta garantizada para el logo corporativo CDM
app.get('/img/logo-cdm.jpg', (req, res) => {
    const localLogo = path.join(publicDir, 'img', 'logo-cdm.jpg');
    const uploadedLogo = 'C:/Users/siscd/.gemini/antigravity/brain/0f9dc841-b233-46ae-97e0-5a9e2f24fdda/.user_uploaded/media_1792420696881_57b3c692.jpg';
    try {
        if (!fs.existsSync(localLogo) && fs.existsSync(uploadedLogo)) {
            const imgDir = path.join(publicDir, 'img');
            if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
            fs.copyFileSync(uploadedLogo, localLogo);
        }
        if (fs.existsSync(localLogo)) {
            return res.sendFile(localLogo);
        }
        if (fs.existsSync(uploadedLogo)) {
            return res.sendFile(uploadedLogo);
        }
    } catch (e) {}

    // Respaldo vectorial SVG idéntico al logo de CDM en caso de no encontrar el archivo físico
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 100">
        <rect width="360" height="100" fill="#ffffff" rx="6"/>
        <rect x="28" y="4" width="38" height="22" fill="#e60000"/>
        <rect x="98" y="4" width="90" height="22" fill="#e60000"/>
        <rect x="66" y="26" width="32" height="24" fill="#e60000"/>
        <polygon points="0,50 66,50 66,96 34,96 34,74 0,74" fill="#e60000"/>
        <text x="102" y="94" font-family="Arial Black, Impact, sans-serif" font-size="80" font-weight="900" font-style="italic" fill="#e60000" letter-spacing="-2">CDM</text>
    </svg>`);
});

const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
try {
    if (!fs.existsSync(uploadsDir)){
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (e) {}
app.use('/uploads', express.static(uploadsDir));

// Configuración de Multer para la subida de imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen'));
        }
    }
});

app.use(session({
    secret: 'clave_secreta_tickets_123',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax'
    }
}));

const CINCO_MINUTOS_MS = 5 * 60 * 1000; // 5 minutos = 300,000 milisegundos

// Middleware de inactividad diferenciada:
// - Administrador: SIN tiempo de inactividad (nunca se cierra automáticamente a menos que cierre sesión manualmente)
// - Usuario estándar: 5 minutos de inactividad (destruye la sesión y borra las cookies del sitio)
app.use((req, res, next) => {
    if (req.session && req.session.usuario) {
        const ahora = Date.now();
        const esAdministrador = req.session.usuario.rol === 'admin';

        if (esAdministrador) {
            // El administrador nunca se cierra por inactividad
            if (req.session.cookie) {
                req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 365; // Sesión persistente
            }
        } else {
            // Usuario estándar: verificar inactividad de 5 minutos
            const ultimoAcceso = req.session.ultimoAcceso || ahora;
            const transcurrido = ahora - ultimoAcceso;

            if (transcurrido > CINCO_MINUTOS_MS) {
                if (req.path.startsWith('/api/')) {
                    return req.session.destroy(() => {
                        res.clearCookie('connect.sid', { path: '/' });
                        return res.status(401).json({ ok: false, inactividad: true });
                    });
                }
                return req.session.destroy(() => {
                    res.clearCookie('connect.sid', { path: '/' });
                    return res.redirect('/?inactividad=1');
                });
            }

            // No reiniciar el contador de inactividad si es un poleo automático en segundo plano
            const esPoleoAutomatico = req.path === '/api/usuario/notificaciones-live';
            if (!esPoleoAutomatico) {
                req.session.ultimoAcceso = ahora;
                if (req.session.cookie) {
                    req.session.cookie.maxAge = CINCO_MINUTOS_MS;
                }
            }
        }
    }
    next();
});

// Purgar usuarios eliminados tras 7 días
// Conservación permanente: Los datos nunca se purgan automáticamente
function purgarUsuariosExpirados() {
    // Conservación permanente garantizada: no se ejecuta ninguna eliminación por temporizador.
}

// Captcha interactivo
app.get('/captcha/refresh', (req, res) => {
    const nuevoReto = generarCaptcha();
    req.session.captchaChallenge = {
        correctIds: nuevoReto.correctIds
    };
    res.json({
        prompt: nuevoReto.prompt,
        targetName: nuevoReto.targetName,
        targetIcon: nuevoReto.targetIcon,
        tiles: nuevoReto.tiles
    });
});

// Login
app.get('/', (req, res) => {
    const esInactividad = req.query.inactividad === '1';

    // Si ya tiene sesión activa y no proviene de un cierre por inactividad
    if (!esInactividad && req.session && req.session.usuario) {
        if (req.session.usuario.rol === 'admin') {
            return res.redirect('/admin');
        } else {
            return res.redirect('/usuario');
        }
    }

    const reto = generarCaptcha();
    req.session.captchaChallenge = {
        correctIds: reto.correctIds
    };
    const mensajeInactividad = esInactividad 
        ? 'Tu sesión se ha cerrado por 5 minutos de inactividad. Por favor, ingresa tus datos nuevamente.' 
        : null;

    res.render('login', { 
        error: null, 
        email: '', 
        password: '',
        captcha: reto,
        mensajeInactividad: mensajeInactividad
    });
});

app.post('/login', (req, res) => {
    const { email, password, captcha_solution } = req.body;
    const userSelected = (captcha_solution || '').split(',').map(s => s.trim()).filter(Boolean);
    const correctIds = req.session.captchaChallenge?.correctIds || [];

    if (!validarCaptcha(correctIds, userSelected)) {
        const nuevoReto = generarCaptcha();
        req.session.captchaChallenge = { correctIds: nuevoReto.correctIds };
        return res.render('login', { 
            error: 'Verificación de imágenes incorrecta. Por favor intenta de nuevo.',
            email: email,
            password: password,
            captcha: nuevoReto,
            mensajeInactividad: null
        });
    }

    db.get('SELECT * FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email], async (err, usuario) => {
        if (err || !usuario) {
            const nuevoReto = generarCaptcha();
            req.session.captchaChallenge = { correctIds: nuevoReto.correctIds };
            return res.render('login', { 
                error: 'Usuario o contraseña incorrectos',
                email: email,
                password: password,
                captcha: nuevoReto,
                mensajeInactividad: null
            });
        }

        const match = await bcrypt.compare(password, usuario.password);
        if (!match) {
            const nuevoReto = generarCaptcha();
            req.session.captchaChallenge = { correctIds: nuevoReto.correctIds };
            return res.render('login', { 
                error: 'Usuario o contraseña incorrectos',
                email: email,
                password: password,
                captcha: nuevoReto,
                mensajeInactividad: null
            });
        }

        delete req.session.captchaChallenge;

        req.session.usuario = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            puesto: usuario.puesto || '',
            rol: usuario.rol
        };

        if (usuario.rol === 'admin') {
            // Administrador: SIN tiempo de inactividad (persiste hasta cierre manual)
            req.session.ultimoAcceso = null;
            if (req.session.cookie) {
                req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 365; // 1 año persistente
            }
            res.redirect('/admin');
        } else {
            // Usuario estándar: 5 minutos de inactividad
            req.session.ultimoAcceso = Date.now();
            if (req.session.cookie) {
                req.session.cookie.maxAge = CINCO_MINUTOS_MS;
            }
            res.redirect('/usuario');
        }
    });
});

// Middlewares
function esAdmin(req, res, next) {
    if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') {
        return next();
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.is('json')) {
        return res.status(401).json({ ok: false, error: 'Sesión expirada o no autorizada. Por favor inicia sesión nuevamente.' });
    }
    res.redirect('/');
}

function esUsuario(req, res, next) {
    if (req.session.usuario) {
        return next();
    }
    res.redirect('/');
}

// ---------------------- RUTAS DE USUARIO ESTÁNDAR ----------------------

app.get('/usuario', esUsuario, (req, res) => {
    const mensaje = (req.session && req.session.mensajeFlash) ? req.session.mensajeFlash : null;
    const error = (req.session && req.session.errorFlash) ? req.session.errorFlash : null;
    if (req.session) {
        delete req.session.mensajeFlash;
        delete req.session.errorFlash;
    }
    renderUserDashboardWithMsg(req, res, mensaje, error);
});

// Obtener categorías y sus subcategorías agrupadas
function obtenerCategoriasConSubcategorias(callback) {
    db.all('SELECT * FROM categorias ORDER BY nombre ASC', [], (errCat, categorias) => {
        categorias = categorias || [];
        db.all('SELECT * FROM subcategorias ORDER BY nombre ASC', [], (errSub, subcategorias) => {
            subcategorias = subcategorias || [];
            const agrupadas = categorias.map(c => ({
                id: c.id,
                nombre: c.nombre,
                subcategorias: subcategorias.filter(s => s.categoria_id === c.id)
            }));
            callback(agrupadas);
        });
    });
}

// Crear Ticket con soporte para subida de imagen (multer) y subcategoría
app.post('/tickets/crear', esUsuario, upload.single('imagen'), (req, res) => {
    const { titulo, tipo_falla, subcategoria, prioridad, descripcion } = req.body;
    const usuarioId = req.session.usuario.id;
    const imagenNombre = req.file ? req.file.filename : null;

    if (!titulo || !tipo_falla || !descripcion) {
        req.session.errorFlash = 'Todos los campos marcados son obligatorios.';
        return res.redirect('/usuario');
    }

    const subcatFinal = (subcategoria && subcategoria.trim()) ? subcategoria.trim() : null;
    const tituloFinal = titulo.trim();
    const tipoFallaFinal = tipo_falla.trim();
    const descFinal = descripcion.trim();
    const prioFinal = prioridad || 'Media';

    // 1. Verificar si el usuario ya tiene un ticket activo (NO resuelto) con el mismo título y falla
    db.get(
        `SELECT id, estatus FROM tickets 
         WHERE usuario_id = ? 
           AND LOWER(TRIM(titulo)) = LOWER(TRIM(?)) 
           AND LOWER(TRIM(tipo_falla)) = LOWER(TRIM(?)) 
           AND estatus != 'Resuelto'
           AND deleted_at IS NULL`,
        [usuarioId, tituloFinal, tipoFallaFinal],
        (errCheck, ticketAbierto) => {
            if (ticketAbierto) {
                req.session.errorFlash = `Ya tienes un ticket abierto (#${ticketAbierto.id} - ${ticketAbierto.estatus}) para "${tituloFinal}". Por favor espera a que sea atendido.`;
                return res.redirect('/usuario');
            }

            db.run(
                `INSERT INTO tickets (titulo, tipo_falla, subcategoria, prioridad, descripcion, imagen, estatus, fecha, usuario_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)`,
                [tituloFinal, tipoFallaFinal, subcatFinal, prioFinal, descFinal, imagenNombre, 'Nuevo ticket', usuarioId],
                function(err) {
                    if (err) {
                        req.session.errorFlash = 'Error al registrar el ticket: ' + err.message;
                        return res.redirect('/usuario');
                    }
                    
                    const ticketId = this.lastID;
                    db.run(
                        `INSERT INTO historial_tickets (ticket_id, estatus, fecha) VALUES (?, ?, datetime('now', 'localtime'))`,
                        [ticketId, 'Nuevo ticket'],
                        () => {
                            const datosTicket = {
                                id: ticketId,
                                titulo: tituloFinal,
                                tipo_falla: tipoFallaFinal,
                                subcategoria: subcatFinal,
                                prioridad: prioFinal,
                                descripcion: descFinal,
                                estatus: 'Nuevo ticket',
                                usuario_nombre: req.session.usuario.nombre,
                                usuario_email: req.session.usuario.email
                            };

                            // Notificar a administradores por correo
                            mailer.notificarNuevoTicketAdmin(ticketId, datosTicket);

                            // Notificar confirmación al usuario solicitante
                            mailer.notificarTicketCreadoUsuario(ticketId, datosTicket);

                            // Redirección segura PRG (Post/Redirect/Get) para evitar reenvío al recargar
                            req.session.mensajeFlash = '¡Ticket reportado exitosamente!';
                            return res.redirect('/usuario');
                        }
                    );
                }
            );
        }
    );
});

// Modificar Ticket desde la vista de Usuario (Solo permitido mientras el estatus sea 'Nuevo ticket')
const procesarEdicionTicketUsuario = (req, res) => {
    const { ticket_id, titulo, tipo_falla, subcategoria, prioridad, descripcion } = req.body;
    const usuarioId = req.session.usuario.id;
    const usuarioNombre = req.session.usuario.nombre;

    if (!ticket_id || !titulo || !tipo_falla || !descripcion) {
        req.session.errorFlash = 'Todos los campos obligatorios deben completarse para modificar el ticket.';
        return res.redirect('/usuario');
    }

    db.get('SELECT * FROM tickets WHERE id = ? AND deleted_at IS NULL', [ticket_id], (err, ticket) => {
        if (err || !ticket) {
            req.session.errorFlash = 'El ticket que intentas modificar no existe o ha sido retirado.';
            return res.redirect('/usuario');
        }

        if (ticket.usuario_id !== usuarioId) {
            req.session.errorFlash = 'No tienes permiso para modificar este ticket.';
            return res.redirect('/usuario');
        }

        // Restricción crítica: una vez cambiado el estatus ya no se puede editar
        if (ticket.estatus !== 'Nuevo ticket') {
            req.session.errorFlash = `No es posible modificar el ticket #${ticket_id} porque su estatus actual es "${ticket.estatus}" y el equipo de TI ya comenzó a atenderlo.`;
            return res.redirect('/usuario');
        }

        const tituloFinal = titulo.trim();
        const tipoFallaFinal = tipo_falla.trim();
        const subcatFinal = (subcategoria && subcategoria.trim()) ? subcategoria.trim() : null;
        const prioFinal = prioridad || 'Media';
        const descFinal = descripcion.trim();
        const imagenFinal = req.file ? req.file.filename : ticket.imagen;

        db.run(
            `UPDATE tickets 
             SET titulo = ?, 
                 tipo_falla = ?, 
                 subcategoria = ?, 
                 prioridad = ?, 
                 descripcion = ?, 
                 imagen = ?, 
                 editado = 1, 
                 editado_at = datetime('now', 'localtime') 
             WHERE id = ?`,
            [tituloFinal, tipoFallaFinal, subcatFinal, prioFinal, descFinal, imagenFinal, ticket_id],
            function(errUpdate) {
                if (errUpdate) {
                    req.session.errorFlash = 'Error al actualizar el ticket: ' + errUpdate.message;
                    return res.redirect('/usuario');
                }

                db.run(
                    `INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, detalle, fecha) 
                     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
                    [ticket_id, 'Nuevo ticket', usuarioNombre, req.session.usuario.puesto || 'Usuario', 'Ticket modificado por el usuario solicitante'],
                    () => {
                        req.session.mensajeFlash = `¡Ticket #${ticket_id} modificado exitosamente!`;
                        return res.redirect('/usuario');
                    }
                );
            }
        );
    });
};

app.post('/tickets/editar', esUsuario, upload.single('imagen'), procesarEdicionTicketUsuario);
app.post('/usuario/tickets/editar', esUsuario, upload.single('imagen'), procesarEdicionTicketUsuario);

// Eliminar / Cancelar Ticket desde la vista de Usuario (Solo permitido mientras el estatus sea 'Nuevo ticket')
const procesarEliminacionTicketUsuario = (req, res) => {
    const { ticket_id, motivo } = req.body;
    const usuarioId = req.session.usuario.id;
    const usuarioNombre = req.session.usuario.nombre;

    if (!ticket_id) {
        req.session.errorFlash = 'No se especificó el ticket a eliminar.';
        return res.redirect('/usuario');
    }

    db.get('SELECT * FROM tickets WHERE id = ? AND deleted_at IS NULL', [ticket_id], (err, ticket) => {
        if (err || !ticket) {
            req.session.errorFlash = 'El ticket no existe o ya fue eliminado.';
            return res.redirect('/usuario');
        }

        if (ticket.usuario_id !== usuarioId) {
            req.session.errorFlash = 'No tienes permiso para eliminar este ticket.';
            return res.redirect('/usuario');
        }

        // Restricción: solo se puede eliminar si aún está en 'Nuevo ticket'
        if (ticket.estatus !== 'Nuevo ticket') {
            req.session.errorFlash = `No es posible eliminar el ticket #${ticket_id} porque ya se encuentra en estatus "${ticket.estatus}". Comunícate por el chat de seguimiento si requieres cancelarlo.`;
            return res.redirect('/usuario');
        }

        const detalleHistorial = motivo && motivo.trim() 
            ? `Ticket cancelado y eliminado por el usuario (${usuarioNombre}). Motivo: ${motivo.trim()}`
            : `Ticket cancelado y eliminado por el usuario (${usuarioNombre})`;

        db.run(
            `UPDATE tickets 
             SET deleted_at = datetime('now', 'localtime'), 
                 eliminado_por = 'usuario', 
                 eliminado_por_nombre = ? 
             WHERE id = ?`,
            [usuarioNombre, ticket_id],
            function(errDel) {
                if (errDel) {
                    req.session.errorFlash = 'Error al eliminar el ticket: ' + errDel.message;
                    return res.redirect('/usuario');
                }

                db.run(
                    `INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, detalle, fecha) 
                     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
                    [ticket_id, 'Cancelado por usuario', usuarioNombre, req.session.usuario.puesto || 'Usuario', detalleHistorial],
                    () => {
                        req.session.mensajeFlash = `El ticket #${ticket_id} fue cancelado y retirado exitosamente.`;
                        return res.redirect('/usuario');
                    }
                );
            }
        );
    });
};

app.post('/tickets/eliminar-usuario', esUsuario, procesarEliminacionTicketUsuario);
app.post('/usuario/tickets/eliminar', esUsuario, procesarEliminacionTicketUsuario);

function renderUserDashboardWithMsg(req, res, mensaje, error) {
    const usuarioId = req.session.usuario.id;
    db.get('SELECT nombre, puesto FROM usuarios WHERE id = ?', [usuarioId], (errU, userDb) => {
        const nombreActual = (userDb && userDb.nombre) ? userDb.nombre : req.session.usuario.nombre;
        const puestoActual = (userDb && userDb.puesto) ? userDb.puesto : (req.session.usuario.puesto || '');
        obtenerCategoriasConSubcategorias((categorias) => {
            db.all('SELECT * FROM tickets WHERE usuario_id = ? AND deleted_at IS NULL ORDER BY fecha DESC', [usuarioId], (err, tickets) => {
                tickets = tickets || [];
                db.all(
                    `SELECT ticket_id, 
                            COUNT(*) AS total_comentarios,
                            SUM(CASE WHEN leido_usuario = 0 AND autor_rol = 'admin' THEN 1 ELSE 0 END) AS no_leidos_usuario
                     FROM ticket_comentarios
                     WHERE ticket_id IN (SELECT id FROM tickets WHERE usuario_id = ? AND deleted_at IS NULL)
                     GROUP BY ticket_id`,
                    [usuarioId],
                    (errCom, conteosCom) => {
                        const mapaCom = {};
                        (conteosCom || []).forEach(c => {
                            mapaCom[c.ticket_id] = {
                                total: c.total_comentarios || 0,
                                noLeidos: c.no_leidos_usuario || 0
                            };
                        });
                        tickets.forEach(t => {
                            t.total_comentarios = mapaCom[t.id] ? mapaCom[t.id].total : 0;
                            t.no_leidos_usuario = mapaCom[t.id] ? mapaCom[t.id].noLeidos : 0;
                        });

                        db.all('SELECT * FROM equipos_usuario WHERE usuario_id = ? ORDER BY tipo ASC, id ASC', [usuarioId], (errEq, equipos) => {
                            db.all("SELECT * FROM guias_rapidas WHERE visibilidad = 'todos' ORDER BY destacada DESC, id DESC", [], (errGuias, guias) => {
                                res.render('user-dashboard', {
                                    usuarioNombre: nombreActual,
                                    usuarioPuesto: puestoActual,
                                    tickets: tickets,
                                    equipos: equipos || [],
                                    categorias: categorias || [],
                                    guias: guias || [],
                                    mensaje: mensaje,
                                    error: error
                                });
                            });
                        });
                    }
                );
            });
        });
    });
}

// ---------------------- RUTAS DE ADMINISTRADOR ----------------------

app.get('/admin', esAdmin, (req, res) => {
    purgarUsuariosExpirados();
    obtenerDatosAdmin(req, res);
});

// Función auxiliar para calcular milisegundos transcurridos excluyendo totalmente los domingos
function calcularMsSinDomingos(inicioDate, finDate) {
    if (!inicioDate || !finDate) return null;
    const start = (inicioDate instanceof Date) ? inicioDate : new Date(String(inicioDate).replace(' ', 'T'));
    const end = (finDate instanceof Date) ? finDate : new Date(String(finDate).replace(' ', 'T'));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;

    let totalMs = 0;
    let curr = new Date(start.getTime());

    while (curr < end) {
        const diaSemana = curr.getDay(); // 0 = Domingo
        const finDelDia = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate(), 23, 59, 59, 999);
        const momentoFin = end < finDelDia ? end : new Date(finDelDia.getTime() + 1);

        if (diaSemana !== 0) {
            totalMs += (momentoFin.getTime() - curr.getTime());
        }

        // Avanzar al inicio del siguiente día (00:00:00.000)
        curr = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate() + 1, 0, 0, 0, 0);
    }

    return Math.max(0, totalMs);
}

// Función auxiliar para formatear duraciones en milisegundos a texto legible
function formatearDuracion(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return 'N/A';
    if (ms < 0) ms = 0;
    const segundosTotales = Math.round(ms / 1000);
    const minutosTotales = Math.floor(segundosTotales / 60);
    const horasTotales = Math.floor(minutosTotales / 60);
    const diasTotales = Math.floor(horasTotales / 24);

    if (segundosTotales < 60) return `${segundosTotales} seg`;
    if (minutosTotales < 60) {
        const segRestantes = segundosTotales % 60;
        return segRestantes > 0 ? `${minutosTotales}m ${segRestantes}s` : `${minutosTotales} min`;
    }
    if (horasTotales < 24) {
        const minRestantes = minutosTotales % 60;
        return minRestantes > 0 ? `${horasTotales}h ${minRestantes}m` : `${horasTotales} hrs`;
    }
    const horasRestantes = horasTotales % 24;
    return horasRestantes > 0 ? `${diasTotales}d ${horasRestantes}h` : `${diasTotales} días`;
}

// Función para calcular todas las métricas de dashboards y SLAs con exclusión de domingos
function calcularMetricasDashboards(callback) {
    db.all('SELECT id, titulo, tipo_falla, subcategoria, prioridad, estatus, fecha FROM tickets WHERE deleted_at IS NULL', [], (errT, tickets) => {
        if (errT) return callback(errT);
        tickets = tickets || [];

        db.all('SELECT * FROM categorias ORDER BY nombre ASC', [], (errC, categorias) => {
            if (errC) return callback(errC);
            categorias = categorias || [];

            db.all('SELECT * FROM subcategorias ORDER BY nombre ASC', [], (errS, subcategorias) => {
                if (errS) return callback(errS);
                subcategorias = subcategorias || [];

                db.all('SELECT ticket_id, estatus, fecha FROM historial_tickets ORDER BY ticket_id, fecha ASC', [], (errH, historial) => {
                    if (errH) return callback(errH);
                    historial = historial || [];

                    db.get("SELECT valor FROM configuraciones WHERE clave = 'tolerancia_alerta_pct'", [], (errConf, rowConf) => {
                        const toleranciaPct = (rowConf && !isNaN(parseFloat(rowConf.valor))) ? parseFloat(rowConf.valor) : 25;
                        const factorTolerancia = 1 + (toleranciaPct / 100);

                        // Mapear historial por ticket
                        const histByTicket = {};
                        historial.forEach(h => {
                            if (!histByTicket[h.ticket_id]) histByTicket[h.ticket_id] = [];
                            histByTicket[h.ticket_id].push(h);
                        });

                        // Enriquecer cada ticket con sus métricas de tiempo (sin contar domingos)
                        const ticketsEnriquecidos = tickets.map(t => {
                            const h = histByTicket[t.id] || [];
                            const primerH = h[0];
                            const fCreacion = primerH ? primerH.fecha : t.fecha;

                            // Primera atención: primer cambio que no sea 'Nuevo ticket' (excluyendo domingos)
                            const primerAtencion = h.find(x => x.estatus !== 'Nuevo ticket');
                            const tiempoAtencionMs = primerAtencion 
                                ? calcularMsSinDomingos(fCreacion, primerAtencion.fecha) 
                                : null;

                            // Tiempo de resolución: desde creación hasta 'Resuelto' (excluyendo domingos)
                            let tiempoResolucionMs = null;
                            if (t.estatus === 'Resuelto') {
                                const ultimoResuelto = [...h].reverse().find(x => x.estatus === 'Resuelto');
                                const fResolucion = ultimoResuelto ? ultimoResuelto.fecha : t.fecha;
                                tiempoResolucionMs = calcularMsSinDomingos(fCreacion, fResolucion);
                            }

                            return {
                                ...t,
                                tiempoAtencionMs,
                                tiempoResolucionMs
                            };
                        });

                        // 1. Estadísticas de Estatus
                        const estatusStats = {
                            nuevos: tickets.filter(t => t.estatus === 'Nuevo ticket').length,
                            enProceso: tickets.filter(t => t.estatus === 'En proceso').length,
                            pendientes: tickets.filter(t => t.estatus === 'Pendiente').length,
                            resueltos: tickets.filter(t => t.estatus === 'Resuelto').length,
                            total: tickets.length
                        };

                        // 2. Estadísticas de Prioridad
                        const prioridadStats = {
                            baja: tickets.filter(t => t.prioridad === 'Baja').length,
                            media: tickets.filter(t => t.prioridad === 'Media').length,
                            alta: tickets.filter(t => t.prioridad === 'Alta').length,
                            total: tickets.length
                        };

                        // Función auxiliar para procesar métricas de un subconjunto de tickets
                        const procesarGrupoTickets = (grupoTickets) => {
                            const resueltos = grupoTickets.filter(t => t.tiempoResolucionMs !== null);
                            const tiemposRes = resueltos.map(t => t.tiempoResolucionMs);
                            const promResMs = tiemposRes.length > 0 
                                ? Math.round(tiemposRes.reduce((a, b) => a + b, 0) / tiemposRes.length) 
                                : null;
                            const minResMs = tiemposRes.length > 0 ? Math.min(...tiemposRes) : null;
                            const maxResMs = tiemposRes.length > 0 ? Math.max(...tiemposRes) : null;

                            const atendidos = grupoTickets.filter(t => t.tiempoAtencionMs !== null);
                            const tiemposAten = atendidos.map(t => t.tiempoAtencionMs);
                            const promAtenMs = tiemposAten.length > 0 
                                ? Math.round(tiemposAten.reduce((a, b) => a + b, 0) / tiemposAten.length) 
                                : null;

                            return {
                                total: grupoTickets.length,
                                resueltosCount: resueltos.length,
                                pendientesOprocesoCount: grupoTickets.length - resueltos.length,
                                promResolucionMs: promResMs,
                                promResolucionHoras: promResMs !== null ? Number((promResMs / 3600000).toFixed(2)) : 0,
                                promResolucionTexto: formatearDuracion(promResMs),
                                minResolucionTexto: formatearDuracion(minResMs),
                                maxResolucionTexto: formatearDuracion(maxResMs),
                                promAtencionTexto: formatearDuracion(promAtenMs)
                            };
                        };

                        // 3. Estadísticas dinámicas por Categoría y Subcategoría (con tiempos)
                        const matchedTicketIds = new Set();
                        const categoriasStats = categorias.map(c => {
                            const cSubs = subcategorias.filter(s => s.categoria_id === c.id);
                            const subTicketsMap = {};
                            cSubs.forEach(s => { subTicketsMap[s.nombre] = []; });
                            const sinSubTickets = [];
                            const catTickets = [];

                            ticketsEnriquecidos.forEach(t => {
                                const tFalla = (t.tipo_falla || '').trim();
                                const tSub = (t.subcategoria || '').trim();
                                let matchesCat = false;
                                let matchedSubName = null;

                                if (tFalla.toLowerCase() === c.nombre.toLowerCase()) {
                                    matchesCat = true;
                                    if (tSub) matchedSubName = tSub;
                                } else if (tFalla.toLowerCase().startsWith(c.nombre.toLowerCase() + ' (')) {
                                    matchesCat = true;
                                    const match = tFalla.match(/\(([^)]+)\)/);
                                    if (match) matchedSubName = match[1].trim();
                                }

                                if (matchesCat) {
                                    matchedTicketIds.add(t.id);
                                    catTickets.push(t);
                                    let found = false;
                                    if (matchedSubName) {
                                        for (const s of cSubs) {
                                            if (s.nombre.toLowerCase() === matchedSubName.toLowerCase()) {
                                                subTicketsMap[s.nombre].push(t);
                                                found = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (!found) {
                                        sinSubTickets.push(t);
                                    }
                                }
                            });

                            const baseStats = procesarGrupoTickets(catTickets);

                            const subsStats = cSubs.map(s => {
                                const sTickets = subTicketsMap[s.nombre] || [];
                                const subBase = procesarGrupoTickets(sTickets);
                                const tiempoBaseHoras = Number((s.tiempo_base_horas !== undefined && s.tiempo_base_horas !== null) ? s.tiempo_base_horas : 24);

                                let velocidadEstatus = 'na';
                                let velocidadTexto = 'En atención';
                                if (subBase.resueltosCount > 0 && subBase.promResolucionHoras !== null) {
                                    if (subBase.promResolucionHoras <= tiempoBaseHoras) {
                                        velocidadEstatus = 'rapido';
                                        velocidadTexto = '⚡ Rápido';
                                    } else if (subBase.promResolucionHoras <= tiempoBaseHoras * factorTolerancia) {
                                        velocidadEstatus = 'limite';
                                        velocidadTexto = '🟡 En límite';
                                    } else {
                                        velocidadEstatus = 'lento';
                                        velocidadTexto = '🔴 A mejorar';
                                    }
                                }

                                return {
                                    id: s.id,
                                    nombre: s.nombre,
                                    count: sTickets.length,
                                    resueltosCount: subBase.resueltosCount,
                                    promResolucionMs: subBase.promResolucionMs,
                                    promResolucionHoras: subBase.promResolucionHoras,
                                    promResolucionTexto: subBase.promResolucionTexto,
                                    promAtencionTexto: subBase.promAtencionTexto,
                                    tiempoBaseHoras: tiempoBaseHoras,
                                    velocidadEstatus: velocidadEstatus,
                                    velocidadTexto: velocidadTexto
                                };
                            });

                            const sinSubBase = procesarGrupoTickets(sinSubTickets);

                            const catTiempoBase = subsStats.length > 0 
                                ? Number((subsStats.reduce((sum, s) => sum + s.tiempoBaseHoras, 0) / subsStats.length).toFixed(1))
                                : Number((c.tiempo_base_horas !== undefined && c.tiempo_base_horas !== null) ? c.tiempo_base_horas : 24);

                            let catVelocidadEstatus = 'na';
                            let catVelocidadTexto = 'En atención';
                            if (baseStats.resueltosCount > 0 && baseStats.promResolucionHoras !== null) {
                                if (baseStats.promResolucionHoras <= catTiempoBase) {
                                    catVelocidadEstatus = 'rapido';
                                    catVelocidadTexto = '⚡ Rápido';
                                } else if (baseStats.promResolucionHoras <= catTiempoBase * factorTolerancia) {
                                    catVelocidadEstatus = 'limite';
                                    catVelocidadTexto = '🟡 En límite';
                                } else {
                                    catVelocidadEstatus = 'lento';
                                    catVelocidadTexto = '🔴 A mejorar';
                                }
                            }

                            return {
                                id: c.id,
                                nombre: c.nombre,
                                ...baseStats,
                                subcategorias: subsStats,
                                tiempoBaseHoras: catTiempoBase,
                                velocidadEstatus: catVelocidadEstatus,
                                velocidadTexto: catVelocidadTexto,
                                sinSubCount: sinSubTickets.length,
                                sinSubPromResolucionMs: sinSubBase.promResolucionMs,
                                sinSubPromResolucionHoras: sinSubBase.promResolucionHoras,
                                sinSubPromResolucionTexto: sinSubBase.promResolucionTexto,
                                sinSubPromAtencionTexto: sinSubBase.promAtencionTexto
                            };
                        });

                        // Incluir tickets de categorías anteriores o no listadas directamente
                        const unmatchedTickets = ticketsEnriquecidos.filter(t => !matchedTicketIds.has(t.id));
                        if (unmatchedTickets.length > 0) {
                            const gruposHuerfanos = {};
                            unmatchedTickets.forEach(t => {
                                const nombre = t.tipo_falla || 'Sin categoría especificada';
                                if (!gruposHuerfanos[nombre]) gruposHuerfanos[nombre] = [];
                                gruposHuerfanos[nombre].push(t);
                            });

                            for (const [nombre, listaT] of Object.entries(gruposHuerfanos)) {
                                const extraBase = procesarGrupoTickets(listaT);
                                const subMapExtra = {};
                                const sinSubExtra = [];

                                listaT.forEach(t => {
                                    const sub = (t.subcategoria || '').trim();
                                    if (sub) {
                                        if (!subMapExtra[sub]) subMapExtra[sub] = [];
                                        subMapExtra[sub].push(t);
                                    } else {
                                        sinSubExtra.push(t);
                                    }
                                });

                                const subExtraStats = Object.entries(subMapExtra).map(([subNom, subList], idx) => {
                                    const sBase = procesarGrupoTickets(subList);
                                    return {
                                        id: 'sub-extra-' + idx,
                                        nombre: subNom,
                                        count: subList.length,
                                        resueltosCount: sBase.resueltosCount,
                                        promResolucionMs: sBase.promResolucionMs,
                                        promResolucionHoras: sBase.promResolucionHoras,
                                        promResolucionTexto: sBase.promResolucionTexto,
                                        promAtencionTexto: sBase.promAtencionTexto,
                                        tiempoBaseHoras: 24,
                                        velocidadEstatus: 'na',
                                        velocidadTexto: 'En atención'
                                    };
                                });

                                const sinSubExtraBase = procesarGrupoTickets(sinSubExtra);

                                categoriasStats.push({
                                    id: 'extra-' + nombre.replace(/[^a-zA-Z0-9]/g, '_'),
                                    nombre: nombre,
                                    ...extraBase,
                                    subcategorias: subExtraStats,
                                    tiempoBaseHoras: 24,
                                    velocidadEstatus: 'na',
                                    velocidadTexto: 'En atención',
                                    sinSubCount: sinSubExtra.length,
                                    sinSubPromResolucionMs: sinSubExtraBase.promResolucionMs,
                                    sinSubPromResolucionHoras: sinSubExtraBase.promResolucionHoras,
                                    sinSubPromResolucionTexto: sinSubExtraBase.promResolucionTexto,
                                    sinSubPromAtencionTexto: sinSubExtraBase.promAtencionTexto
                                });
                            }
                        }

                        // 4. Métricas Globales de Tiempos y Comparativa de Categorías
                        const todosResueltos = ticketsEnriquecidos.filter(t => t.tiempoResolucionMs !== null);
                        const tiemposTodosRes = todosResueltos.map(t => t.tiempoResolucionMs);
                        const promGlobalResMs = tiemposTodosRes.length > 0 
                            ? Math.round(tiemposTodosRes.reduce((a, b) => a + b, 0) / tiemposTodosRes.length) 
                            : null;

                        const todosAtendidos = ticketsEnriquecidos.filter(t => t.tiempoAtencionMs !== null);
                        const tiemposTodosAten = todosAtendidos.map(t => t.tiempoAtencionMs);
                        const promGlobalAtenMs = tiemposTodosAten.length > 0 
                            ? Math.round(tiemposTodosAten.reduce((a, b) => a + b, 0) / tiemposTodosAten.length) 
                            : null;

                        // Ranking de categorías resueltas
                        const categoriasConRes = categoriasStats.filter(c => c.resueltosCount > 0 && c.promResolucionMs !== null);
                        categoriasConRes.sort((a, b) => a.promResolucionMs - b.promResolucionMs);

                        let categoriaMasRapida = null;
                        let categoriaAMejorar = null;

                        if (categoriasConRes.length > 0) {
                            categoriaMasRapida = {
                                id: categoriasConRes[0].id,
                                nombre: categoriasConRes[0].nombre,
                                tiempoTexto: categoriasConRes[0].promResolucionTexto,
                                tiempoHoras: categoriasConRes[0].promResolucionHoras,
                                resueltosCount: categoriasConRes[0].resueltosCount,
                                tiempoBaseHoras: categoriasConRes[0].tiempoBaseHoras
                            };

                            const excedidas = categoriasConRes.filter(c => c.promResolucionHoras > c.tiempoBaseHoras);
                            if (excedidas.length > 0) {
                                excedidas.sort((a, b) => (b.promResolucionHoras - b.tiempoBaseHoras) - (a.promResolucionHoras - a.tiempoBaseHoras));
                                const peor = excedidas[0];
                                categoriaAMejorar = {
                                    id: peor.id,
                                    nombre: peor.nombre,
                                    tiempoTexto: peor.promResolucionTexto,
                                    tiempoHoras: peor.promResolucionHoras,
                                    resueltosCount: peor.resueltosCount,
                                    tiempoBaseHoras: peor.tiempoBaseHoras,
                                    excesoHoras: Number((peor.promResolucionHoras - peor.tiempoBaseHoras).toFixed(1))
                                };
                            } else if (categoriasConRes.length > 1) {
                                const peor = categoriasConRes[categoriasConRes.length - 1];
                                categoriaAMejorar = {
                                    id: peor.id,
                                    nombre: peor.nombre,
                                    tiempoTexto: peor.promResolucionTexto,
                                    tiempoHoras: peor.promResolucionHoras,
                                    resueltosCount: peor.resueltosCount,
                                    tiempoBaseHoras: peor.tiempoBaseHoras,
                                    excesoHoras: 0
                                };
                            }
                        }

                        const tiemposGlobalesStats = {
                            promGlobalResMs,
                            promGlobalResHoras: promGlobalResMs !== null ? Number((promGlobalResMs / 3600000).toFixed(2)) : 0,
                            promGlobalResTexto: formatearDuracion(promGlobalResMs),
                            promGlobalAtenMs,
                            promGlobalAtenTexto: formatearDuracion(promGlobalAtenMs),
                            totalResueltos: todosResueltos.length,
                            categoriaMasRapida,
                            categoriaAMejorar,
                            categoriasRanking: categoriasConRes
                        };

                        callback(null, {
                            totalTickets: tickets.length,
                            estatusStats,
                            prioridadStats,
                            categoriasStats,
                            tiemposGlobalesStats,
                            toleranciaPct
                        });
                    });
                });
            });
        });
    });
}

// Ruta del Panel de Dashboards y Estadísticas con Tiempos de Resolución
app.get('/admin/dashboards', esAdmin, (req, res) => {
    calcularMetricasDashboards((err, metricas) => {
        if (err) {
            console.error('Error al calcular métricas de dashboards:', err);
            return res.status(500).send('Error al calcular las métricas de dashboards: ' + err.message);
        }

        res.render('admin-dashboards', {
            adminNombre: req.session.usuario.nombre,
            ...metricas
        });
    });
});

// Ruta para actualizar porcentaje de tolerancia para alertas de velocidad
app.post('/admin/dashboards/actualizar-tolerancia', esAdmin, (req, res) => {
    const { tolerancia_pct } = req.body || {};
    const pct = parseFloat(tolerancia_pct);
    if (isNaN(pct) || pct < 0 || pct > 500) {
        return res.status(400).json({ ok: false, error: 'El margen de alerta debe ser un número entre 0% y 500%.' });
    }

    db.run(
        `INSERT INTO configuraciones (clave, valor) VALUES ('tolerancia_alerta_pct', ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
        [String(pct)],
        function(err) {
            if (err) {
                console.error('Error al guardar tolerancia:', err);
                return res.status(500).json({ ok: false, error: err.message });
            }
            return res.json({ ok: true, mensaje: 'Margen de alerta actualizado exitosamente', tolerancia_pct: pct });
        }
    );
});

// Ruta para exportar reportes en Excel (.xlsx) con tablas y gráficas incrustadas
app.post('/admin/dashboards/exportar-excel', esAdmin, (req, res) => {
    const { tipo, categoria_id, graficas } = req.body || {};
    let tipoExport = 'general';
    if (tipo === 'principales') {
        tipoExport = 'principales';
    } else if (tipo === 'categoria') {
        tipoExport = 'categoria';
    }

    calcularMetricasDashboards(async (err, metricas) => {
        if (err) {
            return res.status(500).json({ ok: false, error: 'Error al calcular métricas para el reporte: ' + err.message });
        }

        try {
            const buffer = await generarExcelDashboards({
                tipo: tipoExport,
                categoriaId: categoria_id,
                graficas: graficas || {},
                metricas: metricas
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            let filename = `Reporte_General_Completo_Dashboards_${timestamp}.xlsx`;
            if (tipoExport === 'principales') {
                filename = `Reporte_Dashboards_Principales_${timestamp}.xlsx`;
            } else if (tipoExport === 'categoria') {
                const catObj = metricas.categoriasStats.find(c => String(c.id) === String(categoria_id));
                const catNombreSafe = (catObj ? catObj.nombre : 'Categoria').replace(/[^a-zA-Z0-9_-]/g, '_');
                filename = `Reporte_Dashboards_${catNombreSafe}_${timestamp}.xlsx`;
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(buffer);
        } catch (errExcel) {
            console.error('Error generando archivo Excel:', errExcel);
            return res.status(500).json({ ok: false, error: 'Error al generar el reporte en Excel: ' + errExcel.message });
        }
    });
});

// Ruta para actualizar tiempos base de resolución (por subcategoría o categoría)
app.post('/admin/dashboards/actualizar-tiempo-base', esAdmin, (req, res) => {
    const body = req.body || {};
    const { items, tipo, id, subcategoria_id, categoria_id, tiempo_base_horas } = body;

    // Actualización por lote (ej. todas las subcategorías de una categoría)
    if (Array.isArray(items) && items.length > 0) {
        const stmt = db.prepare('UPDATE subcategorias SET tiempo_base_horas = ? WHERE id = ?');
        db.serialize(() => {
            items.forEach(item => {
                const t = parseFloat(item.tiempo_base_horas);
                if (!isNaN(t) && t > 0 && item.id) {
                    stmt.run([t, item.id]);
                }
            });
            stmt.finalize(err => {
                if (err) return res.status(500).json({ ok: false, error: err.message });
                return res.json({ ok: true, mensaje: 'Tiempos base actualizados exitosamente' });
            });
        });
        return;
    }

    const tiempo = parseFloat(tiempo_base_horas);
    if (isNaN(tiempo) || tiempo <= 0) {
        return res.status(400).json({ ok: false, error: 'El tiempo base debe ser un número válido mayor a 0 horas.' });
    }

    if (tipo === 'categoria' || categoria_id) {
        const catId = id || categoria_id;
        db.run('UPDATE categorias SET tiempo_base_horas = ? WHERE id = ?', [tiempo, catId], function(err) {
            if (err) return res.status(500).json({ ok: false, error: err.message });
            return res.json({ ok: true, mensaje: 'Tiempo base guardado', id: catId, tiempo_base_horas: tiempo });
        });
    } else {
        const subId = id || subcategoria_id;
        db.run('UPDATE subcategorias SET tiempo_base_horas = ? WHERE id = ?', [tiempo, subId], function(err) {
            if (err) return res.status(500).json({ ok: false, error: err.message });
            return res.json({ ok: true, mensaje: 'Tiempo base guardado', id: subId, tiempo_base_horas: tiempo });
        });
    }
});

// Función auxiliar para combinar nombres de especialistas que intervinieron en un ticket sin duplicados
function combinarParticipantesTI(listaExistente, ...nuevosNombres) {
    const conjunto = new Set();
    const agregar = (str) => {
        if (!str || typeof str !== 'string') return;
        str.split(',').map(s => s.trim()).filter(Boolean).forEach(n => conjunto.add(n));
    };
    agregar(listaExistente);
    nuevosNombres.forEach(n => agregar(n));
    return Array.from(conjunto).join(', ');
}

// Ruta para ver el detalle de un ticket individual en grande (pestaña aparte)
// Accesible para Administradores (cualquier ticket) y para Usuarios (sus propios tickets)
function verDetalleTicket(req, res) {
    if (!req.session || !req.session.usuario) {
        return res.redirect('/');
    }

    const ticketId = req.params.id;
    const usuarioActual = req.session.usuario;
    const esAdmin = usuarioActual.rol === 'admin';

    const queryTicket = `
        SELECT tickets.*, 
               usuarios.nombre AS usuario_nombre, 
               usuarios.email AS usuario_email,
               usuarios.puesto AS usuario_puesto,
               usuarios.rol AS usuario_rol
        FROM tickets 
        JOIN usuarios ON tickets.usuario_id = usuarios.id
        WHERE tickets.id = ?
    `;

    db.get(queryTicket, [ticketId], (err, ticket) => {
        if (err || !ticket) {
            req.session.errorFlash = 'El ticket solicitado no existe o no fue encontrado.';
            return res.redirect(esAdmin ? '/admin' : '/usuario');
        }

        // Si es usuario regular, validar que el ticket le pertenezca
        if (!esAdmin && ticket.usuario_id !== usuarioActual.id) {
            req.session.errorFlash = 'No tienes permiso para ver este ticket.';
            return res.redirect('/usuario');
        }

        // Marcar comentarios como leídos para el rol que abre el expediente
        const campoLeido = esAdmin ? 'leido_admin' : 'leido_usuario';
        db.run(`UPDATE ticket_comentarios SET ${campoLeido} = 1 WHERE ticket_id = ?`, [ticketId], () => {});

        db.all('SELECT * FROM historial_tickets WHERE ticket_id = ? ORDER BY fecha ASC', [ticketId], (errH, historial) => {
            historial = historial || [];

            db.all('SELECT * FROM ticket_comentarios WHERE ticket_id = ? ORDER BY fecha ASC, id ASC', [ticketId], (errC, comentarios) => {
                comentarios = comentarios || [];

                db.all("SELECT id, nombre, email, puesto, rol FROM usuarios WHERE deleted_at IS NULL ORDER BY CASE WHEN rol = 'admin' THEN 0 ELSE 1 END, nombre ASC", [], (errUsers, usuariosActivos) => {
                    usuariosActivos = usuariosActivos || [];
                    const especialistasTI = usuariosActivos.filter(u => u.rol === 'admin');

                    const mensajeFlash = (req.session && req.session.mensajeFlash) ? req.session.mensajeFlash : null;
                    const errorFlash = (req.session && req.session.errorFlash) ? req.session.errorFlash : null;
                    if (req.session) {
                        delete req.session.mensajeFlash;
                        delete req.session.errorFlash;
                    }

                    res.render('admin-ticket-detalle', {
                        usuarioActual: usuarioActual,
                        usuarioActualNombre: usuarioActual.nombre,
                        adminNombre: esAdmin ? usuarioActual.nombre : null,
                        esAdmin: esAdmin,
                        ticket: ticket,
                        historial: historial,
                        comentarios: comentarios,
                        especialistasTI: especialistasTI,
                        usuariosActivos: usuariosActivos,
                        mensaje: mensajeFlash,
                        error: errorFlash
                    });
                });
            });
        });
    });
}

app.get('/tickets/:id', verDetalleTicket);
app.get('/admin/tickets/:id', verDetalleTicket);

function obtenerDatosAdmin(req, res, mensaje = null, error = null) {
    const filtroEstatus = req.query.estatus || 'Todos';
    const mensajeFinal = mensaje || (req.session && req.session.mensajeFlash ? req.session.mensajeFlash : null);
    const errorFinal = error || (req.session && req.session.errorFlash ? req.session.errorFlash : null);
    if (req.session) {
        delete req.session.mensajeFlash;
        delete req.session.errorFlash;
    }

    let queryTickets = `
        SELECT tickets.*, COALESCE(usuarios.nombre, tickets.creado_por_admin, 'Usuario') AS usuario_nombre, usuarios.email AS usuario_email, usuarios.puesto AS usuario_puesto 
        FROM tickets 
        LEFT JOIN usuarios ON tickets.usuario_id = usuarios.id
        WHERE tickets.deleted_at IS NULL
    `;
    let params = [];

    if (filtroEstatus === 'Todos') {
        queryTickets += " AND tickets.estatus != 'Resuelto'";
    } else {
        queryTickets += ' AND tickets.estatus = ?';
        params.push(filtroEstatus);
    }

    queryTickets += ' ORDER BY tickets.fecha DESC';

    db.all(queryTickets, params, (err, tickets) => {
        tickets = tickets || [];

        db.all('SELECT * FROM historial_tickets ORDER BY fecha ASC', [], (err, historial) => {
            historial = historial || [];

            db.all(
                `SELECT ticket_id, 
                        COUNT(*) AS total_comentarios,
                        SUM(CASE WHEN leido_admin = 0 AND autor_rol != 'admin' THEN 1 ELSE 0 END) AS no_leidos_admin
                 FROM ticket_comentarios
                 GROUP BY ticket_id`,
                [],
                (errCom, conteosCom) => {
                    const mapaCom = {};
                    (conteosCom || []).forEach(c => {
                        mapaCom[c.ticket_id] = {
                            total: c.total_comentarios || 0,
                            noLeidos: c.no_leidos_admin || 0
                        };
                    });

                    const ticketsConHistorial = tickets.map(t => {
                        t.historial = historial.filter(h => h.ticket_id === t.id);
                        t.total_comentarios = mapaCom[t.id] ? mapaCom[t.id].total : 0;
                        t.no_leidos_admin = mapaCom[t.id] ? mapaCom[t.id].noLeidos : 0;
                        return t;
                    });

                    db.all('SELECT id, nombre, email, puesto, password_plana, rol FROM usuarios WHERE deleted_at IS NULL ORDER BY nombre ASC', [], (err, usuarios) => {
                        db.all('SELECT id, nombre, email, puesto, rol, deleted_at FROM usuarios WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC', [], (err, usuariosEliminados) => {
                            db.all(`
                                SELECT tickets.*, COALESCE(usuarios.nombre, tickets.creado_por_admin, 'Usuario') AS usuario_nombre, usuarios.email AS usuario_email, usuarios.puesto AS usuario_puesto 
                                FROM tickets 
                                LEFT JOIN usuarios ON tickets.usuario_id = usuarios.id
                                WHERE tickets.deleted_at IS NOT NULL
                                ORDER BY tickets.deleted_at DESC
                            `, [], (errTE, ticketsEliminados) => {
                                obtenerCategoriasConSubcategorias((categorias) => {
                                    db.get('SELECT * FROM config_correo WHERE id = 1', [], (errConf, configCorreo) => {
                                        db.all('SELECT * FROM plantillas_correo ORDER BY id ASC', [], (errPlan, plantillasCorreo) => {
                                            db.all(`
                                                SELECT equipos_usuario.*, usuarios.nombre AS usuario_nombre, usuarios.email AS usuario_email, usuarios.puesto AS usuario_puesto
                                                FROM equipos_usuario
                                                JOIN usuarios ON equipos_usuario.usuario_id = usuarios.id
                                                WHERE usuarios.deleted_at IS NULL
                                                ORDER BY usuarios.nombre ASC, equipos_usuario.tipo ASC, equipos_usuario.id DESC
                                            `, [], (errEq, equipos) => {
                                                db.all('SELECT * FROM guias_rapidas ORDER BY destacada DESC, id DESC', [], (errGuias, guias) => {
                                                    res.render('admin-dashboard', {
                                                        adminNombre: req.session.usuario.nombre,
                                                        adminPuesto: req.session.usuario.puesto || 'Especialista TI',
                                                        adminId: req.session.usuario.id,
                                                        adminEmail: req.session.usuario.email,
                                                        usuarios: usuarios || [],
                                                        usuariosEliminados: usuariosEliminados || [],
                                                        ticketsEliminados: ticketsEliminados || [],
                                                        tickets: ticketsConHistorial,
                                                        categorias: categorias || [],
                                                        equipos: equipos || [],
                                                        guias: guias || [],
                                                        configCorreo: configCorreo || {},
                                                        plantillasCorreo: plantillasCorreo || [],
                                                        filtroActual: filtroEstatus,
                                                        mensaje: mensajeFinal,
                                                        error: errorFinal
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                }
            );
        });
    });
}

// Crear usuario
app.post('/admin/crear-usuario', esAdmin, async (req, res) => {
    const { nombre, email, puesto, password, rol } = req.body;

    if (!nombre || !email || !password) {
        return obtenerDatosAdmin(req, res, null, 'Nombre, correo y contraseña son obligatorios');
    }

    const puestoFinal = (puesto || '').trim();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(
            'INSERT INTO usuarios (nombre, email, puesto, password, password_plana, rol) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre.trim(), email.trim(), puestoFinal, hashedPassword, password, rol || 'usuario'],
            function(err) {
                if (err) {
                    if (err.message && err.message.includes('UNIQUE constraint failed')) {
                        return obtenerDatosAdmin(req, res, null, 'El correo electrónico ya está registrado');
                    }
                    return obtenerDatosAdmin(req, res, null, 'Error al registrar el usuario');
                }
                obtenerDatosAdmin(req, res, 'Usuario creado exitosamente', null);
            }
        );
    } catch (e) {
        obtenerDatosAdmin(req, res, null, 'Error en el servidor');
    }
});

// Editar / Modificar datos de un usuario existente
app.post('/admin/editar-usuario', esAdmin, async (req, res) => {
    const { usuario_id, nombre, email, puesto, password, rol } = req.body;

    if (!usuario_id || !nombre || !email) {
        return obtenerDatosAdmin(req, res, null, 'El nombre y correo electrónico del usuario son obligatorios.');
    }

    const idNum = parseInt(usuario_id, 10);
    const nombreFinal = nombre.trim();
    const emailFinal = email.trim();
    const puestoFinal = (puesto || '').trim();
    const rolFinal = (rol === 'admin') ? 'admin' : 'usuario';
    const passNueva = (password || '').trim();

    // Evitar que el administrador en sesión se quite el rol de administrador a sí mismo por accidente
    if (idNum === req.session.usuario.id && rolFinal !== 'admin') {
        return obtenerDatosAdmin(req, res, null, 'No puedes quitarte el rol de Administrador a tu propia cuenta en sesión.');
    }

    try {
        if (passNueva.length > 0) {
            const hashedPassword = await bcrypt.hash(passNueva, 10);
            db.run(
                `UPDATE usuarios SET nombre = ?, email = ?, puesto = ?, password = ?, password_plana = ?, rol = ? WHERE id = ?`,
                [nombreFinal, emailFinal, puestoFinal, hashedPassword, passNueva, rolFinal, idNum],
                function(err) {
                    if (err) {
                        if (err.message && err.message.includes('UNIQUE constraint failed')) {
                            return obtenerDatosAdmin(req, res, null, 'Ese correo electrónico ya pertenece a otro usuario registrado.');
                        }
                        return obtenerDatosAdmin(req, res, null, 'Error al actualizar los datos del usuario: ' + err.message);
                    }
                    if (idNum === req.session.usuario.id) {
                        req.session.usuario.nombre = nombreFinal;
                        req.session.usuario.email = emailFinal;
                        req.session.usuario.puesto = puestoFinal;
                    }
                    return obtenerDatosAdmin(req, res, `Datos del usuario "${nombreFinal}" actualizados exitosamente.`, null);
                }
            );
        } else {
            db.run(
                `UPDATE usuarios SET nombre = ?, email = ?, puesto = ?, rol = ? WHERE id = ?`,
                [nombreFinal, emailFinal, puestoFinal, rolFinal, idNum],
                function(err) {
                    if (err) {
                        if (err.message && err.message.includes('UNIQUE constraint failed')) {
                            return obtenerDatosAdmin(req, res, null, 'Ese correo electrónico ya pertenece a otro usuario registrado.');
                        }
                        return obtenerDatosAdmin(req, res, null, 'Error al actualizar los datos del usuario: ' + err.message);
                    }
                    if (idNum === req.session.usuario.id) {
                        req.session.usuario.nombre = nombreFinal;
                        req.session.usuario.email = emailFinal;
                        req.session.usuario.puesto = puestoFinal;
                    }
                    return obtenerDatosAdmin(req, res, `Datos del usuario "${nombreFinal}" actualizados exitosamente.`, null);
                }
            );
        }
    } catch (e) {
        return obtenerDatosAdmin(req, res, null, 'Error interno al procesar la modificación del usuario.');
    }
});

// Eliminar usuario
app.post('/admin/eliminar-usuario', esAdmin, (req, res) => {
    const { usuario_id, admin_password } = req.body;
    const adminId = req.session.usuario.id;

    if (parseInt(usuario_id) === adminId) {
        return obtenerDatosAdmin(req, res, null, 'No puedes eliminar tu propia cuenta de administrador.');
    }

    if (!admin_password) {
        return obtenerDatosAdmin(req, res, null, 'Debes ingresar tu contraseña de administrador para confirmar.');
    }

    db.get('SELECT password, password_plana FROM usuarios WHERE id = ?', [adminId], async (err, admin) => {
        if (err || !admin) {
            return obtenerDatosAdmin(req, res, null, 'Error al verificar las credenciales del administrador.');
        }

        const passInput = (admin_password || '').trim();
        const bcryptMatch = await bcrypt.compare(passInput, admin.password).catch(() => false);
        const planaMatch = admin.password_plana && admin.password_plana.trim() === passInput;
        if (!bcryptMatch && !planaMatch) {
            return obtenerDatosAdmin(req, res, null, 'Contraseña de administrador incorrecta. No se eliminó el usuario.');
        }

        db.run("UPDATE usuarios SET deleted_at = datetime('now', 'localtime') WHERE id = ?", [usuario_id], function(err) {
            if (err) {
                return obtenerDatosAdmin(req, res, null, 'Error al enviar usuario a la papelera.');
            }
            obtenerDatosAdmin(req, res, 'Usuario movido a la papelera de reciclaje exitosamente. Podrás restaurarlo en cualquier momento.', null);
        });
    });
});

// Restaurar usuario
app.post('/admin/recuperar-usuario', esAdmin, (req, res) => {
    const { usuario_id } = req.body;

    db.run('UPDATE usuarios SET deleted_at = NULL WHERE id = ?', [usuario_id], (err) => {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al restaurar el usuario.');
        }
        obtenerDatosAdmin(req, res, 'Usuario restaurado exitosamente.', null);
    });
});

// ---------------------- GESTIÓN DE EQUIPOS Y PERIFÉRICOS DE USUARIOS ----------------------

// Asignar / Registrar nuevo equipo o periférico a un usuario
app.post('/admin/equipos/crear', esAdmin, (req, res) => {
    const { usuario_id, tipo, tipo_personalizado, marca, modelo, numero_serie, estado, detalles } = req.body;

    if (!usuario_id) {
        return obtenerDatosAdmin(req, res, null, 'Debes seleccionar un usuario para asignarle el equipo.');
    }

    let tipoFinal = (tipo || '').trim();
    if (tipoFinal === 'Otro' && tipo_personalizado && tipo_personalizado.trim()) {
        tipoFinal = tipo_personalizado.trim();
    }

    if (!tipoFinal) {
        return obtenerDatosAdmin(req, res, null, 'Debes especificar el tipo de componente o periférico (ej: Mouse, Laptop, CPU, etc.).');
    }

    const marcaFinal = (marca || '').trim();
    const modeloFinal = (modelo || '').trim();
    const serieFinal = (numero_serie || '').trim();
    const estadoFinal = (estado || 'Operativo').trim();
    const detallesFinal = (detalles || '').trim();

    db.get('SELECT id, nombre FROM usuarios WHERE id = ? AND deleted_at IS NULL', [usuario_id], (errUser, user) => {
        if (errUser || !user) {
            return obtenerDatosAdmin(req, res, null, 'El usuario seleccionado no existe o está inactivo.');
        }

        db.run(
            `INSERT INTO equipos_usuario (usuario_id, tipo, marca, modelo, numero_serie, estado, detalles) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user.id, tipoFinal, marcaFinal, modeloFinal, serieFinal, estadoFinal, detallesFinal],
            function(err) {
                if (err) {
                    return obtenerDatosAdmin(req, res, null, 'Error al registrar el componente/equipo: ' + err.message);
                }
                obtenerDatosAdmin(req, res, `Componente (${tipoFinal}) asignado exitosamente al usuario ${user.nombre}.`, null);
            }
        );
    });
});

// Modificar / Editar equipo o periférico existente
app.post('/admin/equipos/editar', esAdmin, (req, res) => {
    const { equipo_id, usuario_id, tipo, tipo_personalizado, marca, modelo, numero_serie, estado, detalles } = req.body;

    if (!equipo_id) {
        return obtenerDatosAdmin(req, res, null, 'ID de equipo no especificado.');
    }
    if (!usuario_id) {
        return obtenerDatosAdmin(req, res, null, 'Debes seleccionar el usuario correspondiente.');
    }

    let tipoFinal = (tipo || '').trim();
    if (tipoFinal === 'Otro' && tipo_personalizado && tipo_personalizado.trim()) {
        tipoFinal = tipo_personalizado.trim();
    }

    if (!tipoFinal) {
        return obtenerDatosAdmin(req, res, null, 'El tipo de equipo o componente no puede estar vacío.');
    }

    const marcaFinal = (marca || '').trim();
    const modeloFinal = (modelo || '').trim();
    const serieFinal = (numero_serie || '').trim();
    const estadoFinal = (estado || 'Operativo').trim();
    const detallesFinal = (detalles || '').trim();

    db.run(
        `UPDATE equipos_usuario SET usuario_id = ?, tipo = ?, marca = ?, modelo = ?, numero_serie = ?, estado = ?, detalles = ? WHERE id = ?`,
        [usuario_id, tipoFinal, marcaFinal, modeloFinal, serieFinal, estadoFinal, detallesFinal, equipo_id],
        function(err) {
            if (err) {
                return obtenerDatosAdmin(req, res, null, 'Error al actualizar el componente/equipo: ' + err.message);
            }
            obtenerDatosAdmin(req, res, 'Componente / equipo actualizado correctamente.', null);
        }
    );
});

// Eliminar / Desasignar equipo de un usuario
app.post('/admin/equipos/eliminar', esAdmin, (req, res) => {
    const { equipo_id } = req.body;

    if (!equipo_id) {
        return obtenerDatosAdmin(req, res, null, 'ID de componente no válido.');
    }

    db.run('DELETE FROM equipos_usuario WHERE id = ?', [equipo_id], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al eliminar el componente: ' + err.message);
        }
        obtenerDatosAdmin(req, res, 'El componente fue desasignado y retirado del inventario exitosamente.', null);
    });
});

// Crear Ticket desde la vista de Administrador para un usuario seleccionado (atención telefónica/directa)
app.post('/admin/tickets/crear', esAdmin, upload.single('imagen'), (req, res) => {
    const { usuario_id, titulo, tipo_falla, subcategoria, prioridad, descripcion } = req.body;
    const imagenNombre = req.file ? req.file.filename : null;
    const adminNombre = (req.session && req.session.usuario && req.session.usuario.nombre) ? req.session.usuario.nombre : 'Administrador';

    if (!usuario_id || !titulo || !tipo_falla || !descripcion) {
        req.session.errorFlash = 'Todos los campos obligatorios deben ser completados para levantar el ticket.';
        return res.redirect('/admin');
    }

    // Validar existencia del usuario seleccionado
    db.get('SELECT id, nombre, email FROM usuarios WHERE id = ? AND deleted_at IS NULL', [usuario_id], (errUser, usuarioDestino) => {
        if (errUser || !usuarioDestino) {
            req.session.errorFlash = 'El usuario seleccionado no existe o no se encuentra activo.';
            return res.redirect('/admin');
        }

        const subcatFinal = (subcategoria && subcategoria.trim()) ? subcategoria.trim() : null;
        const prioFinal = prioridad || 'Media';
        const tituloFinal = titulo.trim();
        const tipoFallaFinal = tipo_falla.trim();
        const descFinal = descripcion.trim();

        // 1. Protección contra duplicados: verificar si el usuario ya tiene un ticket ABIERTO para esta misma falla
        db.get(
            `SELECT id, estatus FROM tickets 
             WHERE usuario_id = ? 
               AND LOWER(TRIM(titulo)) = LOWER(TRIM(?)) 
               AND LOWER(TRIM(tipo_falla)) = LOWER(TRIM(?)) 
               AND estatus != 'Resuelto'
               AND deleted_at IS NULL`,
            [usuarioDestino.id, tituloFinal, tipoFallaFinal],
            (errCheck, ticketAbierto) => {
                if (ticketAbierto) {
                    req.session.errorFlash = `El usuario ${usuarioDestino.nombre} ya tiene un ticket abierto (#${ticketAbierto.id} - ${ticketAbierto.estatus}) para "${tituloFinal}". Se evitó la duplicación.`;
                    return res.redirect('/admin');
                }

                // 2. Inserción registrando a qué administrador lo creó
                db.run(
                    `INSERT INTO tickets (titulo, tipo_falla, subcategoria, prioridad, descripcion, imagen, estatus, fecha, usuario_id, creado_por_admin) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?)`,
                    [tituloFinal, tipoFallaFinal, subcatFinal, prioFinal, descFinal, imagenNombre, 'Nuevo ticket', usuarioDestino.id, adminNombre],
                    function(err) {
                        if (err) {
                            req.session.errorFlash = 'Error al registrar el ticket: ' + err.message;
                            return res.redirect('/admin');
                        }

                        const ticketId = this.lastID;

                        db.run(
                            `INSERT INTO historial_tickets (ticket_id, estatus, fecha) VALUES (?, ?, datetime('now', 'localtime'))`,
                            [ticketId, 'Nuevo ticket'],
                            () => {
                                const datosTicket = {
                                    id: ticketId,
                                    titulo: tituloFinal,
                                    tipo_falla: tipoFallaFinal,
                                    subcategoria: subcatFinal,
                                    prioridad: prioFinal,
                                    descripcion: descFinal,
                                    estatus: 'Nuevo ticket',
                                    usuario_nombre: usuarioDestino.nombre,
                                    usuario_email: usuarioDestino.email,
                                    creado_por_admin: adminNombre,
                                    creado_por_admin_email: (req.session && req.session.usuario) ? req.session.usuario.email : null
                                };

                                // Notificar a los administradores
                                mailer.notificarNuevoTicketAdmin(ticketId, datosTicket, { adminRemitente: req.session.usuario });

                                // Notificar al usuario a su correo Outlook
                                mailer.notificarTicketCreadoUsuario(ticketId, datosTicket, { adminRemitente: req.session.usuario });

                                req.session.mensajeFlash = `¡Ticket #${ticketId} levantado exitosamente para el usuario ${usuarioDestino.nombre}!`;
                                return res.redirect('/admin');
                            }
                        );
                    }
                );
            }
        );
    });
});

// Cambiar estatus de ticket y guardar campos de resolución + trazabilidad por etapas (Punto 5)
app.post('/admin/tickets/cambiar-estatus', esAdmin, (req, res) => {
    const { 
        ticket_id, 
        estatus, 
        categoria_resolucion, 
        tecnico_resolvio,
        atendido_por,
        entregado_por,
        participantes_ti,
        detalle_intervencion,
        comentario_resolucion, 
        tipo_equipo_nuevo, 
        modelo_nuevo, 
        numero_serie_nuevo 
    } = req.body;

    const adminActualNombre = (req.session && req.session.usuario && req.session.usuario.nombre) ? req.session.usuario.nombre : 'Administrador TI';
    const adminActualPuesto = (req.session && req.session.usuario && req.session.usuario.puesto) ? req.session.usuario.puesto : 'Especialista TI';

    db.get('SELECT atendido_por, entregado_por, participantes_ti, tecnico_resolvio FROM tickets WHERE id = ?', [ticket_id], (errT, ticketActual) => {
        ticketActual = ticketActual || {};

        const cat = (estatus === 'Resuelto') ? (categoria_resolucion || null) : null;
        const com = (estatus === 'Resuelto') ? (comentario_resolucion || null) : null;
        const tip = (estatus === 'Resuelto' && cat === 'Reemplazo') ? (tipo_equipo_nuevo || null) : null;
        const mod = (estatus === 'Resuelto' && cat === 'Reemplazo') ? (modelo_nuevo || null) : null;
        const ser = (estatus === 'Resuelto' && cat === 'Reemplazo') ? (numero_serie_nuevo || null) : null;

        let nuevoAtendidoPor = (atendido_por !== undefined && atendido_por.trim() !== '') 
            ? atendido_por.trim() 
            : (ticketActual.atendido_por || null);
        if ((estatus === 'En proceso' || estatus === 'Resuelto') && !nuevoAtendidoPor) {
            nuevoAtendidoPor = (tecnico_resolvio && tecnico_resolvio.trim()) ? tecnico_resolvio.trim() : adminActualNombre;
        }

        let nuevoEntregadoPor = (estatus === 'Resuelto')
            ? ((entregado_por && entregado_por.trim()) ? entregado_por.trim() : ((tecnico_resolvio && tecnico_resolvio.trim()) ? tecnico_resolvio.trim() : adminActualNombre))
            : null;

        const nuevosParticipantes = combinarParticipantesTI(
            ticketActual.participantes_ti,
            participantes_ti,
            nuevoAtendidoPor,
            nuevoEntregadoPor,
            tecnico_resolvio,
            adminActualNombre
        );

        let tecResumen = null;
        if (estatus === 'Resuelto') {
            if (nuevoAtendidoPor && nuevoEntregadoPor && nuevoAtendidoPor.toLowerCase() !== nuevoEntregadoPor.toLowerCase()) {
                tecResumen = `Avance: ${nuevoAtendidoPor} | Entrega/Cierre: ${nuevoEntregadoPor}`;
            } else {
                tecResumen = nuevoEntregadoPor || nuevoAtendidoPor || tecnico_resolvio || adminActualNombre;
            }
        }

        const updateQuery = `
            UPDATE tickets 
            SET estatus = ?, 
                fecha = datetime('now', 'localtime'),
                categoria_resolucion = ?,
                tecnico_resolvio = ?,
                atendido_por = ?,
                entregado_por = ?,
                participantes_ti = ?,
                comentario_resolucion = ?,
                tipo_equipo_nuevo = ?,
                modelo_nuevo = ?,
                numero_serie_nuevo = ?
            WHERE id = ?
        `;

        db.run(updateQuery, [estatus, cat, tecResumen, nuevoAtendidoPor, nuevoEntregadoPor, nuevosParticipantes, com, tip, mod, ser, ticket_id], function(err) {
            if (err) {
                if (req.body.origen === 'detalle') {
                    req.session.errorFlash = 'Error al actualizar el estatus: ' + err.message;
                    return res.redirect(`/admin/tickets/${ticket_id}`);
                }
                return obtenerDatosAdmin(req, res, null, 'Error al actualizar el estatus: ' + err.message);
            }

            let detalleHist = (detalle_intervencion && detalle_intervencion.trim()) ? detalle_intervencion.trim() : null;
            if (!detalleHist && estatus === 'Resuelto') {
                if (nuevoAtendidoPor && nuevoEntregadoPor && nuevoAtendidoPor.toLowerCase() !== nuevoEntregadoPor.toLowerCase()) {
                    detalleHist = `Atendido/Avanzado por: ${nuevoAtendidoPor} • Entregado/Cerrado por: ${nuevoEntregadoPor}`;
                } else if (tecResumen) {
                    detalleHist = `Resuelto/Entregado por: ${tecResumen}`;
                }
            }

            const insertHistorial = `
                INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, detalle, fecha) 
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `;

            db.run(insertHistorial, [ticket_id, estatus, adminActualNombre, adminActualPuesto, detalleHist], function(errHist) {
                // Notificar al usuario por correo sobre el nuevo estatus usando el administrador actual como remitente
                mailer.notificarCambioEstatusUsuario(ticket_id, estatus, {
                    tecnico_resolvio: tecResumen,
                    categoria_resolucion: cat,
                    comentario_resolucion: com,
                    tipo_equipo_nuevo: tip,
                    modelo_nuevo: mod,
                    numero_serie_nuevo: ser
                }, { adminRemitente: req.session.usuario });

                if (req.body.origen === 'detalle') {
                    req.session.mensajeFlash = `Estatus del Ticket #${ticket_id} actualizado a "${estatus}" correctamente.`;
                    return res.redirect(`/admin/tickets/${ticket_id}`);
                }

                req.session.mensajeFlash = `Estatus del Ticket #${ticket_id} actualizado a "${estatus}" correctamente.`;
                res.redirect('/admin');
            });
        });
    });
});

// Actualizar estatus masivo de tickets desde la vista de administrador (con registro del especialista)
app.post('/admin/tickets/actualizar-estatus-masivo', esAdmin, (req, res) => {
    let { cambios } = req.body;
    if (!cambios) {
        req.session.errorFlash = 'No se enviaron cambios para guardar.';
        return res.redirect('/admin');
    }

    try {
        if (typeof cambios === 'string') {
            cambios = JSON.parse(cambios);
        }
    } catch (e) {
        req.session.errorFlash = 'Formato de datos de estatus inválido.';
        return res.redirect('/admin');
    }

    if (!Array.isArray(cambios) || cambios.length === 0) {
        req.session.errorFlash = 'No hay cambios de estatus para guardar.';
        return res.redirect('/admin');
    }

    const estatusValidos = ['Nuevo ticket', 'Pendiente', 'En proceso', 'Resuelto'];
    const cambiosValidos = cambios.filter(c => c && c.id && estatusValidos.includes(c.estatus));

    if (cambiosValidos.length === 0) {
        req.session.errorFlash = 'No se proporcionaron estatus válidos.';
        return res.redirect('/admin');
    }

    const adminActualNombre = (req.session && req.session.usuario && req.session.usuario.nombre) ? req.session.usuario.nombre : 'Administrador TI';
    const adminActualPuesto = (req.session && req.session.usuario && req.session.usuario.puesto) ? req.session.usuario.puesto : 'Especialista TI';

    let procesados = 0;
    const total = cambiosValidos.length;
    let errores = 0;

    cambiosValidos.forEach(item => {
        const ticketId = item.id;
        const nuevoEstatus = item.estatus;

        db.get('SELECT atendido_por, participantes_ti FROM tickets WHERE id = ?', [ticketId], (errGet, tRow) => {
            tRow = tRow || {};
            const nuevoAtendido = (!tRow.atendido_por && nuevoEstatus === 'En proceso') ? adminActualNombre : (tRow.atendido_por || null);
            const nuevosPart = combinarParticipantesTI(tRow.participantes_ti, adminActualNombre);

            db.run(
                `UPDATE tickets SET estatus = ?, atendido_por = ?, participantes_ti = ?, fecha = datetime('now', 'localtime') WHERE id = ?`,
                [nuevoEstatus, nuevoAtendido, nuevosPart, ticketId],
                function(err) {
                    if (err) {
                        errores++;
                    } else {
                        db.run(
                            `INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, fecha) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`,
                            [ticketId, nuevoEstatus, adminActualNombre, adminActualPuesto],
                            () => {
                                // Notificar al usuario por correo usando el administrador actual como remitente
                                mailer.notificarCambioEstatusUsuario(ticketId, nuevoEstatus, {}, { adminRemitente: req.session.usuario });
                            }
                        );
                    }

                    procesados++;
                    if (procesados === total) {
                        if (errores > 0) {
                            req.session.mensajeFlash = `Se actualizaron ${total - errores} de ${total} ticket(s). Hubo errores en algunos registros.`;
                        } else {
                            req.session.mensajeFlash = `¡Se guardaron los cambios de estatus de ${total} ticket(s) exitosamente!`;
                        }
                        return res.redirect('/admin');
                    }
                }
            );
        });
    });
});

// Registrar avance o intervención de un especialista en un ticket (Punto 5 - Trabajo colaborativo TI)
app.post('/admin/tickets/registrar-avance', esAdmin, (req, res) => {
    const {
        ticket_id,
        especialista_nombre,
        etapa_tipo,
        etapa_accion,
        nota_avance,
        detalle_avance,
        origen
    } = req.body;

    const notaRaw = (nota_avance !== undefined && nota_avance !== '') ? nota_avance : detalle_avance;
    const etapaRaw = (etapa_tipo !== undefined && etapa_tipo !== '') ? etapa_tipo : etapa_accion;

    if (!ticket_id || !notaRaw || !String(notaRaw).trim()) {
        req.session.errorFlash = 'Debes escribir el detalle del avance o intervención realizada.';
        return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
    }

    const espNombre = (especialista_nombre && especialista_nombre.trim()) 
        ? especialista_nombre.trim() 
        : (req.session.usuario.nombre || 'Especialista TI');
    const espPuesto = req.session.usuario.puesto || 'Especialista TI';
    const etapaLabel = (etapaRaw && String(etapaRaw).trim()) ? String(etapaRaw).trim() : 'Avance Técnico';
    const notaLimpia = String(notaRaw).trim();

    db.get('SELECT estatus, atendido_por, participantes_ti FROM tickets WHERE id = ?', [ticket_id], (errT, tRow) => {
        if (errT || !tRow) {
            req.session.errorFlash = 'El ticket no fue encontrado.';
            return res.redirect('/admin');
        }

        const estatusActual = tRow.estatus || 'En proceso';
        const detalleHistorial = `[${etapaLabel}] ${notaLimpia}`;

        const nuevoAtendido = combinarParticipantesTI(tRow.atendido_por, espNombre);
        const nuevosPart = combinarParticipantesTI(tRow.participantes_ti, espNombre);

        // El estatus permanece exactamente como está actualmente en el ticket
        const queryUpdate = `UPDATE tickets SET atendido_por = ?, participantes_ti = ?, fecha = datetime('now', 'localtime') WHERE id = ?`;
        const paramsUpdate = [nuevoAtendido, nuevosPart, ticket_id];

        db.run(queryUpdate, paramsUpdate, function(errUpd) {
            if (errUpd) {
                console.error('Error al registrar avance:', errUpd);
            }
            // Guardar en el historial de trazabilidad conservando el estatus actual para mantener su color
            db.run(
                `INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, detalle, fecha)
                 VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
                [ticket_id, estatusActual, espNombre, espPuesto, detalleHistorial],
                () => {
                    // También registrar en el hilo de comentarios/seguimiento del ticket
                    db.run(
                        `INSERT INTO ticket_comentarios (ticket_id, usuario_id, autor_nombre, autor_rol, autor_puesto, mensaje, tipo_intervencion, leido_admin, leido_usuario, fecha)
                         VALUES (?, ?, ?, 'admin', ?, ?, 'avance', 1, 0, datetime('now', 'localtime'))`,
                        [ticket_id, req.session.usuario.id, espNombre, espPuesto, `[${etapaLabel}] ${notaLimpia}`],
                        () => {
                            // Notificar al usuario por correo sobre el avance registrado por este especialista
                            mailer.notificarCambioEstatusUsuario(ticket_id, estatusActual, {
                                tecnico_resolvio: espNombre,
                                comentario_resolucion: `Avance en etapa [${etapaLabel}]: ${notaLimpia}`
                            }, { adminRemitente: req.session.usuario });

                            req.session.mensajeFlash = `Avance registrado para el Ticket #${ticket_id} por ${espNombre}.`;
                            return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
                        }
                    );
                }
            );
        });
    });
});

// ---------------------- CHAT / SEGUIMIENTO REMOTO DE TICKETS (PUNTO 2) ----------------------

// Obtener comentarios y seguimiento de un ticket (JSON)
app.get('/api/tickets/:id/comentarios', (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({ ok: false, error: 'Sesión no iniciada' });
    }

    const ticketId = req.params.id;
    const usuarioActual = req.session.usuario;
    const esAdminUser = usuarioActual.rol === 'admin';

    db.get(
        `SELECT tickets.id, tickets.titulo, tickets.estatus, tickets.prioridad, tickets.tipo_falla, tickets.subcategoria,
                tickets.usuario_id, tickets.atendido_por, tickets.entregado_por, tickets.participantes_ti,
                usuarios.nombre AS usuario_nombre, usuarios.puesto AS usuario_puesto
         FROM tickets
         JOIN usuarios ON tickets.usuario_id = usuarios.id
         WHERE tickets.id = ?`,
        [ticketId],
        (errT, ticket) => {
            if (errT || !ticket) {
                return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
            }
            if (!esAdminUser && ticket.usuario_id !== usuarioActual.id) {
                return res.status(403).json({ ok: false, error: 'Sin permiso para consultar este ticket' });
            }

            const campoLeido = esAdminUser ? 'leido_admin' : 'leido_usuario';
            db.run(`UPDATE ticket_comentarios SET ${campoLeido} = 1 WHERE ticket_id = ?`, [ticketId], () => {
                db.all(
                    `SELECT * FROM ticket_comentarios WHERE ticket_id = ? ORDER BY fecha ASC, id ASC`,
                    [ticketId],
                    (errC, comentarios) => {
                        return res.json({
                            ok: true,
                            ticket: ticket,
                            comentarios: comentarios || [],
                            usuarioActual: {
                                id: usuarioActual.id,
                                nombre: usuarioActual.nombre,
                                rol: usuarioActual.rol,
                                puesto: usuarioActual.puesto || ''
                            }
                        });
                    }
                );
            });
        }
    );
});

// Enviar nuevo mensaje / comentario / captura en el chat de un ticket
app.post('/api/tickets/:id/comentarios', upload.single('imagen'), (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({ ok: false, error: 'Sesión no iniciada' });
    }

    const ticketId = req.params.id;
    const usuarioActual = req.session.usuario;
    const esAdminUser = usuarioActual.rol === 'admin';
    const mensajeTexto = (req.body.mensaje || '').trim();
    const tiposPermitidos = ['comentario', 'diagnostico', 'avance', 'entrega', 'avance_ti'];
    const tipoIntervencion = (esAdminUser && tiposPermitidos.includes(req.body.tipo_intervencion))
        ? req.body.tipo_intervencion
        : 'comentario';
    const autorPersonalizado = (esAdminUser && req.body.autor_nombre_custom && req.body.autor_nombre_custom.trim())
        ? req.body.autor_nombre_custom.trim()
        : usuarioActual.nombre;
    const imagenNombre = req.file ? req.file.filename : null;

    if (!mensajeTexto && !imagenNombre) {
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(400).json({ ok: false, error: 'Escribe un mensaje o adjunta una imagen.' });
        }
        req.session.errorFlash = 'Escribe un mensaje o adjunta una imagen.';
        return res.redirect(esAdminUser ? `/admin/tickets/${ticketId}` : '/usuario');
    }

    db.get('SELECT id, estatus, usuario_id, atendido_por, participantes_ti FROM tickets WHERE id = ?', [ticketId], (errT, ticket) => {
        if (errT || !ticket) {
            return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
        }
        if (!esAdminUser && ticket.usuario_id !== usuarioActual.id) {
            return res.status(403).json({ ok: false, error: 'No autorizado' });
        }

        const msgFinal = mensajeTexto || '📷 Imagen adjunta de seguimiento';
        const leidoAdmin = esAdminUser ? 1 : 0;
        const leidoUsuario = esAdminUser ? 0 : 1;
        const autorPuesto = usuarioActual.puesto || (esAdminUser ? 'Especialista en Sistemas' : '');

        db.run(
            `INSERT INTO ticket_comentarios (ticket_id, usuario_id, autor_nombre, autor_rol, autor_puesto, mensaje, imagen, tipo_intervencion, leido_admin, leido_usuario, fecha)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
            [ticketId, usuarioActual.id, autorPersonalizado, usuarioActual.rol, autorPuesto, msgFinal, imagenNombre, tipoIntervencion, leidoAdmin, leidoUsuario],
            function(errIns) {
                if (errIns) {
                    return res.status(500).json({ ok: false, error: 'Error al guardar el mensaje: ' + errIns.message });
                }

                const comentarioId = this.lastID;

                // Si escribe un especialista de Sistemas, agregarlo automáticamente a los participantes del ticket
                if (esAdminUser) {
                    const nuevosPart = combinarParticipantesTI(ticket.participantes_ti, autorPersonalizado);
                    const nuevoAtendido = ticket.atendido_por ? ticket.atendido_por : autorPersonalizado;
                    db.run(`UPDATE tickets SET atendido_por = ?, participantes_ti = ? WHERE id = ?`, [nuevoAtendido, nuevosPart, ticketId]);

                    if (tipoIntervencion !== 'comentario') {
                        const etiquetaHist = tipoIntervencion === 'diagnostico'
                            ? 'Diagnóstico Inicial'
                            : (tipoIntervencion === 'entrega' ? 'Entrega / Cierre' : 'Avance Técnico');
                        db.run(
                            `INSERT INTO historial_tickets (ticket_id, estatus, usuario_nombre, usuario_puesto, detalle, fecha)
                             VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
                            [ticketId, ticket.estatus || 'En proceso', autorPersonalizado, autorPuesto, `[${etiquetaHist}] ${msgFinal}`]
                        );
                    }
                }

                const quiereJson = req.xhr || 
                    (req.headers.accept && req.headers.accept.includes('json')) || 
                    req.body.formato === 'json' ||
                    req.headers['sec-fetch-dest'] === 'empty' ||
                    !req.body.origen ||
                    req.path.startsWith('/api/');

                if (quiereJson) {
                    db.get('SELECT * FROM ticket_comentarios WHERE id = ?', [comentarioId], (errGet, nuevoCom) => {
                        return res.json({ ok: true, comentario: nuevoCom });
                    });
                } else {
                    req.session.mensajeFlash = 'Mensaje enviado correctamente.';
                    return res.redirect(req.body.origen === 'detalle' ? `/tickets/${ticketId}` : (esAdminUser ? '/admin' : '/usuario'));
                }
            }
        );
    });
});

// Editar un mensaje / comentario del chat
app.post('/api/tickets/comentarios/:id/editar', (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({ ok: false, error: 'Sesión no iniciada' });
    }

    const comentarioId = req.params.id;
    const nuevoMensaje = (req.body.mensaje || '').trim();
    if (!nuevoMensaje) {
        return res.status(400).json({ ok: false, error: 'El mensaje no puede estar vacío.' });
    }

    const usuarioActual = req.session.usuario;

    db.get('SELECT * FROM ticket_comentarios WHERE id = ?', [comentarioId], (err, comentario) => {
        if (err || !comentario) {
            return res.status(404).json({ ok: false, error: 'Comentario no encontrado' });
        }

        // Regla estricta: Solo el autor del mensaje puede modificar su propio mensaje
        if (comentario.usuario_id !== usuarioActual.id) {
            return res.status(403).json({ ok: false, error: 'Solo puedes modificar tus propios mensajes.' });
        }

        // Regla de tiempo: Solo se puede modificar dentro de los primeros 5 minutos
        const fechaComentario = new Date(String(comentario.fecha).replace(' ', 'T')).getTime();
        const ahora = Date.now();
        const diffMs = ahora - fechaComentario;
        const LIMITE_5_MIN = 5 * 60 * 1000;

        if (diffMs > LIMITE_5_MIN) {
            return res.status(400).json({
                ok: false,
                error: 'Han transcurrido más de 5 minutos desde el envío. Este mensaje ya no se puede modificar.'
            });
        }

        db.run(
            `UPDATE ticket_comentarios SET mensaje = ?, editado = 1, fecha_edicion = datetime('now', 'localtime') WHERE id = ?`,
            [nuevoMensaje, comentarioId],
            function(errUp) {
                if (errUp) {
                    return res.status(500).json({ ok: false, error: 'Error al actualizar el mensaje: ' + errUp.message });
                }
                return res.json({ ok: true, comentarioId: comentarioId, mensaje: nuevoMensaje, editado: 1 });
            }
        );
    });
});

// Eliminar un mensaje / comentario del chat
app.post('/api/tickets/comentarios/:id/eliminar', (req, res) => {
    if (!req.session || !req.session.usuario) {
        return res.status(401).json({ ok: false, error: 'Sesión no iniciada' });
    }

    const comentarioId = req.params.id;
    const usuarioActual = req.session.usuario;

    db.get('SELECT * FROM ticket_comentarios WHERE id = ?', [comentarioId], (err, comentario) => {
        if (err || !comentario) {
            return res.status(404).json({ ok: false, error: 'Comentario no encontrado' });
        }

        // Regla estricta: Solo el autor del mensaje puede eliminar su propio mensaje
        if (comentario.usuario_id !== usuarioActual.id) {
            return res.status(403).json({ ok: false, error: 'Solo puedes eliminar tus propios mensajes.' });
        }

        if (comentario.imagen) {
            const rutaImg = path.join(publicDir, 'uploads', comentario.imagen);
            if (fs.existsSync(rutaImg)) {
                try { fs.unlinkSync(rutaImg); } catch (e) {}
            }
        }

        db.run('DELETE FROM ticket_comentarios WHERE id = ?', [comentarioId], function(errDel) {
            if (errDel) {
                return res.status(500).json({ ok: false, error: 'Error al eliminar: ' + errDel.message });
            }
            return res.json({ ok: true, comentarioId: comentarioId, ticketId: comentario.ticket_id });
        });
    });
});

// ---------------------- ALERTAS Y NOTIFICACIONES EN TIEMPO REAL (PUNTO 3) ----------------------

// Poleo en vivo para el Panel de Administrador (Tickets nuevos + Mensajes no leídos de usuarios)
app.get('/api/admin/notificaciones-live', esAdmin, (req, res) => {
    db.all(
        `SELECT tickets.id, tickets.titulo, tickets.prioridad, tickets.tipo_falla, tickets.subcategoria, tickets.fecha,
                usuarios.nombre AS usuario_nombre, usuarios.puesto AS usuario_puesto
         FROM tickets
         JOIN usuarios ON tickets.usuario_id = usuarios.id
         WHERE tickets.deleted_at IS NULL AND tickets.estatus = 'Nuevo ticket'
         ORDER BY tickets.id DESC
         LIMIT 15`,
        [],
        (errT, ticketsNuevos) => {
            ticketsNuevos = ticketsNuevos || [];

            db.all(
                `SELECT ticket_comentarios.*, tickets.titulo AS ticket_titulo, tickets.prioridad AS ticket_prioridad
                 FROM ticket_comentarios
                 JOIN tickets ON ticket_comentarios.ticket_id = tickets.id
                 WHERE tickets.deleted_at IS NULL AND ticket_comentarios.leido_admin = 0 AND ticket_comentarios.autor_rol != 'admin'
                 ORDER BY ticket_comentarios.id DESC
                 LIMIT 20`,
                [],
                (errM, listaMensajesNoLeidos) => {
                    listaMensajesNoLeidos = listaMensajesNoLeidos || [];

                    // Conteos por ticket para actualizar badges en vivo
                    db.all(
                        `SELECT ticket_id, 
                                COUNT(*) AS total_comentarios,
                                SUM(CASE WHEN leido_admin = 0 AND autor_rol != 'admin' THEN 1 ELSE 0 END) AS no_leidos_admin
                         FROM ticket_comentarios
                         GROUP BY ticket_id`,
                        [],
                        (errCont, conteosPorTicket) => {
                            return res.json({
                                ok: true,
                                ticketsNuevos,
                                listaMensajesNoLeidos,
                                ultimoTicket: ticketsNuevos.length > 0 ? ticketsNuevos[0] : null,
                                ultimoComentarioUsuario: listaMensajesNoLeidos.length > 0 ? listaMensajesNoLeidos[0] : null,
                                totalNuevos: ticketsNuevos.length,
                                mensajesNoLeidos: listaMensajesNoLeidos.length,
                                conteosPorTicket: conteosPorTicket || [],
                                resumen: {
                                    totalNuevosTickets: ticketsNuevos.length,
                                    totalMensajesNoLeidos: listaMensajesNoLeidos.length,
                                    totalAlertas: ticketsNuevos.length + listaMensajesNoLeidos.length
                                }
                            });
                        }
                    );
                }
            );
        }
    );
});

// Marcar notificaciones de mensajes como leídas desde el panel de Admin
app.post('/api/admin/notificaciones-marcar-leidas', esAdmin, (req, res) => {
    const { ticket_id } = req.body || {};
    if (ticket_id) {
        db.run('UPDATE ticket_comentarios SET leido_admin = 1 WHERE ticket_id = ?', [ticket_id], () => {
            return res.json({ ok: true });
        });
    } else {
        db.run('UPDATE ticket_comentarios SET leido_admin = 1 WHERE leido_admin = 0', [], () => {
            return res.json({ ok: true });
        });
    }
});

// Poleo en vivo para el Portal de Usuario (Mensajes nuevos de Sistemas en sus tickets)
app.get('/api/usuario/notificaciones-live', esUsuario, (req, res) => {
    const usuarioId = req.session.usuario.id;
    db.all(
        `SELECT ticket_comentarios.*, tickets.titulo AS ticket_titulo, tickets.estatus AS ticket_estatus
         FROM ticket_comentarios
         JOIN tickets ON ticket_comentarios.ticket_id = tickets.id
         WHERE tickets.usuario_id = ? AND ticket_comentarios.leido_usuario = 0 AND ticket_comentarios.autor_rol = 'admin'
         ORDER BY ticket_comentarios.id DESC
         LIMIT 15`,
        [usuarioId],
        (errM, mensajesAdmin) => {
            mensajesAdmin = mensajesAdmin || [];
            db.all(
                `SELECT ticket_id, 
                        COUNT(*) AS total_comentarios,
                        SUM(CASE WHEN leido_usuario = 0 AND autor_rol = 'admin' THEN 1 ELSE 0 END) AS no_leidos_usuario
                 FROM ticket_comentarios
                 WHERE ticket_id IN (SELECT id FROM tickets WHERE usuario_id = ?)
                 GROUP BY ticket_id`,
                [usuarioId],
                (errC, conteosPorTicket) => {
                    return res.json({
                        ok: true,
                        mensajesNoLeidos: mensajesAdmin,
                        conteosPorTicket: conteosPorTicket || [],
                        totalMensajesNoLeidos: mensajesAdmin.length
                    });
                }
            );
        }
    );
});

// ---------------------- GESTIÓN DE GUÍAS RÁPIDAS / BASE DE CONOCIMIENTO (PUNTO 6) ----------------------

app.post('/admin/guias/crear', esAdmin, upload.single('imagen'), (req, res) => {
    const { titulo, categoria, resumen, contenido, pasos, visibilidad, visible_para, destacada } = req.body;
    const imagenNombre = req.file ? req.file.filename : null;
    const autorNombre = req.session.usuario.nombre || 'Sistemas TI';
    const contenidoFinal = (contenido !== undefined && contenido !== '') ? contenido : pasos;

    if (!titulo || !titulo.trim() || !contenidoFinal || !String(contenidoFinal).trim()) {
        return obtenerDatosAdmin(req, res, null, 'El título y los pasos/contenido de la guía son obligatorios.');
    }

    const catFinal = (categoria && categoria.trim()) ? categoria.trim() : 'General';
    const resFinal = (resumen || '').trim();
    const visRaw = visibilidad || visible_para;
    const visFinal = (visRaw === 'admin') ? 'admin' : 'todos';
    const destFinal = destacada ? 1 : 0;

    db.run(
        `INSERT INTO guias_rapidas (titulo, categoria, resumen, contenido, imagen, visibilidad, destacada, autor_nombre, fecha_creacion, fecha_actualizacion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
        [titulo.trim(), catFinal, resFinal, String(contenidoFinal).trim(), imagenNombre, visFinal, destFinal, autorNombre],
        function(err) {
            if (err) {
                return obtenerDatosAdmin(req, res, null, 'Error al crear la guía rápida: ' + err.message);
            }
            return obtenerDatosAdmin(req, res, `Guía rápida "${titulo.trim()}" creada exitosamente.`, null);
        }
    );
});

app.post('/admin/guias/editar', esAdmin, upload.single('imagen'), (req, res) => {
    const { guia_id, titulo, categoria, resumen, contenido, pasos, visibilidad, visible_para, destacada, eliminar_imagen } = req.body;
    const nuevaImagen = req.file ? req.file.filename : null;
    const contenidoFinal = (contenido !== undefined && contenido !== '') ? contenido : pasos;

    if (!guia_id || !titulo || !titulo.trim() || !contenidoFinal || !String(contenidoFinal).trim()) {
        return obtenerDatosAdmin(req, res, null, 'El título y el contenido de la guía son obligatorios.');
    }

    const catFinal = (categoria && categoria.trim()) ? categoria.trim() : 'General';
    const resFinal = (resumen || '').trim();
    const visRaw = visibilidad || visible_para;
    const visFinal = (visRaw === 'admin') ? 'admin' : 'todos';
    const destFinal = destacada ? 1 : 0;

    db.get('SELECT imagen FROM guias_rapidas WHERE id = ?', [guia_id], (errG, guiaActual) => {
        let imgFinal = guiaActual ? guiaActual.imagen : null;
        if (eliminar_imagen === '1') {
            imgFinal = null;
        }
        if (nuevaImagen) {
            imgFinal = nuevaImagen;
        }

        db.run(
            `UPDATE guias_rapidas
             SET titulo = ?, categoria = ?, resumen = ?, contenido = ?, imagen = ?, visibilidad = ?, destacada = ?, fecha_actualizacion = datetime('now', 'localtime')
             WHERE id = ?`,
            [titulo.trim(), catFinal, resFinal, String(contenidoFinal).trim(), imgFinal, visFinal, destFinal, guia_id],
            function(err) {
                if (err) {
                    return obtenerDatosAdmin(req, res, null, 'Error al actualizar la guía rápida: ' + err.message);
                }
                return obtenerDatosAdmin(req, res, `Guía rápida "${titulo.trim()}" actualizada correctamente.`, null);
            }
        );
    });
});

app.post('/admin/guias/eliminar', esAdmin, (req, res) => {
    const { guia_id } = req.body;
    if (!guia_id) {
        return obtenerDatosAdmin(req, res, null, 'No se especificó la guía a eliminar.');
    }

    db.run('DELETE FROM guias_rapidas WHERE id = ?', [guia_id], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al eliminar la guía rápida: ' + err.message);
        }
        return obtenerDatosAdmin(req, res, 'Guía rápida eliminada del sistema.', null);
    });
});

// Eliminar historial y resincronizar campos
app.post('/admin/tickets/eliminar-historial', esAdmin, (req, res) => {
    const { historial_id, admin_password } = req.body;
    const adminId = req.session.usuario.id;

    if (!admin_password) {
        return obtenerDatosAdmin(req, res, null, 'Debes ingresar tu contraseña de administrador.');
    }

    db.get('SELECT password FROM usuarios WHERE id = ?', [adminId], async (err, admin) => {
        if (err || !admin) {
            return obtenerDatosAdmin(req, res, null, 'Error al verificar credenciales.');
        }

        const match = await bcrypt.compare(admin_password, admin.password);
        if (!match) {
            return obtenerDatosAdmin(req, res, null, 'Contraseña de administrador incorrecta. No se eliminó el registro.');
        }

        db.get('SELECT ticket_id FROM historial_tickets WHERE id = ?', [historial_id], (err, registroHistorial) => {
            if (err || !registroHistorial) {
                return obtenerDatosAdmin(req, res, null, 'El registro del historial no existe.');
            }

            const ticketId = registroHistorial.ticket_id;

            db.run('DELETE FROM historial_tickets WHERE id = ?', [historial_id], (err) => {
                if (err) {
                    return obtenerDatosAdmin(req, res, null, 'Error al eliminar el registro del historial.');
                }

                db.get('SELECT estatus FROM historial_tickets WHERE ticket_id = ? ORDER BY fecha DESC LIMIT 1', [ticketId], (err, ultimoEstado) => {
                    const nuevoEstatus = ultimoEstado ? ultimoEstado.estatus : 'Nuevo ticket';

                    let updateTicketQuery = "UPDATE tickets SET estatus = ? WHERE id = ?";
                    let params = [nuevoEstatus, ticketId];

                    if (nuevoEstatus !== 'Resuelto') {
                        updateTicketQuery = `
                            UPDATE tickets 
                            SET estatus = ?, 
                                categoria_resolucion = NULL, 
                                tecnico_resolvio = NULL, 
                                comentario_resolucion = NULL,
                                tipo_equipo_nuevo = NULL,
                                modelo_nuevo = NULL, 
                                numero_serie_nuevo = NULL 
                            WHERE id = ?
                        `;
                    }

                    db.run(updateTicketQuery, params, () => {
                        obtenerDatosAdmin(req, res, 'Registro de historial eliminado correctamente.', null);
                    });
                });
            });
        });
    });
});

// Mover ticket a la papelera (soft delete) con confirmación de contraseña de administrador
app.post('/admin/tickets/eliminar', esAdmin, (req, res) => {
    const { ticket_id, admin_password, origen } = req.body;
    const adminId = req.session.usuario.id;

    if (!ticket_id) {
        req.session.errorFlash = 'No se especificó el ticket a mover a papelera.';
        return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
    }

    if (!admin_password) {
        req.session.errorFlash = 'Debes ingresar tu contraseña de administrador para confirmar el envío a papelera.';
        return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
    }

    db.get('SELECT password, password_plana FROM usuarios WHERE id = ?', [adminId], async (err, admin) => {
        if (err || !admin) {
            req.session.errorFlash = 'Error al verificar las credenciales del administrador.';
            return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
        }

        const passInput = (admin_password || '').trim();
        const bcryptMatch = await bcrypt.compare(passInput, admin.password).catch(() => false);
        const planaMatch = admin.password_plana && admin.password_plana.trim() === passInput;
        if (!bcryptMatch && !planaMatch) {
            req.session.errorFlash = 'Contraseña de administrador incorrecta. No se envió el ticket a papelera.';
            return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
        }

        db.get('SELECT id, titulo FROM tickets WHERE id = ?', [ticket_id], (errT, ticket) => {
            if (errT || !ticket) {
                req.session.errorFlash = 'El ticket no existe o ya fue eliminado.';
                return res.redirect('/admin');
            }

            db.run("UPDATE tickets SET deleted_at = datetime('now', 'localtime') WHERE id = ?", [ticket_id], function(errSoft) {
                if (errSoft) {
                    req.session.errorFlash = 'Error al mover el ticket a la papelera: ' + errSoft.message;
                    return res.redirect(origen === 'detalle' ? `/admin/tickets/${ticket_id}` : '/admin');
                }

                req.session.mensajeFlash = `Ticket #${ticket.id} ("${ticket.titulo}") movido a la papelera de reciclaje exitosamente. Podrás recuperarlo en cualquier momento.`;
                return res.redirect('/admin');
            });
        });
    });
});

// Recuperar ticket de la papelera
app.post('/admin/tickets/recuperar', esAdmin, (req, res) => {
    const { ticket_id } = req.body;
    if (!ticket_id) {
        req.session.errorFlash = 'No se especificó el ticket a restaurar.';
        return res.redirect('/admin');
    }

    db.get('SELECT id, titulo FROM tickets WHERE id = ? AND deleted_at IS NOT NULL', [ticket_id], (errT, ticket) => {
        if (errT || !ticket) {
            req.session.errorFlash = 'El ticket no existe o no se encuentra en la papelera.';
            return res.redirect('/admin');
        }

        db.run('UPDATE tickets SET deleted_at = NULL WHERE id = ?', [ticket_id], (errRec) => {
            if (errRec) {
                req.session.errorFlash = 'Error al restaurar el ticket: ' + errRec.message;
                return res.redirect('/admin');
            }

            req.session.mensajeFlash = `¡Ticket #${ticket.id} ("${ticket.titulo}") restaurado exitosamente! Ha vuelto a la lista principal de tickets.`;
            return res.redirect('/admin');
        });
    });
});

// Eliminar usuario definitivamente (purgar permanentemente de la papelera)
app.post('/admin/usuarios/eliminar-definitivo', esAdmin, (req, res) => {
    const { usuario_id, admin_password } = req.body;
    const adminId = req.session.usuario.id;

    if (!usuario_id) {
        req.session.errorFlash = 'No se especificó el usuario a eliminar definitivamente.';
        return res.redirect('/admin');
    }

    if (parseInt(usuario_id) === adminId) {
        req.session.errorFlash = 'No puedes eliminar definitivamente tu propia cuenta de administrador.';
        return res.redirect('/admin');
    }

    if (!admin_password) {
        req.session.errorFlash = 'Debes ingresar tu contraseña de administrador para confirmar la eliminación definitiva.';
        return res.redirect('/admin');
    }

    db.get('SELECT password, password_plana FROM usuarios WHERE id = ?', [adminId], async (err, admin) => {
        if (err || !admin) {
            req.session.errorFlash = 'Error al verificar las credenciales del administrador.';
            return res.redirect('/admin');
        }

        const passInput = (admin_password || '').trim();
        const bcryptMatch = await bcrypt.compare(passInput, admin.password).catch(() => false);
        const planaMatch = admin.password_plana && admin.password_plana.trim() === passInput;
        if (!bcryptMatch && !planaMatch) {
            req.session.errorFlash = 'Contraseña de administrador incorrecta. No se eliminó el usuario.';
            return res.redirect('/admin');
        }

        db.get('SELECT id, nombre, email FROM usuarios WHERE id = ?', [usuario_id], (errU, usuario) => {
            if (errU || !usuario) {
                req.session.errorFlash = 'El usuario no existe o ya fue eliminado.';
                return res.redirect('/admin');
            }

            // 1. Eliminar equipos asociados al usuario
            db.run('DELETE FROM equipos_usuario WHERE usuario_id = ?', [usuario_id], () => {
                // 2. Desvincular tickets preservando el nombre como autor histórico
                db.run('UPDATE tickets SET usuario_id = NULL, creado_por_admin = COALESCE(creado_por_admin, ?) WHERE usuario_id = ?', [usuario.nombre, usuario_id], () => {
                    // 3. Eliminar usuario
                    db.run('DELETE FROM usuarios WHERE id = ?', [usuario_id], (errDel) => {
                        if (errDel) {
                            req.session.errorFlash = 'Error al eliminar definitivamente el usuario: ' + errDel.message;
                            return res.redirect('/admin');
                        }

                        req.session.mensajeFlash = `Usuario "${usuario.nombre}" (${usuario.email}) eliminado definitivamente del sistema.`;
                        return res.redirect('/admin');
                    });
                });
            });
        });
    });
});

// Eliminar ticket definitivamente (purgar permanentemente de la papelera)
app.post('/admin/tickets/eliminar-definitivo', esAdmin, (req, res) => {
    const { ticket_id, admin_password } = req.body;
    const adminId = req.session.usuario.id;

    if (!ticket_id) {
        req.session.errorFlash = 'No se especificó el ticket a eliminar definitivamente.';
        return res.redirect('/admin');
    }

    if (!admin_password) {
        req.session.errorFlash = 'Debes ingresar tu contraseña de administrador para confirmar la eliminación definitiva.';
        return res.redirect('/admin');
    }

    db.get('SELECT password, password_plana FROM usuarios WHERE id = ?', [adminId], async (err, admin) => {
        if (err || !admin) {
            req.session.errorFlash = 'Error al verificar las credenciales del administrador.';
            return res.redirect('/admin');
        }

        const passInput = (admin_password || '').trim();
        const bcryptMatch = await bcrypt.compare(passInput, admin.password).catch(() => false);
        const planaMatch = admin.password_plana && admin.password_plana.trim() === passInput;
        if (!bcryptMatch && !planaMatch) {
            req.session.errorFlash = 'Contraseña de administrador incorrecta. No se eliminó el ticket.';
            return res.redirect('/admin');
        }

        db.get('SELECT id, titulo, imagen FROM tickets WHERE id = ?', [ticket_id], (errT, ticket) => {
            if (errT || !ticket) {
                req.session.errorFlash = 'El ticket no existe o ya fue eliminado.';
                return res.redirect('/admin');
            }

            // 1. Eliminar historial y comentarios del ticket
            db.run('DELETE FROM ticket_comentarios WHERE ticket_id = ?', [ticket_id], () => {
                db.run('DELETE FROM historial_tickets WHERE ticket_id = ?', [ticket_id], () => {
                    // 2. Eliminar ticket
                    db.run('DELETE FROM tickets WHERE id = ?', [ticket_id], (errDel) => {
                        if (errDel) {
                            req.session.errorFlash = 'Error al eliminar definitivamente el ticket: ' + errDel.message;
                            return res.redirect('/admin');
                        }

                        // 3. Eliminar imagen si existe
                        if (ticket.imagen) {
                            const rutaImagen = path.join(uploadsDir, ticket.imagen);
                            fs.unlink(rutaImagen, () => {});
                        }

                        req.session.mensajeFlash = `Ticket #${ticket.id} ("${ticket.titulo}") eliminado definitivamente del sistema.`;
                        return res.redirect('/admin');
                    });
                });
            });
        });
    });
});

// ---------------------- GESTIÓN DE CATEGORÍAS Y SUBCATEGORÍAS ----------------------

// Crear categoría
app.post('/admin/categorias/crear', esAdmin, (req, res) => {
    const { nombre, subcategorias } = req.body;
    const nombreLimpio = nombre ? nombre.trim() : '';

    if (!nombreLimpio) {
        return obtenerDatosAdmin(req, res, null, 'El nombre de la categoría es obligatorio.');
    }

    db.run('INSERT INTO categorias (nombre) VALUES (?)', [nombreLimpio], function(err) {
        if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                return obtenerDatosAdmin(req, res, null, 'Ya existe una categoría con ese nombre.');
            }
            return obtenerDatosAdmin(req, res, null, 'Error al crear la categoría: ' + err.message);
        }

        const catId = this.lastID;

        // Procesar subcategorías si se enviaron separadas por coma
        if (subcategorias && typeof subcategorias === 'string') {
            const listaSub = subcategorias.split(',').map(s => s.trim()).filter(Boolean);
            if (listaSub.length > 0) {
                const stmt = db.prepare('INSERT INTO subcategorias (categoria_id, nombre) VALUES (?, ?)');
                listaSub.forEach(sub => stmt.run([catId, sub]));
                stmt.finalize();
            }
        }

        obtenerDatosAdmin(req, res, `Categoría "${nombreLimpio}" creada exitosamente.`, null);
    });
});

// Editar categoría
app.post('/admin/categorias/editar', esAdmin, (req, res) => {
    const { categoria_id, nombre } = req.body;
    const nombreLimpio = nombre ? nombre.trim() : '';

    if (!categoria_id || !nombreLimpio) {
        return obtenerDatosAdmin(req, res, null, 'El nombre de la categoría no puede estar vacío.');
    }

    db.run('UPDATE categorias SET nombre = ? WHERE id = ?', [nombreLimpio, categoria_id], function(err) {
        if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                return obtenerDatosAdmin(req, res, null, 'Ya existe otra categoría con ese nombre.');
            }
            return obtenerDatosAdmin(req, res, null, 'Error al actualizar categoría: ' + err.message);
        }
        obtenerDatosAdmin(req, res, 'Categoría actualizada exitosamente.', null);
    });
});

// Eliminar categoría y sus subcategorías
app.post('/admin/categorias/eliminar', esAdmin, (req, res) => {
    const { categoria_id } = req.body;

    if (!categoria_id) {
        return obtenerDatosAdmin(req, res, null, 'ID de categoría no especificado.');
    }

    db.run('DELETE FROM subcategorias WHERE categoria_id = ?', [categoria_id], () => {
        db.run('DELETE FROM categorias WHERE id = ?', [categoria_id], function(err) {
            if (err) {
                return obtenerDatosAdmin(req, res, null, 'Error al eliminar categoría: ' + err.message);
            }
            obtenerDatosAdmin(req, res, 'Categoría y sus subcategorías eliminadas exitosamente.', null);
        });
    });
});

// Agregar subcategoría individual
app.post('/admin/subcategorias/crear', esAdmin, (req, res) => {
    const { categoria_id, nombre } = req.body;
    const nombreLimpio = nombre ? nombre.trim() : '';

    if (!categoria_id || !nombreLimpio) {
        return obtenerDatosAdmin(req, res, null, 'El nombre de la subcategoría no puede estar vacío.');
    }

    db.run('INSERT INTO subcategorias (categoria_id, nombre) VALUES (?, ?)', [categoria_id, nombreLimpio], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al agregar subcategoría: ' + err.message);
        }
        obtenerDatosAdmin(req, res, `Subcategoría "${nombreLimpio}" agregada correctamente.`, null);
    });
});

// Eliminar subcategoría individual
app.post('/admin/subcategorias/eliminar', esAdmin, (req, res) => {
    const { subcategoria_id } = req.body;

    if (!subcategoria_id) {
        return obtenerDatosAdmin(req, res, null, 'ID de subcategoría no especificado.');
    }

    db.run('DELETE FROM subcategorias WHERE id = ?', [subcategoria_id], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al eliminar subcategoría: ' + err.message);
        }
        obtenerDatosAdmin(req, res, 'Subcategoría eliminada exitosamente.', null);
    });
});

// ---------------------- GESTIÓN DE CORREOS Y PLANTILLAS ----------------------

// Guardar configuración SMTP de Outlook
app.post('/admin/config-correo/guardar', esAdmin, (req, res) => {
    const { smtp_host, smtp_port, email_remitente, password_remitente, nombre_remitente, activo } = req.body;

    const hostLimpio = smtp_host ? smtp_host.trim() : 'smtp-mail.outlook.com';
    const portLimpio = parseInt(smtp_port) || 587;
    const emailLimpio = email_remitente ? email_remitente.trim() : '';
    const passLimpio = password_remitente !== undefined ? password_remitente.trim() : '';
    const nombreLimpio = nombre_remitente ? nombre_remitente.trim() : 'Sistema de Tickets';
    const activoVal = activo ? 1 : 0;

    const query = `
        UPDATE config_correo 
        SET smtp_host = ?, 
            smtp_port = ?, 
            email_remitente = ?, 
            password_remitente = ?, 
            nombre_remitente = ?, 
            activo = ? 
        WHERE id = 1
    `;

    db.run(query, [hostLimpio, portLimpio, emailLimpio, passLimpio, nombreLimpio, activoVal], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al guardar la configuración de correo: ' + err.message);
        }
        obtenerDatosAdmin(req, res, 'Configuración de correo de Outlook guardada correctamente.', null);
    });
});

// Guardar plantilla de correo personalizada
app.post('/admin/plantillas-correo/guardar', esAdmin, (req, res) => {
    const { clave, asunto, cuerpo } = req.body;

    if (!clave || !asunto || !cuerpo) {
        return obtenerDatosAdmin(req, res, null, 'El asunto y el cuerpo del correo no pueden estar vacíos.');
    }

    const query = `UPDATE plantillas_correo SET asunto = ?, cuerpo = ? WHERE clave = ?`;

    db.run(query, [asunto.trim(), cuerpo.trim(), clave], function(err) {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al actualizar la plantilla: ' + err.message);
        }
        obtenerDatosAdmin(req, res, 'Plantilla de correo actualizada correctamente.', null);
    });
});

// Enviar correo de prueba para verificar conexión SMTP con cualquier administrador remitente
app.post('/admin/config-correo/probar', esAdmin, (req, res) => {
    const { email_prueba, remitente_email } = req.body;

    if (!email_prueba || !email_prueba.trim()) {
        return obtenerDatosAdmin(req, res, null, 'Debes ingresar un correo de destino para la prueba.');
    }

    let adminRemitente = req.session.usuario;
    if (remitente_email && remitente_email.trim()) {
        db.get('SELECT nombre, email FROM usuarios WHERE email = ?', [remitente_email.trim()], (errU, u) => {
            if (!errU && u) {
                adminRemitente = { email: u.email, nombre: u.nombre };
            } else {
                adminRemitente = { email: remitente_email.trim(), nombre: req.session.usuario ? req.session.usuario.nombre : 'Mesa de ayuda de TI' };
            }

            mailer.enviarCorreoPrueba(email_prueba.trim(), adminRemitente, (err, info) => {
                if (err) {
                    return obtenerDatosAdmin(req, res, null, 'Error al enviar correo de prueba: ' + err.message);
                }
                obtenerDatosAdmin(req, res, `¡Correo de prueba enviado exitosamente a ${email_prueba.trim()} con remitente ${adminRemitente.nombre} (${adminRemitente.email})! La conexión funciona correctamente.`, null);
            });
        });
        return;
    }

    mailer.enviarCorreoPrueba(email_prueba.trim(), adminRemitente, (err, info) => {
        if (err) {
            return obtenerDatosAdmin(req, res, null, 'Error al enviar correo de prueba: ' + err.message);
        }
        obtenerDatosAdmin(req, res, `¡Correo de prueba enviado exitosamente a ${email_prueba.trim()} desde ${adminRemitente?.email || 'servidor'}! La conexión funciona correctamente.`, null);
    });
});

app.get('/logout', (req, res) => {
    const esInactividad = req.query.inactividad === '1';
    if (req.session) {
        req.session.destroy(() => {
            res.clearCookie('connect.sid', { path: '/' });
            res.redirect(esInactividad ? '/?inactividad=1' : '/');
        });
    } else {
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect(esInactividad ? '/?inactividad=1' : '/');
    }
});

module.exports = app;

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
}