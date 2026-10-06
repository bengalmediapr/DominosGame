# Cómo lanzar Dominó Boricua en Steam (y otras tiendas)

Guía práctica para pasar de este repositorio a un juego a la venta. Los precios y plazos de las tiendas
cambian: verifícalos en la documentación oficial antes de pagar o anunciar fechas.

## 1. Lo que ya está listo en el código

| Pieza | Estado |
|---|---|
| Reglas de dominó puertorriqueño (parejas a 500, capicú, tranque, pollona) | ✅ con pruebas automáticas |
| Modo **Ruleta Boricua** (cada cual por su cuenta, revólver de 6 recámaras) | ✅ con pruebas |
| IA en 3 niveles (Fácil / Normal / Difícil) | ✅ |
| Mesa 3D (Three.js): chinchorro, personajes, revólveres, cámara en primera persona | ✅ versión jugable |
| Español / inglés, sonidos generados por código (sin licencias de audio) | ✅ |
| App de escritorio (Electron) para Windows, macOS y Linux | ✅ |
| Logros de Steam (`steamworks.js`) | ✅ código listo, falta configurarlos en Steamworks |
| Guardar y continuar partida | ✅ local (falta Steam Cloud) |

## 2. Antes de vender: lo que falta (en orden de importancia)

1. **Multijugador en línea con amigos.** Lo que hizo exitoso a juegos como Liar's Bar es jugar con
   amigos por internet. `steamworks.js` ya trae lobbies y networking P2P de Steam, y el motor de reglas
   está separado del UI, lo cual facilita sincronizar partidas. Es la siguiente gran tarea.
2. **Arte final.** Los personajes y objetos son "arte de programador" hecho con figuras básicas. Para
   vender, contrata a un artista 3D (personajes estilo vejigante, jíbaro, etc.) o compra modelos con
   licencia comercial (formato glTF/GLB, que Three.js carga directamente).
3. **Música.** Encarga música original (plena, bomba, salsa) o compra con licencia comercial.
4. **Control (gamepad)** para Steam Deck "Verified" y jugar desde el sofá.
5. **Steam Cloud** para guardar partidas entre computadoras.
6. **Tráiler y capturas** (ver sección 5).

## 3. Cuenta y pago en Steam (Steamworks)

1. Crea la cuenta en **partner.steamgames.com** (Steamworks).
2. Llena los datos legales, bancarios y la **entrevista de impuestos**. Como residente de Puerto Rico
   normalmente se usa el formulario W-9 de EE. UU.; consulta con tu contable sobre Hacienda.
3. Paga el **Steam Direct fee**: $100 por juego. Se te devuelve cuando el juego genera $1,000 en ventas.
4. Steam se queda con 30 % de las ventas (baja a 25 % después de $10 M y a 20 % después de $50 M).
5. Plazos: hay una espera de **30 días** desde el pago antes de poder lanzar. La página "Próximamente"
   tiene que estar publicada **al menos 2 semanas** antes del lanzamiento. Valve revisa la página y el
   build (cuenta unos 3–5 días hábiles por revisión).

## 4. Configurar el juego en Steamworks

- **App ID**: en tu PC de pruebas, pon el número en `steam_appid.txt` en la raíz del proyecto
  (está en `.gitignore`). En el build que se sube a Steam no hace falta: Steam lo pasa al lanzar.
- **Logros** (Stats & Achievements). Crea estos con el mismo *API name*:

  | API name | Nombre sugerido |
  |---|---|
  | `ACH_FIRST_HAND` | ¡Primera mano! |
  | `ACH_FIRST_MATCH` | Campeón del chinchorro |
  | `ACH_CAPICU` | ¡Capicú! |
  | `ACH_POLLONA` | ¡Pollona! |
  | `ACH_TRANQUE_WIN` | Gané el tranque |
  | `ACH_HARD_WIN` | Ganarle a los duros |

- **Encuesta de contenido maduro**: el modo Ruleta muestra personajes apuntándose un revólver a la cabeza
  (sin sangre). Decláralo honestamente en *Content Survey* (violencia); Steam pondrá el aviso y la
  verificación de edad que correspondan. No declararlo puede causar que retiren el juego.
- **Clasificación por edad (IARC)**: opcional en Steam, pero necesaria para algunos países y otras tiendas.

## 5. Arte para la página de la tienda

| Imagen | Tamaño (px) |
|---|---|
| Header capsule | 920 × 430 |
| Small capsule | 462 × 174 |
| Main capsule | 1232 × 706 |
| Vertical capsule | 748 × 896 |
| Library capsule | 600 × 900 |
| Library hero | 3840 × 1240 |
| Library logo (PNG transparente) | 1280 × 720 |
| Capturas de pantalla (mínimo 5) | 1920 × 1080 |

Un tráiler corto (30–60 s) que muestre la ruleta y el capicú vende más que cualquier texto.

## 6. Crear y subir el build

```bash
npm ci
npm test                 # reglas + layout
npm run dist:steam       # genera release/<plataforma>-unpacked/
```

Sube la carpeta `release/win-unpacked` (y `linux-unpacked` / `mac` si vendes en esas plataformas) con
**SteamPipe** (`steamcmd` + un archivo `app_build_<appid>.vdf` que apunte a esa carpeta). El ejecutable
de lanzamiento es `Dominó Boricua.exe`. Cada plataforma va en su propio *depot*.

Recomendado: firma el `.exe` con un certificado de *code signing* (evita la alerta de Windows
SmartScreen fuera de Steam). Para macOS hace falta la cuenta de Apple Developer ($99/año) y "notarizar".

## 7. Nombre y marcas: cuidado

- **No uses "Liar's Bar"** en el título, etiquetas, capturas ni descripción, y no copies su arte. La mecánica
  de la ruleta no es de nadie, pero el nombre y el arte sí.
- **No uses marcas reales** (Medalla, Don Q, Domino's, etc.). La lata de cerveza del juego es genérica a propósito.
- Antes de imprimir nada, busca "Dominó Boricua" en Steam y en el USPTO (marcas registradas) por si ya
  existe. Si está tomado, cámbialo en `package.json` (`productName`), `index.html` y `src/ui/i18n.ts`.

## 8. Otras tiendas para PC (el mismo build sirve)

Sin App ID de Steam el juego corre normal (sin DRM), así que el mismo build sirve para:

- **itch.io**: gratis, tú escoges el porcentaje que se queda itch (por defecto 10 %). Ideal para una demo temprana.
- **Epic Games Store**: autopublicación, tarifa de $100 por juego, Epic se queda con 12 %.
- **GOG**: es curada: envías el juego para que lo evalúen.
- **Microsoft Store (PC)**: cuenta de desarrollador; acepta apps Win32 empaquetadas.

## 9. Precio sugerido

Para un juego de mesa con IA y modo ruleta, entre **$4.99 y $7.99**. Con multijugador en línea y arte
final se puede justificar más. Un descuento de lanzamiento (10–20 %) ayuda a la visibilidad en Steam.
