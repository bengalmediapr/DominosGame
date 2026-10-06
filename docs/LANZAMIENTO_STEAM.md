# Cómo lanzar Capicú en Steam (y otras tiendas)

Guía práctica para pasar de este repositorio a un juego a la venta. Los precios y plazos de las tiendas
cambian: verifícalos en la documentación oficial antes de pagar o anunciar fechas.

## 1. Lo que ya está listo en el código

| Pieza | Estado |
|---|---|
| Reglas de dominó puertorriqueño (parejas a 500, capicú, tranque, pollona) | ✅ con pruebas automáticas |
| Modo **Ruleta Boricua** (cada cual por su cuenta, revólver de 6 recámaras) | ✅ con pruebas |
| IA en 3 niveles (Fácil / Normal / Difícil) | ✅ |
| Mesa 3D (Three.js): chinchorro, revólveres, cámara en primera persona | ✅ versión jugable |
| Personajes 3D animados (KayKit, CC0) vestidos como boricuas | ✅ |
| **Multijugador en línea por Steam** (mesas de amigos, 2 a 4 personas + IA) | ✅ código listo, falta probarlo con el App ID real |
| Español / inglés, sonidos generados por código (sin licencias de audio) | ✅ |
| App de escritorio (Electron) para Windows, macOS y Linux | ✅ |
| Logros de Steam (`steamworks.js`) | ✅ código listo, falta configurarlos en Steamworks |
| Guardar y continuar partida | ✅ local (falta Steam Cloud) |

## 2. Antes de vender: lo que falta (en orden de importancia)

1. **Probar el multijugador en Steam de verdad** (ver sección 4b): dos computadoras, dos cuentas de Steam.
2. **Más arte.** Los personajes ya son modelos animados (KayKit, CC0); la mesa, el cuarto y el
   revólver siguen hechos con figuras básicas. Un artista 3D puede reemplazarlos (formato .glb).
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

## 4b. Multijugador en línea (Steam)

Cómo funciona:

- El jugador que crea la mesa es el **anfitrión**: su juego es el único que corre las reglas. A los
  demás les manda solo lo que pueden ver (sus fichas, no las de otros ni dónde está la bala), así que
  nadie puede hacer trampa editando su copia del juego.
- La mesa es un **lobby de Steam "solo amigos"** de 4 puestos. El botón *Invitar amigos de Steam* abre
  el overlay de invitaciones. Si el amigo acepta con el juego cerrado, Steam lo abre con
  `+connect_lobby <id>` y entra directo a la mesa.
- Los mensajes van por la red P2P de Steam (con relay de Valve: no hace falta abrir puertos ni pagar servidores).
- Si alguien se desconecta, la IA toma su silla. Si alguien no jala el gatillo en 25 s, se jala solo.

En Steamworks no hay que configurar nada especial para los lobbies. Para probarlo antes del lanzamiento:

1. Sube un build a una rama beta (SteamPipe) o usa `steam_appid.txt` en dos PCs.
2. Abre el juego desde Steam en las dos computadoras, con dos cuentas que sean amigas.
3. PC 1: *Jugar en línea → Crear mesa → Invitar amigos de Steam*. PC 2: acepta la invitación.

Sin Steam se puede probar el flujo completo en una sola computadora: en la versión de navegador,
*Jugar en línea → Prueba en esta computadora*, crea una mesa y únete desde otra pestaña con el código.

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
de lanzamiento es `Capicú.exe`. Cada plataforma va en su propio *depot*.

Recomendado: firma el `.exe` con un certificado de *code signing* (evita la alerta de Windows
SmartScreen fuera de Steam). Para macOS hace falta la cuenta de Apple Developer ($99/año) y "notarizar".

## 7. Nombre y marcas: cuidado

- **No uses "Liar's Bar"** en el título, etiquetas, capturas ni descripción, y no copies su arte. La mecánica
  de la ruleta no es de nadie, pero el nombre y el arte sí.
- **No uses marcas reales** (Medalla, Don Q, Domino's, etc.). La lata de cerveza del juego es genérica a propósito.
- "Capicú" es una palabra común del dominó, así que puede haber otros juegos o marcas con ese nombre.
  Antes de imprimir nada, búscalo en Steam y en el USPTO (marcas registradas). Si quieres algo más
  distintivo para la tienda, se puede usar un subtítulo, p. ej. "Capicú: Dominó Boricua".

## 8. Otras tiendas para PC (el mismo build sirve)

Sin App ID de Steam el juego corre normal (sin DRM), así que el mismo build sirve para:

- **itch.io**: gratis, tú escoges el porcentaje que se queda itch (por defecto 10 %). Ideal para una demo temprana.
- **Epic Games Store**: autopublicación, tarifa de $100 por juego, Epic se queda con 12 %.
- **GOG**: es curada: envías el juego para que lo evalúen.
- **Microsoft Store (PC)**: cuenta de desarrollador; acepta apps Win32 empaquetadas.

## 9. Créditos y licencias de arte

- Personajes y sillas: **KayKit** de Kay Lousberg (www.kaylousberg.com), licencia CC0. No exige crédito,
  pero es buena práctica ponerlo en los créditos del juego. Los originales están en `assets-src/`
  y `npm run models` genera las versiones optimizadas en `public/models/`.
- Todo lo demás (mesa, cuarto, texturas, sonidos) se genera en código.

## 10. Precio sugerido

Para un juego de mesa con IA y modo ruleta, entre **$4.99 y $7.99**. Con multijugador en línea y arte
final se puede justificar más. Un descuento de lanzamiento (10–20 %) ayuda a la visibilidad en Steam.
