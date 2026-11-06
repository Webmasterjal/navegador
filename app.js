mapboxgl.accessToken = 'pk.eyJ1Ijoid2VibWFzdGVyamFsIiwiYSI6ImNtdzNnNGM4cjAweDIyeXNhaDAzcjE3OTYifQ.snL3P2ggH79YTW9ISagH3A';

let userLocation = [-3.8648, 40.3228]; // Móstoles por defecto
let lastValidLocation = null;
let lastHeading = 0;

let ultimoDestino = null;
let modoTransporte = 'driving';
let evitarPeajes = false;
let evitarFerries = false;
let evitarSinAsfaltar = false;

let miMarcador = null;
let marcadoresRadaresMapa = [];
let rutaPasos = [];
let pasoActualIndex = 0;
let navegacionIniciada = false;
let duracionTotalSegundos = 0;
let distanciaTotalMetros = 0;
let mapLoaded = false;
let debounceTimer = null;

const baseDeRadares = [
    { id: 1, tipo: 'fijo', coords: [-3.8610, 40.3250], limite: 120, texto: "Atención: Radar Fijo a 120 kilómetros por hora" },
    { id: 2, tipo: 'tramo', coords: [-3.8700, 40.3180], limite: 120, texto: "Atención: Inicio de Radar de Tramo a 120 kilómetros por hora" },
    { id: 3, tipo: 'semaforo', coords: [-3.8650, 40.3210], limite: 50, texto: "Atención: Cámara de semáforo a 50" },
    { id: 4, tipo: 'movil', coords: [-3.8580, 40.3300], limite: 100, texto: "Aviso: Posible control móvil a 100" }
];
let radaresAvisados = new Set();

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/navigation-night-v1',
    center: userLocation,
    zoom: 16,
    pitch: 62,
    bearing: 0
});

