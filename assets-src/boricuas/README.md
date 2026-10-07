# Cuatro personajes boricuas

Este paquete contiene cuatro modelos GLB completos, con diferencias de cuerpo, cara, pelaje, edad, ropa y calzado.

| Archivo | Personaje | Edad | Aspecto |
| --- | --- | --- | --- |
| don_rafa.glb | Don Rafa | 68 | Menor estatura, postura ligeramente inclinada, pelaje canoso, barba y gafas; guayabera celeste de manga larga, pantalon azul gris y zapatos marrones. |
| nico.glb | Nico | 22 | Complexion delgada, orejas altas y pelaje dorado; camiseta deportiva verde lima sin mangas, pantalon oscuro con franjas claras y tenis blancos. |
| yadiel.glb | Yadiel | 36 | Complexion media, cara de dos tonos y cicatriz; chaqueta roja con capucha y cremallera, camiseta negra, pantalon azul verdoso, zapatos negros y cadena dorada. |
| tito.glb | Tito | 49 | Cuerpo ancho, mandibula fuerte y orejas cortas; chaleco verde petroleo con bolsillos y cinta naranja, pantalon oliva, vendas y botas de trabajo. |

Los ojos usan iris de diferentes tonos rojos. Cada prenda conserva un pequeno detalle de Puerto Rico.

## Correcciones del cuerpo

- Brazos mas cortos y complexiones diferentes.
- Ropa con volumen separado de la superficie muscular.
- Superficies ocultas del cuerpo retiradas para evitar que atraviesen la ropa.
- Pies cubiertos por calzado real; las garras ocultas fueron retiradas.
- Normales suavizadas en cuerpo y ropa.
- Posiciones de huesos e inversas de enlace ajustadas junto con las proporciones.

## Datos del juego

| Personaje | Triangulos | Objetos de malla | Articulaciones usadas |
| --- | --- | --- | --- |
| Don Rafa | 31,676 | 14 | 58 |
| Nico | 30,348 | 12 | 58 |
| Yadiel | 34,903 | 16 | 58 |
| Tito | 30,478 | 14 | 58 |

Formato: GLB 2.0, con materiales, colores de vertices y texturas integradas. Cada personaje tiene su propio archivo. Los GLB conservan la pose base de brazos abiertos para el rig. El visor baja los brazos solamente para la presentacion.

## Verificacion

Se comprobaron posiciones finitas, pesos normalizados, indices de huesos, matrices de enlace y que las variantes no modifican el rig del modelo fuente. Los cuatro GLB se volvieron a abrir en el visor y se revisaron de frente y espalda.

No incluyen clips de animacion. La importacion y las animaciones completas deben comprobarse en el motor del juego. Los huesos mantienen sus nombres, pero sus posiciones de reposo cambian con las proporciones; revisar el retargeting antes de reutilizar animaciones.

Importar en Blender para seguir editando o convertir a FBX. Los FBX de paquetes anteriores no incluyen estas cuatro variantes.

Visor local: http://127.0.0.1:8766/viewer/variants.html?saved=1
