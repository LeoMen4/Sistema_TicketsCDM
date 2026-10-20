const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

let dbPath = path.join(__dirname, 'tickets.db');

// En entornos serverless como Vercel donde el sistema de archivos raíz es de solo lectura,
// clonamos la base de datos a /tmp para permitir lectura y escritura.
if (process.env.VERCEL) {
    const tmpDb = path.join('/tmp', 'tickets.db');
    try {
        if (!fs.existsSync(tmpDb) && fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, tmpDb);
        }
        dbPath = tmpDb;
    } catch (e) {
        console.error('Error al inicializar sqlite en /tmp:', e.message);
    }
}

const db = new sqlite3.Database(dbPath);

// Asegurar que el logo corporativo CDM esté disponible en public/img/logo-cdm.jpg
try {
    const imgDir = path.join(__dirname, 'public', 'img');
    if (!fs.existsSync(imgDir)) {
        fs.mkdirSync(imgDir, { recursive: true });
    }
    const targetLogo = path.join(imgDir, 'logo-cdm.jpg');
    const uploadedLogo = 'C:/Users/siscd/.gemini/antigravity/brain/0f9dc841-b233-46ae-97e0-5a9e2f24fdda/.user_uploaded/media_1792420696881_57b3c692.jpg';
    if (!fs.existsSync(targetLogo) && fs.existsSync(uploadedLogo)) {
        fs.copyFileSync(uploadedLogo, targetLogo);
    }
} catch (e) {}

