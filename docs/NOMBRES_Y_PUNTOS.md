# Nombres, puntos y conexión en línea (Cloudflare)

El juego usa dos cosas gratis de Cloudflare, además de Pages. Las dos se configuran una sola vez en el
panel de Cloudflare (dash.cloudflare.com), en el proyecto **dominosgame**.

## 1. Base de datos para los nombres y los puntos (D1)

Sin esto, la pantalla de nombre dice "El servidor de nombres todavía no está listo".

1. **Storage & Databases → D1 → Create database**. Nombre: `capicu`. Create.
2. **Workers & Pages → dominosgame → Settings → Bindings → Add → D1 database**.
   - Variable name: `DB` (exacto, en mayúsculas)
   - D1 database: `capicu`
   - Hazlo para **Production** (y para Preview si quieres probar allí también).
3. **Deployments** → en el último deploy de producción, **⋯ → Retry deployment** (los cambios de
   configuración solo aplican a deploys nuevos).

Las tablas se crean solas la primera vez que alguien se pone un nombre.

## 2. Relay para jugar en línea (TURN de Cloudflare Realtime)

Muchos routers de casa no dejan que dos computadoras se conecten directo. Sin un relay, el que entra con
el código ve "Se encontró la mesa, pero… no se pudieron conectar". El relay de Cloudflare es gratis
hasta 1,000 GB al mes (una partida de dominó usa muy poco).

1. **Realtime → TURN Server → Create TURN key** (en algunas cuentas la sección se llama **Calls**).
   Nombre: `capicu`. Copia el **Turn Token ID** y el **API Token** (el token solo se muestra una vez).
2. **Workers & Pages → dominosgame → Settings → Variables and Secrets → Add**:
   - `TURN_KEY_ID` = el Turn Token ID (tipo Text)
   - `TURN_KEY_API_TOKEN` = el API Token (tipo **Secret**)
3. **Retry deployment** como en el paso 1.

Para comprobarlo, abre `https://dominosgame.pages.dev/api/ice`: debe mostrar una lista de servidores
(`iceServers`). Si dice `noRelay`, faltan las variables.

## Cómo funciona

- `functions/api/[[route]].ts` es la función de Cloudflare Pages; la lógica está en `server/api.ts`.
- Cada nombre es único: no cuentan las mayúsculas, los acentos ni los espacios/guiones ("José_PR" = "jose pr").
  Los nombres de los personajes (Wiso, Papo, Doña Lola, Cheo) están reservados.
- Cada nombre tiene una **clave** que escoge quien lo crea. Con nombre y clave se entra desde cualquier
  computadora o celular ("¿Ya tienes nombre? Entra"), y los puntos vienen con el nombre. Cinco claves
  incorrectas seguidas bloquean ese nombre por 15 minutos. El servidor solo guarda la clave cifrada
  (PBKDF2), nunca la clave en sí. Si alguien olvida su clave, por ahora no hay forma de recuperarla.
- Al terminar una partida (o morir en la Ruleta) el juego suma: en Parejas, los puntos de tu equipo; en la
  Ruleta, las fichas que les quedan a los demás en cada mano que ganas. Cada partida cuenta una sola vez.
- Los puntos los reporta el juego de cada jugador, así que alguien que modifique el juego podría hacer
  trampa (el servidor solo rechaza números imposibles). Para una tabla seria, el anfitrión debería
  reportar por todos, o usar Steam.
