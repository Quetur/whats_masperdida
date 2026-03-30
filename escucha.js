import { delay, downloadMediaMessage } from '@whiskeysockets/baileys';
import 'dotenv/config';
 
// --- CONFIGURACIÓN DE API ---
const API_BASE_URL = process.env.API_BASE_URL ? process.env.API_BASE_URL.replace(/\/$/, "") : "";
 
// Número de WhatsApp del administrador para recibir sugerencias (definido en .env)
const ADMIN_PHONE = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.replace(/\D/g, '') : null;
 
let sesiones = {};
let configDB = { categorias: {}, tipos: {} };
 
/**
 * 🧹 GESTIÓN DE EXPIRACIÓN DE SESIÓN (30 MINUTOS)
 */
const gestionarTimeout = (jid) => {
    if (sesiones[jid] && sesiones[jid].timeout) {
        clearTimeout(sesiones[jid].timeout);
    }
    return setTimeout(() => {
        if (sesiones[jid]) {
            console.log(`🧹 Sesión eliminada por inactividad: ${jid}`);
            delete sesiones[jid];
        }
    }, 30 * 60 * 1000);
};
 
/**
 * 🧹 Helper para limpiar sesión (evita repetir código)
 */
const limpiarSesion = (jid) => {
    if (sesiones[jid]) {
        clearTimeout(sesiones[jid].timeout);
        delete sesiones[jid];
    }
};
 
/**
 * 🛰️ SINCRONIZACIÓN INICIAL CON EL PORTAL (MySQL)
 */
async function cargarMaestros() {
    try {
        console.log('📡 PetyBot: Sincronizando maestros con el Portal...');
        const response = await fetch(`${API_BASE_URL}/api/mascota_chat_graba`);
        if (!response.ok) throw new Error('Error al conectar');
        
        const data = await response.json();
        if (data.cat) data.cat.forEach(c => configDB.categorias[c.des.toUpperCase()] = c.id_categoria);
        if (data.tipo) data.tipo.forEach(t => configDB.tipos[t.des.toUpperCase()] = t.id_tipo);
        
        console.log('✅ PetyBot: Configuración sincronizada correctamente.');
    } catch (error) {
        console.error('⚠️ Usando IDs de emergencia (Modo Offline)');
        configDB.categorias = { "ENCONTRADO": 10, "PERDIDO": 20, "ADOPCION": 23 };
        configDB.tipos = { "PERRO": 10, "GATO": 20, "OTRO": 30 };
    }
}
 
cargarMaestros();
 
