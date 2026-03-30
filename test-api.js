import 'dotenv/config';

// 1. Limpiamos la URL del .env para no duplicar "/api"
const API_URL = process.env.API_BASE_URL.replace(/\/$/, "") + "/api/mascota_chat_graba";

const testPost = async () => {
    console.log(`🚀 Probando POST a: ${API_URL}`);

    // Simulamos los datos que enviaría el Bot
    const datos = new URLSearchParams();
    datos.append('id_usuario', '1');
    datos.append('id_categoria', '10');
    datos.append('id_tipo', '10');
    datos.append('titulo', 'TEST POSTMAN DESDE NODE');
    datos.append('des', 'Prueba técnica');
    datos.append('latitud', '-34.66');
    datos.append('longitud', '-58.66');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: datos,
            headers: { 
                // Usamos urlencoded para que el servidor no se trabe con Multer/Fotos
                'Content-Type': 'application/x-www-form-urlencoded' 
            }
        });

        const status = response.status;
        const texto = await response.text();

        console.log(`-----------------------------------`);
        console.log(`📡 Status del Servidor: ${status}`);
        
        if (texto.includes('<!DOCTYPE html>')) {
            console.error("❌ ERROR: El servidor respondió con el HTML del Portal.");
            console.log("💡 Esto confirma que la ruta /api/mascota_nuevo_graba NO está siendo capturada por Express.");
            console.log("   Revisá el orden de tus rutas en el servidor Ubuntu.");
        } else {
            console.log("✅ RESPUESTA DEL BACKEND:", texto);
        }
        console.log(`-----------------------------------`);

    } catch (err) {
        console.error("❌ ERROR DE RED/CONEXIÓN:", err.message);
    }
};

testPost();