function calcularBearing(prevCoords, newCoords) {
    const lat1 = prevCoords[1] * Math.PI / 180;
    const lat2 = newCoords[1] * Math.PI / 180;
    const lon1 = prevCoords[0] * Math.PI / 180;
    const lon2 = newCoords[0] * Math.PI / 180;

    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// Creador del marcador con una flecha SVG profesional orientada al frente de marcha
function crearMarcadorUsuario(heading = 0) {
    if (!miMarcador) {
        const el = document.createElement('div');
        el.className = 'user-nav-arrow';
        el.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3 20L12 16L21 20L12 2Z" fill="#00d2ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            </svg>
        `;
        el.style.transform = `rotate(${heading}deg)`;

        miMarcador = new mapboxgl.Marker({ element: el })
            .setLngLat(userLocation)
            .addTo(map);
    } else {
        miMarcador.setLngLat(userLocation);
        const el = miMarcador.getElement();
        if (el) {
            el.style.transform = `rotate(${heading}deg)`;
        }
    }
}

map.on('load', () => {
    mapLoaded = true;
    crearMarcadorUsuario(0);
    
    const speedPanel = document.getElementById('speed-panel');
    if (speedPanel) speedPanel.style.display = 'flex';

    try {
        if (!map.getSource('route')) {
            map.addSource('route', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': [] } }
            });
        }
        if (!map.getLayer('route')) {
            map.addLayer({
                'id': 'route',
                'type': 'line',
                'source': 'route',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#00d2ff', 'line-width': 8 }
            });
        }
        renderizarRadaresEnMapa();
    } catch(err) {
        console.error("Error al cargar capas:", err);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const configBtn = document.getElementById('config-btn');
    if (configBtn) {
        configBtn.addEventListener('click', () => {
            abrirConfiguracion();
        });
    }
});

function hablar(mensaje) {
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(mensaje);
            utterance.lang = 'es-ES';
            window.speechSynthesis.speak(utterance);
        }
    } catch(e) {}
}

function ocultarTecladoMovil() {
    const inputBuscador = document.getElementById('destination-input');
    if (inputBuscador) inputBuscador.blur();
    const resultsContainer = document.getElementById('search-results-list');
    if (resultsContainer) resultsContainer.style.display = 'none';
    const historyContainer = document.getElementById('history-dropdown');
    if (historyContainer) historyContainer.style.display = 'none';
}

function guardarEnHistorial(coords, nombre) {
    let historial = JSON.parse(localStorage.getItem('gps_historial')) || [];
    historial = historial.filter(item => item.nombre !== nombre);
    historial.unshift({ coords, nombre });
    if (historial.length > 5) {
        historial.pop();
    }
    localStorage.setItem('gps_historial', JSON.stringify(historial));
}

function toggleHistorial() {
    const historyContainer = document.getElementById('history-dropdown');
    if (!historyContainer) return;

    if (historyContainer.style.display === 'block') {
        historyContainer.style.display = 'none';
        return;
    }

    let historial = JSON.parse(localStorage.getItem('gps_historial')) || [];
    if (historial.length === 0) {
        historyContainer.innerHTML = `<div style="padding:12px; font-size:13px; color:#aaa; text-align:center;">No hay destinos recientes</div>`;
    } else {
        historyContainer.innerHTML = '';
        historial.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `🕒 <span>${item.nombre}</span>`;
            div.onclick = () => {
                seleccionarDestino(item.coords, item.nombre);
                historyContainer.style.display = 'none';
            };
            historyContainer.appendChild(div);
        });
    }
    historyContainer.style.display = 'block';
}

async function irACasa() {
    ocultarTecladoMovil();
    let casa = JSON.parse(localStorage.getItem('gps_casa'));
    
    if (!casa) {
        let direccionCasa = prompt("Introduce la dirección de tu Casa (ej: Calle Mayor 1, Móstoles):");
        if (!direccionCasa) return;

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(direccionCasa)}.json?proximity=${userLocation[0]},${userLocation[1]}&country=es&limit=1&language=es&access_token=${mapboxgl.accessToken}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.features && data.features.length > 0) {
                casa = {
                    coords: data.features[0].center,
                    nombre: data.features[0].place_name
                };
                localStorage.setItem('gps_casa', JSON.stringify(casa));
                hablar("Casa guardada correctamente.");
            } else {
                hablar("No se pudo encontrar la dirección de casa.");
                return;
            }
        } catch(e) {
            console.warn("Error guardando casa:", e);
            return;
        }
    }

    seleccionarDestino(casa.coords, `🏠 ${casa.nombre}`);
    hablar("Ruta hacia casa seleccionada.");
}

function buscarSugerencias(query) {
    clearTimeout(debounceTimer);
    const resultsContainer = document.getElementById('search-results-list');
    const historyContainer = document.getElementById('history-dropdown');
    if (historyContainer) historyContainer.style.display = 'none';
    
    if (!query || query.trim().length < 3) {
        if (resultsContainer) resultsContainer.style.display = 'none';
        return;
    }

    debounceTimer = setTimeout(async () => {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?proximity=${userLocation[0]},${userLocation[1]}&country=es&limit=5&language=es&access_token=${mapboxgl.accessToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                resultsContainer.innerHTML = '';
                data.features.forEach(feature => {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:12px; border-bottom:1px solid #333; font-size:13px; cursor:pointer; color:#fff;';
                    item.innerText = feature.place_name;
                    
                    item.onclick = () => {
                        seleccionarDestino(feature.center, feature.place_name);
                    };
                    
                    resultsContainer.appendChild(item);
                });
                resultsContainer.style.display = 'block';
            } else {
                resultsContainer.style.display = 'none';
            }
        } catch(e) {
            console.warn("Error en autocompletado:", e);
        }
    }, 300);
}

function seleccionarDestino(coords, nombre) {
    ocultarTecladoMovil();
    document.getElementById('destination-input').value = nombre;
    guardarEnHistorial(coords, nombre);
    new mapboxgl.Marker({ color: '#ff4757' }).setLngLat(coords).addTo(map);
    calcularRutaPreliminar(coords);
}

async function handleSearchKey(event) {
    if (event.key === 'Enter') {
        const query = event.target.value.trim();
        if (!query) return;
        
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?proximity=${userLocation[0]},${userLocation[1]}&country=es&limit=5&language=es&access_token=${mapboxgl.accessToken}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.features && data.features.length > 0) {
                seleccionarDestino(data.features[0].center, data.features[0].place_name);
            } else {
                hablar("No se ha encontrado la ubicación.");
            }
        } catch(e) {
            console.warn("Error en búsqueda:", e);
        }
    }
}

async function calcularRutaPreliminar(destino) {
    ultimoDestino = destino;
    navegacionIniciada = false;

    const profile = modoTransporte === 'driving' ? 'driving-traffic' : 'walking';
    let excludes = [];
    if (modoTransporte === 'driving') {
        if (evitarPeajes) excludes.push('toll');
        if (evitarFerries) excludes.push('ferry');
        if (evitarSinAsfaltar) excludes.push('unpaved');
    }
    const excludeParam = excludes.length > 0 ? `&exclude=${excludes.join(',')}` : '';

    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${userLocation[0]},${userLocation[1]};${destino[0]},${destino[1]}?steps=true&banner_instructions=true&geometries=geojson&language=es${excludeParam}&access_token=${mapboxgl.accessToken}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data.routes || data.routes.length === 0) return;

        const rutaElegida = data.routes[0];
        rutaPasos = rutaElegida.legs[0].steps;
        duracionTotalSegundos = rutaElegida.duration;
        distanciaTotalMetros = rutaElegida.distance;

        if (mapLoaded && map.getSource('route')) {
            map.getSource('route').setData({
                'type': 'Feature', 'properties': {},
                'geometry': { 'type': 'LineString', 'coordinates': rutaElegida.geometry.coordinates }
            });
        }

        document.getElementById('start-nav-btn').style.display = 'block';

        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend(userLocation);
        bounds.extend(destino);
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 1000 });

    } catch (e) { console.warn("Error calculando ruta preliminar:", e); }
}

function iniciarNavegacionReal() {
    if (!ultimoDestino) return;

    navegacionIniciada = true;
    document.getElementById('start-nav-btn').style.display = 'none';
    document.body.classList.add('nav-active');

    document.getElementById('trip-info-panel').style.display = 'flex';
    document.getElementById('time-left').innerText = `${Math.max(1, Math.round(duracionTotalSegundos / 60))} min`;
    document.getElementById('distance-left').innerText = `${(distanciaTotalMetros / 1000).toFixed(1)} km`;

    const ahora = new Date();
    const llegada = new Date(ahora.getTime() + duracionTotalSegundos * 1000);
    document.getElementById('arrival-time').innerText = `${String(llegada.getHours()).padStart(2, '0')}:${String(llegada.getMinutes()).padStart(2, '0')}`;

    hablar("Navegación iniciada.");
    map.flyTo({ center: userLocation, zoom: 17, pitch: 65, duration: 1500 });
}

function abrirConfiguracion() { 
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'flex'; 
}

function cerrarConfiguracion() { 
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'none'; 
}

function cambiarModoTransporteConfig() {
    const select = document.getElementById('select-modo-transporte');
    if (select) {
        modoTransporte = select.value;
        hablar(modoTransporte === 'driving' ? "Modo coche seleccionado" : "Modo a pie seleccionado");
        if (ultimoDestino) calcularRutaPreliminar(ultimoDestino);
    }
}

function actualizarFiltrosRuta() {
    evitarPeajes = document.getElementById('avoid-tolls-check').checked;
    evitarFerries = document.getElementById('avoid-ferry-check').checked;
    evitarSinAsfaltar = document.getElementById('avoid-unpaved-check').checked;
    if (ultimoDestino) calcularRutaPreliminar(ultimoDestino);
}

function evitarPeajesYRecalcular() {
    evitarPeajes = true;
    document.getElementById('avoid-tolls-check').checked = true;
    document.getElementById('toll-alert-banner').style.display = 'none';
    if (ultimoDestino) calcularRutaPreliminar(ultimoDestino);
}

function calcularDistanciaMetros(coord1, coord2) {
    const R = 6371e3;
    const lat1 = coord1[1] * Math.PI/180;
    const lat2 = coord2[1] * Math.PI/180;
    const deltaLat = (coord2[1]-coord1[1]) * Math.PI/180;
    const deltaLon = (coord2[0]-coord1[0]) * Math.PI/180;
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function renderizarRadaresEnMapa() {
    marcadoresRadaresMapa.forEach(m => m.remove());
    marcadoresRadaresMapa = [];

    baseDeRadares.forEach(radar => {
        const elChk = document.getElementById(`check-radar-${radar.tipo}`);
        if (elChk && !elChk.checked) return;

        let iconoTexto = '📷';
        if (radar.tipo === 'semaforo') iconoTexto = '🚦';
        if (radar.tipo === 'tramo') iconoTexto = '⏱️';
        if (radar.tipo === 'movil') iconoTexto = '🚐';

        const el = document.createElement('div');
        el.className = `radar-pin ${radar.tipo}`;
        el.innerHTML = `${iconoTexto} ${radar.limite}`;

        const marker = new mapboxgl.Marker(el)
            .setLngLat(radar.coords)
            .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(`<b>Radar ${radar.tipo.toUpperCase()}</b><br>Límite: ${radar.limite} km/h`))
            .addTo(map);

        marcadoresRadaresMapa.push(marker);
    });
}

if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
        const accuracy = pos.coords.accuracy;
        const newCoords = [pos.coords.longitude, pos.coords.latitude];

        if (accuracy > 35) {
            return;
        }

        let heading = pos.coords.heading;
        if (lastValidLocation && (!heading || isNaN(heading))) {
            const dist = calcularDistanciaMetros(lastValidLocation, newCoords);
            if (dist > 2) {
                heading = calcularBearing(lastValidLocation, newCoords);
            } else {
                heading = lastHeading;
            }
        }

        userLocation = newCoords;
        lastValidLocation = newCoords;
        lastHeading = heading || 0;

        const speedKmh = pos.coords.speed && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : 0;
        const speedEl = document.getElementById('current-speed');
        if (speedEl) speedEl.innerText = speedKmh;

        crearMarcadorUsuario(lastHeading);

        if (navegacionIniciada) {
            map.easeTo({ 
                center: userLocation, 
                bearing: modoTransporte === 'walking' ? 0 : lastHeading, 
                duration: 800,
                easing: (t) => t
            });

            baseDeRadares.forEach(radar => {
                const elChk = document.getElementById(`check-radar-${radar.tipo}`);
                if (elChk && elChk.checked) {
                    const d = calcularDistanciaMetros(userLocation, radar.coords);
                    const selectDist = document.getElementById(`dist-${radar.tipo}`);
                    const umbral = selectDist ? parseInt(selectDist.value) : 1500;

                    if (d <= umbral) {
                        if (!radaresAvisados.has(radar.id)) {
                            hablar(radar.texto);
                            document.getElementById('radar-banner-title').innerText = `Radar ${radar.tipo.toUpperCase()}`;
                            document.getElementById('radar-banner-dist').innerText = `a ${Math.round(d)} metros`;
                            document.getElementById('radar-banner-speed').innerText = radar.limite;
                            document.getElementById('radar-alert-banner').style.display = 'flex';
                            radaresAvisados.add(radar.id);
                        }
                    }
                }
            });

            if (typeof verificarPoiEnRuta === 'function') {
                verificarPoiEnRuta(userLocation, mapboxgl.accessToken, mapboxgl, hablar);
            }
        }
    }, (err) => { 
        console.warn("Error GPS:", err); 
    }, { 
        enableHighAccuracy: true, 
        maximumAge: 0, 
        timeout: 5000 
    });
}

function centrarEnMiUbicacion() {
    if (map && userLocation) {
        map.flyTo({ center: userLocation, zoom: 17, pitch: 65, duration: 1200 });
    }
}

map.on('click', (e) => {
    ocultarTecladoMovil();
    const coords = [e.lngLat.lng, e.lngLat.lat];
    new mapboxgl.Marker({ color: '#ff4757' }).setLngLat(coords).addTo(map);
    calcularRutaPreliminar(coords);
});