db.serialize(() => {
    // Modo WAL y persistencia garantizada en disco
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");
    db.run("PRAGMA busy_timeout = 5000;");
    db.run("PRAGMA foreign_keys = ON;");
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            puesto TEXT DEFAULT '',
            password TEXT NOT NULL,
            password_plana TEXT,
            rol TEXT DEFAULT 'usuario',
            deleted_at DATETIME DEFAULT NULL
        )
    `);

    db.run(`ALTER TABLE usuarios ADD COLUMN deleted_at DATETIME DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE usuarios ADD COLUMN puesto TEXT DEFAULT ''`, (err) => {});

    // Tabla de tickets sin requerir el campo obsoleto 'periferico'
    db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            tipo_falla TEXT NOT NULL,
            subcategoria TEXT DEFAULT NULL,
            descripcion TEXT NOT NULL,
            prioridad TEXT DEFAULT 'Media',
            imagen TEXT DEFAULT NULL,
            estatus TEXT DEFAULT 'Nuevo ticket',
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario_id INTEGER,
            categoria_resolucion TEXT,
            tecnico_resolvio TEXT,
            atendido_por TEXT DEFAULT NULL,
            entregado_por TEXT DEFAULT NULL,
            participantes_ti TEXT DEFAULT NULL,
            comentario_resolucion TEXT,
            tipo_equipo_nuevo TEXT,
            modelo_nuevo TEXT,
            numero_serie_nuevo TEXT,
            creado_por_admin TEXT DEFAULT NULL,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )
    `);

    // Migraciones automáticas por seguridad
    db.run(`ALTER TABLE tickets ADD COLUMN tipo_falla TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN subcategoria TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN prioridad TEXT DEFAULT 'Media'`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN imagen TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN categoria_resolucion TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN tecnico_resolvio TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN atendido_por TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN entregado_por TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN participantes_ti TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN comentario_resolucion TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN tipo_equipo_nuevo TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN modelo_nuevo TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN numero_serie_nuevo TEXT`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN creado_por_admin TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets ADD COLUMN deleted_at DATETIME DEFAULT NULL`, (err) => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at ON tickets(deleted_at)`, (err) => {});

    // Migración para eliminar la restricción del campo obsoleto 'periferico' si aún existe
    db.run(`UPDATE tickets SET tipo_falla = ('Periféricos (' || periferico || ')') WHERE (tipo_falla IS NULL OR tipo_falla = '') AND periferico IS NOT NULL`, (err) => {});
    db.run(`ALTER TABLE tickets DROP COLUMN periferico`, (err) => {});

    db.run(`
        CREATE TABLE IF NOT EXISTS historial_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            estatus TEXT NOT NULL,
            usuario_nombre TEXT DEFAULT NULL,
            usuario_puesto TEXT DEFAULT NULL,
            detalle TEXT DEFAULT NULL,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(ticket_id) REFERENCES tickets(id)
        )
    `);

    db.run(`ALTER TABLE historial_tickets ADD COLUMN usuario_nombre TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE historial_tickets ADD COLUMN usuario_puesto TEXT DEFAULT NULL`, (err) => {});
    db.run(`ALTER TABLE historial_tickets ADD COLUMN detalle TEXT DEFAULT NULL`, (err) => {});

    // Tabla para Comentarios / Chat Remoto y Registro de Intervenciones en Tickets (Punto 2, 3 y 5)
    db.run(`
        CREATE TABLE IF NOT EXISTS ticket_comentarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            autor_nombre TEXT NOT NULL,
            autor_rol TEXT NOT NULL,
            autor_puesto TEXT DEFAULT '',
            mensaje TEXT NOT NULL,
            imagen TEXT DEFAULT NULL,
            tipo_intervencion TEXT DEFAULT 'comentario',
            leido_admin INTEGER DEFAULT 0,
            leido_usuario INTEGER DEFAULT 0,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        )
    `);

    db.run(`ALTER TABLE ticket_comentarios ADD COLUMN editado INTEGER DEFAULT 0`, (err) => {});
    db.run(`ALTER TABLE ticket_comentarios ADD COLUMN fecha_edicion DATETIME DEFAULT NULL`, (err) => {});

    // Tabla para Guías Rápidas / Base de Conocimiento (FAQ - Punto 6)
    db.run(`
        CREATE TABLE IF NOT EXISTS guias_rapidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            categoria TEXT NOT NULL,
            resumen TEXT DEFAULT '',
            contenido TEXT NOT NULL,
            imagen TEXT DEFAULT NULL,
            visibilidad TEXT DEFAULT 'todos',
            destacada INTEGER DEFAULT 0,
            autor_nombre TEXT DEFAULT 'Sistemas TI',
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabla de configuraciones globales del sistema (ej. tolerancia de alertas, banderas de inicialización)
    db.run(`
        CREATE TABLE IF NOT EXISTS configuraciones (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        )
    `, () => {
        db.run(`INSERT OR IGNORE INTO configuraciones (clave, valor) VALUES ('tolerancia_alerta_pct', '25')`);

        // Sembrar guías rápidas iniciales SOLO una vez en la primera instalación
        db.get("SELECT valor FROM configuraciones WHERE clave = 'guias_inicializadas'", (errCfg, rowCfg) => {
            if (!errCfg && !rowCfg) {
                db.get('SELECT COUNT(*) AS total FROM guias_rapidas', (errG, rowG) => {
                    if (!errG && rowG && rowG.total === 0) {
                        const guiasIniciales = [
                            {
                                titulo: '¿Qué hacer si la impresora no imprime o aparece "Sin conexión"?',
                                categoria: 'Periféricos',
                                resumen: 'Pasos rápidos para restablecer la comunicación con tu impresora antes de levantar un ticket.',
                                contenido: '1. Verifica que la impresora esté encendida y no tenga ningún foco rojo o alerta parpadeando en su pantalla.\n2. Si es por cable USB o cable de red, desconecta y vuelve a conectar firmemente el cable.\n3. Abre el menú de Inicio en Windows, escribe "Impresoras y escáneres", selecciona tu impresora y revisa si hay documentos atascados en la cola de impresión.\n4. Apaga la impresora durante 15 segundos y vuelve a encenderla.\n5. Si el problema continúa o marca código de error, levanta un ticket adjuntando foto del mensaje.',
                                visibilidad: 'todos',
                                destacada: 1,
                                autor_nombre: 'José Armando Sánchez Vilchis'
                            },
                            {
                                titulo: '¿Cómo recuperar fluidez cuando un programa o la PC se vuelve muy lenta?',
                                categoria: 'Falla General de Computadora / PC',
                                resumen: 'Recomendaciones para liberar memoria cuando Excel, el navegador o algún sistema se congela.',
                                contenido: '1. Guarda todos los archivos de Word o Excel que tengas abiertos.\n2. Cierra pestañas innecesarias del navegador (Google Chrome consume mucha memoria con más de 15 pestañas abiertas).\n3. Si un programa no responde, presiona Ctrl + Shift + Esc para abrir el Administrador de tareas, selecciona el programa bloqueado y da clic en "Finalizar tarea".\n4. Realiza un reinicio completo del equipo (Inicio > Reiniciar, no solo apagar y prender) al menos una vez cada 2 días para aplicar actualizaciones pendientes.',
                                visibilidad: 'todos',
                                destacada: 1,
                                autor_nombre: 'José Armando Sánchez Vilchis'
                            },
                            {
                                titulo: 'Problemas de conexión a Internet o Red Corporativa',
                                categoria: 'Conectividad e Internet',
                                resumen: 'Cómo identificar si es falla de tu equipo, del Wi-Fi o del cable de red.',
                                contenido: '1. Revisa el icono de red en la esquina inferior derecha de tu pantalla (junto al reloj).\n2. Si usas cable de red (Ethernet), verifica que el conector detrás de tu PC haga "clic" correctamente.\n3. Si estás por Wi-Fi, desconéctate de la red corporativa, espera 5 segundos y vuelve a conectarte.\n4. Consulta con un compañero cercano si también presenta falta de internet; si toda el área está sin red, repórtalo en el ticket con prioridad Alta.',
                                visibilidad: 'todos',
                                destacada: 0,
                                autor_nombre: 'José Armando Sánchez Vilchis'
                            },
                            {
                                titulo: 'Correo Outlook no envía ni recibe mensajes nuevos',
                                categoria: 'Paquetes de Oficina / Licencias',
                                resumen: 'Verificación del modo "Trabajar sin conexión" y sincronización de bandeja de entrada.',
                                contenido: '1. En la parte inferior de la ventana de Outlook, revisa si aparece el texto "Trabajando sin conexión" o "Desconectado".\n2. Si dice "Trabajando sin conexión", ve a la pestaña "Enviar y recibir" arriba y haz clic en el botón "Trabajar sin conexión" para desactivarlo.\n3. Presiona la tecla F9 (o el botón "Enviar y recibir todas las carpetas") para forzar la sincronización.\n4. Si te solicita contraseña repetidamente o marca error de servidor, levanta un ticket indicando el mensaje exacto.',
                                visibilidad: 'todos',
                                destacada: 0,
                                autor_nombre: 'José Armando Sánchez Vilchis'
                            }
                        ];

                        guiasIniciales.forEach(g => {
                            db.run(
                                `INSERT INTO guias_rapidas (titulo, categoria, resumen, contenido, visibilidad, destacada, autor_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [g.titulo, g.categoria, g.resumen, g.contenido, g.visibilidad, g.destacada, g.autor_nombre]
                            );
                        });
                    }
                    db.run("INSERT OR REPLACE INTO configuraciones (clave, valor) VALUES ('guias_inicializadas', '1')");
                });
            }
        });
    });

    // Tablas para Categorías y Subcategorías dinámicas de Tipos de Falla
    db.run(`
        CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT UNIQUE NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS subcategorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoria_id INTEGER NOT NULL,
            nombre TEXT NOT NULL,
            FOREIGN KEY(categoria_id) REFERENCES categorias(id) ON DELETE CASCADE
        )
    `);

    db.run(`ALTER TABLE categorias ADD COLUMN tiempo_base_horas REAL DEFAULT 24`, (err) => {});
    db.run(`ALTER TABLE subcategorias ADD COLUMN tiempo_base_horas REAL DEFAULT 24`, (err) => {});

    // Tabla de configuraciones globales del sistema (ej. tolerancia de alertas)
    db.run(`
        CREATE TABLE IF NOT EXISTS configuraciones (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        )
    `);
    db.run(`INSERT OR IGNORE INTO configuraciones (clave, valor) VALUES ('tolerancia_alerta_pct', '25')`);

    // Tabla para Equipos de Cómputo y Periféricos asignados a cada usuario
    db.run(`
        CREATE TABLE IF NOT EXISTS equipos_usuario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            tipo TEXT NOT NULL,
            marca TEXT,
            modelo TEXT,
            numero_serie TEXT,
            estado TEXT DEFAULT 'Operativo',
            detalles TEXT,
            fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )
    `);

    // Sembrar categorías predeterminadas si la tabla está vacía
    db.get('SELECT COUNT(*) AS total FROM categorias', (err, row) => {
        if (!err && row && row.total === 0) {
            const defaults = [
                {
                    nombre: 'Conectividad e Internet',
                    subcategorias: ['Sin acceso a Internet', 'Falla de Wi-Fi', 'Cable de red dañado / desconectado', 'Lentitud en la red']
                },
                {
                    nombre: 'Falla en Programas / Software',
                    subcategorias: ['Sistema de facturación', 'ERP / CRM', 'Error al abrir programa', 'Cierre inesperado']
                },
                {
                    nombre: 'Paquetes de Oficina / Licencias',
                    subcategorias: ['Microsoft Office (Word / Excel)', 'Activación de licencia', 'Correo electrónico / Outlook', 'Lector de PDF']
                },
                {
                    nombre: 'Periféricos',
                    subcategorias: ['Mouse', 'Teclado', 'Impresora', 'Escáner', 'Monitor', 'Cables / Adaptadores']
                },
                {
                    nombre: 'Falla General de Computadora / PC',
                    subcategorias: ['No enciende', 'Pantalla azul', 'Lentitud extrema', 'Se reinicia sola', 'Ruidos extraños']
                },
                {
                    nombre: 'Otros',
                    subcategorias: []
                }
            ];

            defaults.forEach(cat => {
                db.run('INSERT INTO categorias (nombre) VALUES (?)', [cat.nombre], function(errCat) {
                    if (!errCat && cat.subcategorias.length > 0) {
                        const catId = this.lastID;
                        cat.subcategorias.forEach(sub => {
                            db.run('INSERT INTO subcategorias (categoria_id, nombre) VALUES (?, ?)', [catId, sub]);
                        });
                    }
                });
            });
        }
    });

    // Tablas para Configuración y Plantillas de Correo (Optimizado para relay corporativo de Grupo CDM puerto 2525)
    db.run(`
        CREATE TABLE IF NOT EXISTS config_correo (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            smtp_host TEXT DEFAULT 'mail.grupo-cdm.mx',
            smtp_port INTEGER DEFAULT 2525,
            email_remitente TEXT DEFAULT 'sistemas1@grupo-cdm.mx',
            password_remitente TEXT DEFAULT '',
            nombre_remitente TEXT DEFAULT 'Mesa de ayuda de TI',
            activo INTEGER DEFAULT 1
        )
    `);

    db.run(`
        INSERT OR IGNORE INTO config_correo (id, smtp_host, smtp_port, email_remitente, password_remitente, nombre_remitente, activo)
        VALUES (1, 'mail.grupo-cdm.mx', 2525, 'sistemas1@grupo-cdm.mx', '', 'Mesa de ayuda de TI', 1)
    `);

    // Actualizar configuración existente a puerto 2525 de mail.grupo-cdm.mx para compatibilidad en Render y Local
    db.run(`
        UPDATE config_correo 
        SET smtp_host = 'mail.grupo-cdm.mx', smtp_port = 2525, nombre_remitente = 'Mesa de ayuda de TI' 
        WHERE (smtp_host = 'smtp-mail.outlook.com' OR smtp_port = 587 OR smtp_port = 25) AND id = 1
    `, (err) => {});

    db.run(`
        CREATE TABLE IF NOT EXISTS plantillas_correo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clave TEXT UNIQUE NOT NULL,
            titulo_seccion TEXT NOT NULL,
            destinatario_tipo TEXT NOT NULL,
            asunto TEXT NOT NULL,
            cuerpo TEXT NOT NULL
        )
    `);

    const plantillasPorDefecto = [
        {
            clave: 'ticket_nuevo',
            titulo_seccion: 'Notificación a Administradores (Nuevo Ticket Creado)',
            destinatario_tipo: 'Administradores del Sistema',
            asunto: '🔔 [Ticket #{id}] Nuevo Ticket Reportado: {titulo}',
            cuerpo: `Hola Administrador,\n\nSe ha reportado un nuevo ticket de soporte en la plataforma:\n\n• Número de Ticket: #{id}\n• Solicitante: {usuario} ({email_usuario})\n• Título: {titulo}\n• Tipo de Falla: {tipo_falla}\n• Subcategoría / Dispositivo: {subcategoria}\n• Nivel de Prioridad: {prioridad}\n• Estatus Inicial: {estatus}\n• Fecha de reporte: {fecha}\n\nDescripción:\n{descripcion}\n\nPor favor ingresa al panel de administración para atender esta solicitud.`
        },
        {
            clave: 'estatus_en_proceso',
            titulo_seccion: 'Notificación al Usuario (Estatus: En proceso)',
            destinatario_tipo: 'Usuario solicitante del Ticket',
            asunto: '⏳ [Ticket #{id}] Tu ticket ya está en proceso: {titulo}',
            cuerpo: `Hola {usuario},\n\nTe informamos que tu ticket #{id} ("{titulo}") ya se encuentra EN PROCESO de atención.\n\n• Número de Ticket: #{id}\n• Estatus actual: En proceso\n• Tipo de Falla: {tipo_falla}\n• Prioridad: {prioridad}\n• Fecha: {fecha}\n\nEstamos trabajando en resolver tu incidencia. Te mantendremos informado ante cualquier actualización.`
        },
        {
            clave: 'estatus_pendiente',
            titulo_seccion: 'Notificación al Usuario (Estatus: Pendiente)',
            destinatario_tipo: 'Usuario solicitante del Ticket',
            asunto: '⚠️ [Ticket #{id}] Tu ticket se encuentra pendiente: {titulo}',
            cuerpo: `Hola {usuario},\n\nTu ticket #{id} ("{titulo}") ha sido marcado con estatus PENDIENTE.\n\n• Número de Ticket: #{id}\n• Estatus actual: Pendiente\n• Tipo de Falla: {tipo_falla}\n• Prioridad: {prioridad}\n• Fecha: {fecha}\n\nEl ticket se encuentra en espera de información adicional o partes necesarias para continuar con la atención.`
        },
        {
            clave: 'estatus_resuelto',
            titulo_seccion: 'Notificación al Usuario (Estatus: Resuelto)',
            destinatario_tipo: 'Usuario solicitante del Ticket',
            asunto: '✅ [Ticket #{id}] ¡Tu ticket ha sido resuelto!: {titulo}',
            cuerpo: `Hola {usuario},\n\nNos complace informarte que tu ticket #{id} ("{titulo}") ha sido RESUELTO exitosamente.\n\n• Número de Ticket: #{id}\n• Estatus final: Resuelto\n• Técnico que atendió: {tecnico}\n• Tipo de resolución: {categoria_resolucion}\n• Comentario de resolución: {comentario_resolucion}\n• Fecha: {fecha}\n\nSi todo está operando adecuadamente, no necesitas realizar ninguna acción. ¡Gracias!`
        },
        {
            clave: 'ticket_creado_usuario',
            titulo_seccion: 'Confirmación al Usuario (Ticket Registrado)',
            destinatario_tipo: 'Usuario solicitante del Ticket',
            asunto: '📋 [Ticket #{id}] Se ha registrado tu ticket de soporte: {titulo}',
            cuerpo: `Hola {usuario},\n\nTe confirmamos que se ha registrado un nuevo ticket de soporte a tu nombre:\n\n• Número de Ticket: #{id}\n• Título: {titulo}\n• Tipo de Falla: {tipo_falla}\n• Subcategoría / Dispositivo: {subcategoria}\n• Nivel de Prioridad: {prioridad}\n• Estatus: {estatus}\n• Fecha de reporte: {fecha}\n\nDescripción del problema:\n{descripcion}\n\nEl equipo de sistemas ya tiene conocimiento de tu incidencia y se encuentra trabajando en atenderla. Te notificaremos por este medio cuando haya novedades sobre tu ticket.`
        }
    ];

    plantillasPorDefecto.forEach(p => {
        db.run(
            `INSERT OR IGNORE INTO plantillas_correo (clave, titulo_seccion, destinatario_tipo, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)`,
            [p.clave, p.titulo_seccion, p.destinatario_tipo, p.asunto, p.cuerpo]
        );
    });

    // Sembrar cuentas de usuarios del Excel de nDesk (INSERT OR IGNORE para respetar ediciones posteriores)
    const usuariosInicialesNDesk = [
        { email: 'sistemas@grupocdm.mx', nombre: 'José Armando Sánchez Vilchis', puesto: 'Especialista en sistemas', pass: '@Winter02@', rol: 'admin' },
        { email: 'administracion2@grupo-cdm.mx', nombre: 'Guadalupe Silva Castañeda', puesto: 'Auxiliar de rentas', pass: 'Adm!n!straci0n2', rol: 'usuario' },
        { email: 'cobranza4@grupo-cdm.mx', nombre: 'Lizbeth Fernandez', puesto: 'Especialista en cuentas por cobrar', pass: 'Cobranz@4', rol: 'usuario' },
        { email: 'contabilidad@grupo-cdm.mx', nombre: 'Alfredo Hernandez', puesto: 'Gerente de contabilidad', pass: 'C0nt@bilid@d', rol: 'usuario' },
        { email: 'contabilidad1@grupo-cdm.mx', nombre: 'Alexis Flores', puesto: 'Contador JR', pass: 'Contabilid@d1', rol: 'usuario' },
        { email: 'contabilidad2@gmail.com', nombre: 'Guadalupe Piña', puesto: 'Contador JR', pass: 'Cont@bilid@d2', rol: 'usuario' },
        { email: 'gerenterh@grupo-cdm.mx', nombre: 'Jesus Hernandez Aguilar', puesto: 'Gerente de recursos', pass: 'CdmHold!ng1586', rol: 'usuario' },
        { email: 'compras@grupo-cdm.mx', nombre: 'Sandra Valle', puesto: 'Coordinadora Compras', pass: 'Compr@s1cdm', rol: 'usuario' },
        { email: 'marketing@grupo-cdm.mx', nombre: 'Luis Garcia', puesto: 'Coordinador Marketing', pass: 'M@rk3ting1', rol: 'usuario' },
        { email: 'gerente-reman@grupo-cdm.mx', nombre: 'Cipriano Ballesteros', puesto: 'Gerente Reman. De Equipos', pass: 'R3m@ncdm', rol: 'usuario' },
        { email: 'cuentasxp@grupo-cdm.mx', nombre: 'Nadia Montes de Oca', puesto: 'Especialista en cuentas por pagar', pass: 'Cu3nt@scdm', rol: 'usuario' },
        { email: 'ikon@grupo-cdm.mx', nombre: 'Israel Campos', puesto: 'Ventas Ikon', pass: '1kon@cdm', rol: 'usuario' },
        { email: 'ventas6@grupo-cdm.mx', nombre: 'Alejandra Suárez', puesto: 'Ejecutiva de ventas Telemarketing', pass: 'Vent@s6cdm', rol: 'usuario' },
        { email: 'ventas2@grupo-cdm.mx', nombre: 'Angelica Perez', puesto: 'Ejecutiva de ventas Telemarketing', pass: 'V3nt@s2cdm', rol: 'usuario' },
        { email: 'gventas@grupo-cdm.mx', nombre: 'Constantino Rivera', puesto: 'Gerente de Telemarketing', pass: 'Gvent@s1cdm', rol: 'usuario' },
        { email: 'gcomercial@grupo-cdm.mx', nombre: 'Adrian Flores', puesto: 'Gerente Comercial', pass: 'Gcomerc1@l', rol: 'usuario' },
        { email: 'administracion@grupo-cdm.mx', nombre: 'Share Remigio Luis', puesto: 'Coordinadora Administrativa', pass: 'Administr@cion1cdm', rol: 'usuario' },
        { email: 'saguilar@grupo-cdm.mx', nombre: 'Shantall Aguilar', puesto: 'Gerente Administrativo', pass: 'S@guilar1cdm', rol: 'usuario' },
        { email: 'cobranza3@grupo-cdm.mx', nombre: 'Adriana Martinez', puesto: 'Especialista de cuentas por cobrar', pass: 'Cobr@nza3cdm', rol: 'usuario' },
        { email: 'cobranza2@grupo-cdm.mx', nombre: 'Yazmin Alvarez', puesto: 'Especialista de cuentas por cobrar', pass: 'Cobr@nza2cdm', rol: 'usuario' },
        { email: 'cobranza@grupo-cdm.mx', nombre: 'Pablo Velazquez', puesto: 'Gerente de credito y cobranza', pass: 'C0branz@1', rol: 'usuario' },
        { email: 'administracion3@grupo-cdm.mx', nombre: 'Mariela Alberto', puesto: 'Auxiliar de rentas', pass: 'Administr@ci0n3', rol: 'usuario' },
        { email: 'servicio2@grupo-cdm.mx', nombre: 'Gloria Camacho', puesto: 'Coordinadora de servicio tecnico', pass: 'S3rvici@2', rol: 'usuario' },
        { email: 'servicio3@grupo-cdm.mx', nombre: 'Erika Franco', puesto: 'Coordinadora en servicio tecnico', pass: 'S3rvici@3', rol: 'usuario' },
        { email: 'gerente-servicio@grupo-cdm.mx', nombre: 'Alberto Martinez', puesto: 'Gerente de servicio', pass: 'S3rvici@1', rol: 'usuario' },
        { email: 'gerente-logistica@grupo-cdm.mx', nombre: 'Joao Atenogenes', puesto: 'Gerente de logistica', pass: 'G3rente@1', rol: 'usuario' },
        { email: 'almacen@grupo-cdm.mx', nombre: 'Carlos Romero', puesto: 'Coordinador de Almacen', pass: 'Almac3n@1', rol: 'usuario' },
        { email: 'reman-cartuchos@grupo-cdm.mx', nombre: 'Jorge Reyes', puesto: 'Coordinador de Remanufactura de cartuchos', pass: 'C@rtucho5', rol: 'usuario' },
        { email: 'ventas3@grupo-cdm.mx', nombre: 'Concepción Chimal', puesto: 'Ejecutivo de ventas', pass: 'Vent@s3cdm', rol: 'usuario' },
        { email: 'ccomercial1@grupo-cdm.mx', nombre: 'Elsa Castillo', puesto: 'Consultor Comercial', pass: 'Ccomercial1@', rol: 'usuario' },
        { email: 'ccomercial5@grupo-cdm.mx', nombre: 'Oscar Sanchez', puesto: 'Consultor Comercial', pass: 'Lola1422@', rol: 'usuario' },
        { email: 'iaguilar@grupo-cdm.mx', nombre: 'Ivan Aguilar', puesto: 'Director comercial', pass: 'I@guilar1cdm', rol: 'usuario' },
        { email: 'ventas9@grupo-cdm.mx', nombre: 'Gerardo Peña', puesto: 'Ejecutiva de ventas Telemarketing', pass: 'Vent@s9cdm', rol: 'usuario' },
        { email: 'gclave@grupo-cdm.mx', nombre: 'Dania Suarez Arevalo', puesto: 'Gerente Cuentas Clave', pass: 'GCl@v3cdm', rol: 'usuario' },
        { email: 'ccomercial2@grupo-cdm.mx', nombre: 'Yocelyn Romero', puesto: 'Consultor Comercial', pass: 'Cc0mercial2@', rol: 'usuario' },
        { email: 'ventas1@u-mex.mx', nombre: 'Soledad de Jesus', puesto: 'Ejecutivo de ventas', pass: 'V3ntas1U@', rol: 'usuario' }
    ];

    usuariosInicialesNDesk.forEach(u => {
        db.get('SELECT id, puesto FROM usuarios WHERE LOWER(email) = LOWER(?)', [u.email], (err, row) => {
            if (!err && !row) {
                const hash = bcrypt.hashSync(u.pass, 10);
                db.run(
                    `INSERT OR IGNORE INTO usuarios (nombre, email, puesto, password, password_plana, rol) VALUES (?, ?, ?, ?, ?, ?)`,
                    [u.nombre.trim(), u.email.trim(), u.puesto.trim(), hash, u.pass, u.rol]
                );
            } else if (!err && row && (!row.puesto || row.puesto.trim() === '')) {
                db.run(`UPDATE usuarios SET puesto = ? WHERE id = ?`, [u.puesto.trim(), row.id]);
            }
        });
    });
});

module.exports = db;