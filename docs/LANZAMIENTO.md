# Orden de lanzamiento

1. **Google Play (Android)** — primero. El juego web se empaqueta como app con Capacitor (o como TWA
   desde dominosgame.pages.dev). La interfaz ya está pensada para teléfono y tablet (vertical y
   horizontal, botones grandes para el dedo, sin depender del teclado).
2. **Steam (Windows/Mac/Linux)** — la versión de escritorio con Electron; ver `LANZAMIENTO_STEAM.md`.
3. **Apple (App Store, iPhone/iPad)** — el mismo empaque de Capacitor, compilado en una Mac con Xcode.

Las mesas públicas y privadas, los nombres y los puntos usan el servidor de `dominosgame.pages.dev`
en todas las versiones, así que todos juegan juntos sin importar desde dónde entren.