export const configurarEscucha = (sock) => {
    if (!sock) return;
 
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages, type } = chatUpdate;
            if (type !== 'notify') return;
 
            for (const msg of messages) {
                if (msg.key.fromMe) continue;
                const jid = msg.key.remoteJid;
                if (jid.endsWith('@g.us')) continue; 
 
                const nombreUser = msg.pushName || 'Usuario';
                const texto = (msg.message?.conversation || 
                               msg.message?.extendedTextMessage?.text || 
                               msg.message?.imageMessage?.caption || "").trim();
                const textoLower = texto.toLowerCase();
 
                // --- 1. COMANDOS DE REINICIO O INICIO ---
                const comandosReset = ['hola', 'menu', 'reiniciar', 'inicio'];
                if (!sesiones[jid] || comandosReset.includes(textoLower)) {
                    const menu = `¡Hola ${nombreUser}! Soy PetyBot 🐾\n\n¿En qué puedo ayudarte? Respondé con el número:\n\n1️⃣ *Mascota Perdida* 😢\n2️⃣ *Mascota Encontrada* 🏠\n3️⃣ *Mascota en Adopción* 🐾\n4️⃣ *Ver página Web* 🌐\n5️⃣ *Enviar una Sugerencia* 💬`;
                    
                    await sock.sendMessage(jid, { text: menu });
                    sesiones[jid] = { paso: 'MENU_PRINCIPAL', datos: { nombre_contacto: nombreUser } };
                    sesiones[jid].timeout = gestionarTimeout(jid);
                    continue; 
                }
 
                sesiones[jid].timeout = gestionarTimeout(jid);
                const estado = sesiones[jid];
 
                // --- 2. FLUJO DEL BOT ---
                switch (estado.paso) {
                    
                    case 'MENU_PRINCIPAL':
                        if (texto === "1") { 
                            estado.datos.id_categoria = configDB.categorias["PERDIDO"]; 
                            estado.datos.categoria_nombre = "Perdida"; 
                            estado.paso = 'ESPERANDO_TIPO';
                        } else if (texto === "2") { 
                            estado.datos.id_categoria = configDB.categorias["ENCONTRADO"]; 
                            estado.datos.categoria_nombre = "Encontrada"; 
                            estado.paso = 'ESPERANDO_TIPO';
                        } else if (texto === "3") { 
                            estado.datos.id_categoria = configDB.categorias["ADOPCION"]; 
                            estado.datos.categoria_nombre = "Adopción"; 
                            estado.paso = 'ESPERANDO_TIPO';
                        } else if (texto === "4") {
                            await sock.sendMessage(jid, { text: "🌐 Visitá nuestra web: http://www.mascotaperdida.com.ar" });
                            limpiarSesion(jid);
                            break;
                        } else if (texto === "5") {
                            estado.paso = 'ESPERANDO_TELEFONO_SUGERENCIA';
                            await sock.sendMessage(jid, { text: "📱 Por favor, ingresá tu número de teléfono de contacto:" });
                            break;
                        } else {
                            await sock.sendMessage(jid, { text: "❌ Opción no válida. Elegí del 1 al 5." });
                            break;
                        }
                        await sock.sendMessage(jid, { text: `✅ Mascota *${estado.datos.categoria_nombre}*.\n\n¿Qué animal es?\n1️⃣ Perro\n2️⃣ Gato\n3️⃣ Otro` });
                        break;
 
                    // --- FLUJO SUGERENCIAS ---
                    case 'ESPERANDO_TELEFONO_SUGERENCIA':
                        const telSugerencia = texto.replace(/\D/g, '');
                        if (telSugerencia.length >= 8) {
                            estado.datos.celular_sugerencia = telSugerencia;
                            estado.paso = 'ESPERANDO_SUGERENCIA';
                            await sock.sendMessage(jid, { text: "✍️ ¡Perfecto! Ahora escribí tu sugerencia para mejorar PetyBot:" });
                        } else {
                            await sock.sendMessage(jid, { text: "⚠️ Por favor, ingresá un número de teléfono válido (mínimo 8 dígitos)." });
                        }
                        break;
 
                    case 'ESPERANDO_SUGERENCIA':
                        if (!texto) {
                            await sock.sendMessage(jid, { text: "⚠️ No recibí ningún texto. Por favor, escribí tu sugerencia." });
                            break;
                        }
 
                        await sock.sendMessage(jid, { text: "✅ ¡Gracias por tu sugerencia! La hemos recibido y la tendremos en cuenta. 🐾" });
 
                        if (ADMIN_PHONE) {
                            const adminJid = `${ADMIN_PHONE}@s.whatsapp.net`;
                            const mensajeAdmin = `💬 *Nueva Sugerencia recibida*\n\n` +
                                                 `👤 *De:* ${estado.datos.nombre_contacto}\n` +
                                                 `📱 *Tel. Contacto:* ${estado.datos.celular_sugerencia}\n` +
                                                 `🆔 *WhatsApp ID:* ${jid.replace('@s.whatsapp.net', '')}\n\n` +
                                                 `📝 *Sugerencia:*\n${texto}`;
                            try {
                                await sock.sendMessage(adminJid, { text: mensajeAdmin });
                            } catch (err) {
                                console.error('❌ Error al reenviar sugerencia:', err);
                            }
                        } else {
                            console.warn('⚠️ ADMIN_PHONE no configurado en .env. Sugerencia no reenviada.');
                        }
 
                        limpiarSesion(jid);
                        break;
 
                    // CORRECCIÓN: validación estricta de las 3 opciones
                    case 'ESPERANDO_TIPO':
                        if (texto === "1") {
                            estado.datos.id_tipo = configDB.tipos["PERRO"];
                            estado.datos.tipo_nombre = "Perro";
                        } else if (texto === "2") {
                            estado.datos.id_tipo = configDB.tipos["GATO"];
                            estado.datos.tipo_nombre = "Gato";
                        } else if (texto === "3") {
                            estado.datos.id_tipo = configDB.tipos["OTRO"];
                            estado.datos.tipo_nombre = "Otro";
                        } else {
                            await sock.sendMessage(jid, { text: "❌ Opción no válida. Respondé *1* para Perro, *2* para Gato o *3* para Otro." });
                            break;
                        }
                        estado.paso = 'ESPERANDO_NOMBRE';
                        await sock.sendMessage(jid, { text: `✅ ¿Cómo se llama? (O escribí "No sé")` });
                        break;
 
                    case 'ESPERANDO_NOMBRE':
                        estado.datos.nombre_mascota = texto;
                        estado.paso = 'ESPERANDO_UBICACION';
                        await sock.sendMessage(jid, { text: `📍 Ahora enviame la *Ubicación* (Clip 📎 > Ubicación).` });
                        break;
 
                    case 'ESPERANDO_UBICACION':
                        const loc = msg.message?.locationMessage || msg.message?.liveLocationMessage;
                        if (loc) {
                            estado.datos.latitud = loc.degreesLatitude;
                            estado.datos.longitud = loc.degreesLongitude;
                            estado.paso = 'ESPERANDO_FOTO';
                            await sock.sendMessage(jid, { text: "📸 Enviame una *foto* de la mascota." });
                        } else {
                            await sock.sendMessage(jid, { text: "⚠️ Usá el botón de adjuntar ubicación de WhatsApp." });
                        }
                        break;
 
                    case 'ESPERANDO_FOTO':
                        if (msg.message?.imageMessage) {
                            estado.datos.mensajeFoto = msg; 
                            estado.paso = 'ESPERANDO_CELULAR';
                            await sock.sendMessage(jid, { text: "📱 Ingresá tu *celular* (Ej: 1112345678)." });
                        } else {
                            await sock.sendMessage(jid, { text: "⚠️ Necesito la foto para el reporte." });
                        }
                        break;
 
                    case 'ESPERANDO_CELULAR':
                        const cel = texto.replace(/\D/g, '');
                        if (cel.length >= 10) {
                            estado.datos.celular = cel;
                            const bufferFoto = await downloadMediaMessage(estado.datos.mensajeFoto, 'buffer', {});
                            const resumenTexto = `📝 *RESUMEN DEL REPORTE*\n\n` +
                                           `📢 *Estado:* ${estado.datos.categoria_nombre}\n` +
                                           `🐾 *Tipo:* ${estado.datos.tipo_nombre}\n` +
                                           `🐶 *Nombre:* ${estado.datos.nombre_mascota}\n` +
                                           `📞 *Contacto:* ${estado.datos.celular}\n` +
                                           `👤 *Informante:* ${estado.datos.nombre_contacto}\n\n` +
                                           `👇 *Revisá la ubicación y la foto arriba.*`;
 
                            await sock.sendMessage(jid, { image: bufferFoto, caption: resumenTexto });
                            await sock.sendMessage(jid, { location: { degreesLatitude: estado.datos.latitud, degreesLongitude: estado.datos.longitud } });
                            await sock.sendMessage(jid, { text: "¿Confirmás la publicación en el portal? (Responde *SI* o *NO*)" });
                            estado.paso = 'CONFIRMACION';
                        } else {
                            await sock.sendMessage(jid, { text: "⚠️ El número debe tener al menos 10 dígitos." });
                        }
                        break;
 
                    case 'CONFIRMACION':
                        if (textoLower === 'si' || textoLower === 'sí') {
                            await sock.sendMessage(jid, { text: "⏳ Guardando datos en el Portal de Ituzaingó..." });
                            try {
                                const buffer = await downloadMediaMessage(estado.datos.mensajeFoto, 'buffer', {});
                                const formData = new FormData();
                                formData.append('id_usuario', '1'); 
                                formData.append('id_categoria', String(estado.datos.id_categoria));
                                formData.append('id_tipo', String(estado.datos.id_tipo));
                                formData.append('id_raza', '1');
                                formData.append('titulo', `Mascota ${estado.datos.nombre_mascota}`.substring(0, 70));
                                formData.append('nombre_contacto', estado.datos.nombre_contacto);
                                formData.append('celular', estado.datos.celular);
                                formData.append('nota', `Tel: ${estado.datos.celular}`);
                                formData.append('sexo', 'Macho');
                                formData.append('calle', 'GPS WhatsApp');
                                formData.append('latitud', String(estado.datos.latitud));
                                formData.append('longitud', String(estado.datos.longitud));
 
                                const blob = new Blob([buffer], { type: 'image/jpeg' });
                                formData.append('foto2', blob, 'mascota_reporte.jpg');
 
                                const response = await fetch(`${API_BASE_URL}/api/mascota_chat_graba`, {
                                    method: "POST",
                                    body: formData
                                });
 
                                if (response.ok) {
                                    await sock.sendMessage(jid, { text: "🚀 ¡TODO LISTO! Ya podés ver la publicación en la web. ¡Gracias por ayudar! 🐾" });
                                } else {
                                    throw new Error(`Error en el backend: ${response.status}`);
                                }
                            } catch (err) {
                                // CORRECCIÓN: la sesión siempre se limpia, incluso si falla el POST
                                console.error('❌ Error al guardar reporte:', err);
                                await sock.sendMessage(jid, { text: "⚠️ Error al conectar con el servidor. Escribí *HOLA* para intentar de nuevo." });
                            } finally {
                                limpiarSesion(jid);
                            }
                        } else if (textoLower === 'no') {
                            await sock.sendMessage(jid, { text: "❌ Publicación cancelada. Escribí *HOLA* para empezar." });
                            limpiarSesion(jid);
                        } else {
                            await sock.sendMessage(jid, { text: "⚠️ Por favor, respondé *SI* o *NO*." });
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('❌ Error crítico en escucha.js:', error);
        }
    });
};
 