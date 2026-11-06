// Servicio POI Inteligente en Ruta (Gasolineras y Restaurantes Pet-Friendly)
let ultimaAlertaPoiTiempo = 0;

async function verificarPoiEnRuta(userLocation, mapboxAccessToken, mapboxgl, hablarCallback) {
    const ahora = Date.now();
    // Comprobar cada 30 segundos para no saturar las peticiones en ruta
    if (ahora - ultimaAlertaPoiTiempo < 30000) return; 

    // Alternar aleatoriamente la búsqueda entre gasolinera y restaurante pet-friendly
    const query = Math.random() > 0.5 ? 'gasolinera' : 'restaurante dog friendly';
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?proximity=${userLocation[0]},${userLocation[1]}&limit=3&language=es&access_token=${mapboxAccessToken}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const poi = data.features[0];
            const dist = calcularDistanciaMetrosLocales(userLocation, poi.center);
            
            // Si el servicio está a menos de 5 km (5000 metros)
            if (dist <= 5000) {
                const distKm = (dist / 1000).toFixed(1);
                const nombrePoi = poi.text || query;
                const esMascota = query.includes('dog');
                
                const textoAviso = esMascota 
                    ? `🐾 Restaurante Pet-Friendly "${nombrePoi}" a ${distKm} km en tu ruta.` 
                    : `⛽ Gasolinera "${nombrePoi}" a ${distKm} km en tu ruta.`;

                // Mostrar banner flotante en la interfaz
                const banner = document.getElementById('poi-alert-banner');
                const textoBanner = document.getElementById('poi-alert-text');
                
                if (banner && textoBanner) {
                    textoBanner.innerText = textoAviso;
                    banner.style.display = 'flex';
                }

                // Reproducir alerta por voz
                if (typeof hablarCallback === 'function') {
                    hablarCallback(textoAviso);
                }
                
                ultimaAlertaPoiTiempo = ahora;
            }
        }
    } catch(e) {
        console.warn("Error en servicio POI automático:", e);
    }
}

// Función auxiliar de cálculo de distancia en metros
function calcularDistanciaMetrosLocales(coord1, coord2) {
    const R = 6371e3;
    const lat1 = coord1[1] * Math.PI/180;
    const lat2 = coord2[1] * Math.PI/180;
    const deltaLat = (coord2[1]-coord1[1]) * Math.PI/180;
    const deltaLon = (coord2[0]-coord1[0]) * Math.PI/180;
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function ocultarBannerPoi() {
    const banner = document.getElementById('poi-alert-banner');
    if (banner) banner.style.display = 'none';
}