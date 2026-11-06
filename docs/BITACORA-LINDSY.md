# Bitacora Lindsy / NexoAI (actualizada 2026-11-06)

## Piezas
- Lindsy (WhatsApp, numero 789): servicio nexoai-personal en Render, rama asistente-personal-groq-base-segura (deploy manual). Modelo Groq openai/gpt-oss-20b. Limite por numero: 10 msgs/hora, 60/hora entre desconocidos (limite.js); el dueno esta exento.
- Lindsy ProMax (app Android): carpeta lindsy-promax/, rama lindsy-promax. El APK se compila solo con GitHub Actions y queda en el release lindsy-promax-latest. Version 0.5.1 (applicationId com.nexoai.lindsy.promax).
  - Pantallas: Hablar, Agenda, Modo escucha (decir Lindsy), Ajustes (voz y escucha en segundo plano).
  - La clave de la app es el valor de LINDSY_APP_TOKEN en Render. Se carga en la app en Clave de acceso.
  - Picovoice NO sirve (plan gratis cerrado el 30/06/2026). La escucha en segundo plano usa el reconocimiento de voz de Android.
- Bot de WhatsApp personal en Termux (aparte de Render): whatsapp-web.js + Chromium, y un cerebro Python sin librerias externas que llama a Groq por HTTP. Los dos archivos (index.js y agent_server.py) se reconstruyen pidiendoselos a Claude.

## Reinstalar la tablet (despues de borrarla)
1. Lindsy ProMax: bajar el APK del release lindsy-promax-latest, instalar, cargar la clave.
2. Termux: instalar desde F-Droid (no Play Store).
3. En Termux: pkg update, pkg upgrade (responder N si pregunta por archivos de configuracion), pkg install -y nodejs python git, pkg install -y x11-repo tur-repo, pkg update -y, pkg install -y chromium.
4. mkdir -p ~/bot_whatsapp, cd ~/bot_whatsapp, npm init -y, PUPPETEER_SKIP_DOWNLOAD=true npm install whatsapp-web.js, npm install qrcode-terminal. NO instalar groq por pip (falla compilando pydantic-core).
5. Guardar la clave de Groq: read -s K, echo export GROQ_API_KEY=$K >> ~/.bashrc, unset K; source ~/.bashrc.
6. Crear index.js y agent_server.py (pedirselos a Claude); touch blocked.txt.
7. Arrancar: nohup python -u agent_server.py > agent.log 2>&1 &, probar con curl -s -X POST localhost:5000 -d @t.json, luego node index.js y escanear el QR (WhatsApp > Dispositivos vinculados).
- Tip de Termux: pegar bloques largos a veces mete un [200~ al principio; si pasa, escribir el comando a mano.

## Pendiente
- Termux: el cerebro daba 401 porque no tenia GROQ_API_KEY cargada; falta source ~/.bashrc, arrancar el cerebro de nuevo y despues vincular WhatsApp por QR.
- Voz de Lindsy por WhatsApp con OpenAI TTS: falta OPENAI_API_KEY (rama lindsy-voz sin fusionar).
- Render Starter + Postgres cuando haya tarjeta (la agenda se pierde en cada deploy).
- Borrar la clave de Groq vieja expuesta (gsk_9ENP...) si no se hizo.
- Revisar o bloquear el numero +1 628 300 0143.
