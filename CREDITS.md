# Créditos y licencias de arte

| Recurso | Archivo en el juego | Fuente | Licencia |
|---|---|---|---|
| Personajes (Don Rafa, Nico, Yadiel, Tito) | `public/models/{don_rafa,nico,yadiel,tito}.glb` (de `assets-src/boricuas/`, comprimidos con `scripts/prepare-boricuas.mjs`) | **Pendiente: confirmar autor y licencia** | **Pendiente** |
| Silla | `public/models/chair.*` | KayKit de Kay Lousberg (www.kaylousberg.com) | CC0 |
| Casa de San Juan | `public/models/house.glb` (de `assets-src/house/SanJuanModernHouse2.fbx`) | **Pendiente: confirmar autor y licencia** | **Pendiente** |
| Mesa de dominó | `public/models/table.glb` (de `assets-src/table/`) | Sketchfab, **pendiente: enlace, autor y licencia** | **Pendiente** |
| Forma del dominó | `public/models/domino.glb` (de `assets-src/domino/Domino_Generator.blend`) | **Pendiente: confirmar autor y licencia** | **Pendiente** |
| Revólver (.38 Special) | `public/models/revolver.glb` (de `assets-src/revolver/`) | **Pendiente: confirmar autor y licencia** | **Pendiente** |
| Texturas de la casa (nombres) | Wood050, Paint004, Asphalt023S, Tiles111, Wood085B | ambientCG | CC0 |
| Todo lo demás (patio, piscina, cielo, sonidos) | generado en código | — | del proyecto |

Notas:
- Las texturas originales de la mesa traían el nombre y el logo de una marca de cerveza. Se quitaron con
  `scripts/clean-table-textures.py` (resultado en `assets-src/table/textures-clean/`), porque un juego a la
  venta no puede usar marcas registradas de terceros.
- Antes de vender: si una licencia es CC-BY, hay que poner el crédito dentro del juego (pantalla de créditos).
  Si es NC (no comercial) o ND (sin derivados), ese modelo no se puede usar en un juego a la venta.
