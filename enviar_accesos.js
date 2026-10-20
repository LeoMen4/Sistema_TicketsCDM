const nodemailer = require('nodemailer');
const db = require('./database');

// Obtener configuración SMTP desde la base de datos
function obtenerConfiguracion(callback) {
    db.get('SELECT * FROM config_correo WHERE id = 1', (err, config) => {
        if (err || !config) {
            return callback(new Error('No se encontró configuración de correo en la base de datos'));
        }
        callback(null, config);
    });
}

// Obtener todos los usuarios activos
function obtenerUsuarios(callback) {
    db.all(
        'SELECT id, nombre, email, password_plana, rol FROM usuarios WHERE deleted_at IS NULL ORDER BY id ASC',
        [],
        (err, usuarios) => {
            if (err) return callback(err);
            callback(null, usuarios || []);
        }
    );
}

// Generar plantilla HTML formal y profesional
function generarPlantillaHtml(nombre, email, password) {
    const enlaceSistema = 'https://sistema-ticketscdm.onrender.com/';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acceso al Sistema de Tickets CDM</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 30px 10px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <!-- ENCABEZADO -->
                    <tr>
                        <td style="background-color: #0f172a; padding: 25px 30px; text-align: left; border-bottom: 4px solid #dc2626;">
                            <table width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">
                                            SISTEMA DE TICKETS TI
                                        </h1>
                                        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">
                                            Grupo CDM • Mesa de Ayuda y Reporte de Fallas
                                        </p>
                                    </td>
                                    <td align="right" style="color: #ef4444; font-size: 26px; font-weight: 900; font-style: italic;">
                                        CDM
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- CUERPO PRINCIPAL -->
                    <tr>
                        <td style="padding: 30px;">
                            <p style="font-size: 15px; margin: 0 0 15px 0; color: #334155;">
                                Estimado(a) <strong>${nombre}</strong>,
                            </p>

                            <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px 0; color: #475569;">
                                Nos complace informarte que el Departamento de Tecnologías de la Información (TI) pone a tu disposición la nueva plataforma institucional para el <strong>reporte, canalización y seguimiento de fallas técnicas</strong> (equipos de cómputo, telefonía, red, impresoras y sistemas).
                            </p>

                            <!-- AVISO DE PERIODO DE PRUEBA -->
                            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 0 0 22px 0;">
                                <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.5;">
                                    <strong>📢 Aviso Importante • Período de Prueba:</strong><br>
                                    La plataforma se encuentra en fase de lanzamiento y evaluación operativa. Tu uso activo nos permitirá medir tiempos de respuesta y afinar los canales de soporte para brindarte una atención más ágil y efectiva.
                                </p>
                            </div>

                            <!-- TARJETA DE CREDENCIALES -->
                            <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 20px; margin: 0 0 25px 0;">
                                <h3 style="margin: 0 0 14px 0; font-size: 14px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                                    🔐 Tus Credenciales de Acceso
                                </h3>
                                
                                <table width="100%" cellspacing="0" cellpadding="6" style="font-size: 13px;">
                                    <tr>
                                        <td width="35%" style="color: #64748b; font-weight: 600;">Dirección web:</td>
                                        <td width="65%">
                                            <a href="${enlaceSistema}" style="color: #2563eb; text-decoration: underline; word-break: break-all;">
                                                ${enlaceSistema}
                                            </a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="color: #64748b; font-weight: 600;">Usuario / Correo:</td>
                                        <td style="color: #0f172a; font-weight: bold;">${email}</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #64748b; font-weight: 600;">Contraseña asignada:</td>
                                        <td>
                                            <span style="font-family: Consolas, monospace; background-color: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-weight: bold; color: #0f172a; font-size: 14px;">
                                                ${password || '(Tu contraseña actual)'}
                                            </span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- BOTON DE ACCESO -->
                            <div style="text-align: center; margin: 25px 0 20px 0;">
                                <a href="${enlaceSistema}" target="_blank" style="background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(220, 38, 38, 0.2);">
                                    🚀 Ingresar al Sistema de Tickets
                                </a>
                            </div>

                            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 20px 0 0 0; text-align: center;">
                                Te recomendamos guardar este correo y agregar la dirección a los marcadores de tu navegador para fácil acceso en cualquier momento.
                            </p>
                        </td>
                    </tr>

                    <!-- PIE DE PÁGINA -->
                    <tr>
                        <td style="background-color: #f8fafc; padding: 18px 30px; border-top: 1px solid #e2e8f0; text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 600;">
                                Departamento de Tecnologías de la Información
                            </p>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8;">
                                Grupo CDM • Mensaje generado automáticamente. Por favor no responder a este correo.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

// Función con pausa entre envíos para no saturar el servidor SMTP
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function ejecutarEnvios() {
    const modoTest = process.argv.includes('--test');

    console.log('===============================================================');
    console.log('   MESA DE AYUDA CDM - ENVÍO MASIVO DE CREDENCIALES DE ACCESO  ');
    console.log('===============================================================');

    obtenerConfiguracion((errConf, config) => {
        if (errConf) {
            console.error('❌ Error al obtener configuración SMTP:', errConf.message);
            process.exit(1);
        }

        const host = (config.smtp_host && config.smtp_host.trim()) ? config.smtp_host.trim() : 'mail.grupo-cdm.mx';
        const port = parseInt(config.smtp_port) || 25;
        const remitente = config.email_remitente || 'sistemas1@grupo-cdm.mx';

        const transportOpts = {
            host: host,
            port: port,
            secure: port === 465,
            tls: { rejectUnauthorized: false }
        };

        if (config.password_remitente && config.password_remitente.trim()) {
            transportOpts.auth = {
                user: remitente,
                pass: config.password_remitente.trim()
            };
        }

        const transporter = nodemailer.createTransport(transportOpts);

        obtenerUsuarios(async (errUsers, usuarios) => {
            if (errUsers) {
                console.error('❌ Error al leer usuarios:', errUsers.message);
                process.exit(1);
            }

            console.log(`\n📋 Total de usuarios registrados activos: ${usuarios.length}`);
            console.log(`🌐 Servidor SMTP: ${host}:${port}`);
            console.log(`✉️  Remitente: ${remitente}`);
            console.log(`🔗 Enlace incluido: https://sistema-ticketscdm.onrender.com/\n`);

            if (modoTest) {
                console.log('🧪 MODO DE PRUEBA ACTIVO: Enviando ÚNICAMENTE a sistemas1@grupo-cdm.mx...\n');
                const uPrueba = usuarios.find(u => u.email === 'sistemas1@grupo-cdm.mx') || usuarios[0];

                const mailOptions = {
                    from: `"Mesa de Ayuda CDM" <${remitente}>`,
                    to: 'sistemas1@grupo-cdm.mx',
                    subject: 'Bienvenido al nuevo Sistema de Tickets y Mesa de Ayuda TI - CDM (Prueba)',
                    html: generarPlantillaHtml(uPrueba.nombre, uPrueba.email, uPrueba.password_plana)
                };

                try {
                    const info = await transporter.sendMail(mailOptions);
                    console.log('✅ Correo de prueba enviado exitosamente!');
                    console.log('   Destino: sistemas1@grupo-cdm.mx');
                    console.log('   Respuesta del servidor:', info.response || info.messageId);
                    console.log('\nRevisa tu bandeja de entrada. Si todo se ve correcto, ejecuta el script con:');
                    console.log('   node enviar_accesos.js --enviar-todos');
                } catch (e) {
                    console.error('❌ Error al enviar prueba:', e.message);
                }
                process.exit(0);
            }

            if (!process.argv.includes('--enviar-todos')) {
                console.log('⚠️  PRECAUCIÓN: Para evitar envíos por error, debes agregar la bandera --enviar-todos');
                console.log('   Para enviar una prueba primero:');
                console.log('      node enviar_accesos.js --test');
                console.log('   Para enviar a todos los 43 usuarios:');
                console.log('      node enviar_accesos.js --enviar-todos');
                process.exit(0);
            }

            console.log(`🚀 Iniciando envío masivo a ${usuarios.length} usuarios...\n`);

            let enviados = 0;
            let errores = 0;

            for (let i = 0; i < usuarios.length; i++) {
                const u = usuarios[i];
                const indexStr = `[${i + 1}/${usuarios.length}]`;

                if (!u.email || !u.email.includes('@')) {
                    console.log(`${indexStr} ⚠️ Saltando ${u.nombre}: Correo inválido (${u.email})`);
                    errores++;
                    continue;
                }

                const mailOptions = {
                    from: `"Mesa de Ayuda CDM" <${remitente}>`,
                    to: u.email,
                    subject: 'Bienvenido al nuevo Sistema de Tickets y Mesa de Ayuda TI - CDM',
                    html: generarPlantillaHtml(u.nombre, u.email, u.password_plana)
                };

                try {
                    await transporter.sendMail(mailOptions);
                    console.log(`${indexStr} ✅ Enviado a: ${u.nombre} <${u.email}> (Pass: ${u.password_plana || 'N/A'})`);
                    enviados++;
                } catch (e) {
                    console.error(`${indexStr} ❌ Error enviando a ${u.email}:`, e.message);
                    errores++;
                }

                // Pausa de 1 segundo entre envíos para proteger la reputación del servidor de correo
                await esperar(1000);
            }

            console.log('\n===============================================================');
            console.log(`🎉 Proceso finalizado.`);
            console.log(`   ✅ Enviados con éxito: ${enviados}`);
            console.log(`   ❌ Errores: ${errores}`);
            console.log('===============================================================');
            process.exit(0);
        });
    });
}

ejecutarEnvios();

