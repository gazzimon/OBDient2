# ADR-0012 — La búsqueda devuelve evidencia, no migajas

**Estado:** aceptada · 2026-10-25

## Contexto

En el chat de prueba del 2026-10-21 el asistente buscó tres veces el DID del odómetro (dos con la misma consulta),
recibió 15 resultados de título y 180 caracteres de fragmento (videos, manuales genéricos, Scribd), no leyó
ninguna página, y terminó mostrando "5 resultados de la web" tres veces como si fuera la respuesta. Las preguntas
sugeridas propusieron seguir un tema que nunca se respondió.

Las causas estaban en el diseño, no en el modelo:

- `web_search` daba a propósito solo el fragmento del buscador, como defensa contra inyección
  (`docs/plans/voz-y-lugares.md` §3). Para una pregunta técnica, la respuesta está en el cuerpo de la página.
- `web_fetch` aplanaba la página a una línea y borraba corchetes, llaves y comillas invertidas: justo lo que tiene
  una tabla de DIDs o un bloque de código. Entregaba los primeros 12.000 caracteres, no lo relevante.
- La base de textos (búsqueda híbrida por palabras y significado, Qwen3-Embedding) existía, pero fuera del camino:
  solo para `docs_search` y para indexar en segundo plano lo que el modelo leía.
- La herramienta decía cuántos resultados hubo, no si alguno respondía. El fallo era silencioso.

## Decisión

1. **Una herramienta `research`** hace en el servidor lo que el modelo no lograba orquestar: busca (en español y,
   para temas técnicos, también en inglés), fusiona por posición, prefiere foros, documentación y repositorios a
   videos y sitios de documentos, lee hasta 3 páginas en paralelo (una por sitio; si una no se puede leer, prueba la
   siguiente), incluidos PDFs con su número de página, las indexa, y devuelve los pocos fragmentos de esas páginas
   que responden la pregunta, cada uno con sitio, título, sección, página y fecha.
2. **La evidencia la juzga el modelo de chat de la Z440**, que lee la pregunta y cada fragmento juntos y dice cuáles
   responden, cuáles son parciales y cuáles solo hablan del mismo tema: `good`, `weak` o `none`. Medido el
   2026-10-25 con 5 preguntas reales, ni la cercanía de significado (un texto ajeno dio 0,68 y la respuesta exacta
   0,70) ni reglas por palabras lo distinguían. Si el juez no responde, nada se califica `good`: a lo sumo `weak`.
   Con `none` el modelo recibe la instrucción de decirlo y no repetir la búsqueda.
3. **Las páginas conservan su estructura** (títulos, código, tablas, listas) y se cortan por esos bloques, nunca a
   través de ellos. Cada fragmento lleva su sección, y el título y la sección van delante del texto para el índice y
   los vectores. Un fragmento corto trae a sus vecinos.
4. **El texto de terceros llega marcado** (delimitadores con una marca al azar por fragmento, "spotlighting") en lugar
   de recortado: se conservan los caracteres que son el contenido, y el prompt dice que lo marcado es solo
   información. Los `<` `>` de la página se cambian por similares para que no imite etiquetas.
5. **`web_search` queda para comercios, direcciones, horarios y precios** (fragmentos cortos con las direcciones y
   precios extraídos). La base de textos sigue sin guardar precios.
6. **El turno termina con una respuesta**: como máximo 2 búsquedas por turno, una consulta repetida se rechaza con
   qué hacer en su lugar, las herramientas que no usan el adaptador corren en paralelo, y las preguntas sugeridas
   solo aparecen si el modelo respondió.

## Consecuencias

- Más texto de terceros llega al modelo. El riesgo de inyección queda acotado porque las herramientas que actúan
  (`clear_dtcs`, iniciar la navegación) piden confirmación en pantalla y `obd_command` es de solo lectura.
- `research` tarda más que una búsqueda (lee e indexa páginas): hasta ~35 s en el peor caso. Una página leída en
  la última semana no se vuelve a leer.
- Cada `research` hace una llamada corta más al modelo de chat (la GPU0), unos segundos.
- Algunos sitios rechazan al lector (HTTP 403); no se disfraza de navegador: se lee el siguiente candidato.
- Un reranker dedicado en la Z440 reemplazaría al juez si su latencia o su costo en la GPU0 molestan.

**Actualización 2026-10-26: ronda correctiva.** Si el juez califica `weak` o `none` y la primera ronda tardó menos de
20 s, `research` lee hasta 3 páginas más (con 3 de repuesto) de **sitios que todavía no leyó**, vuelve a rankear los
fragmentos de todo lo leído y vuelve a juzgar. Motivo: con evidencia parcial el modelo completa lo que falta con lo que
sabe (el caso de "Ford usa 29 bits 18DA", atribuido a una fuente que mostraba 11 bits); darle más web es mejor que
dejarle el hueco. La respuesta trae `rounds` (1 o 2). El tiempo de espera del cliente sube de 35 a 60 s. Probado en
vivo: un caso solo en español pasó por 2 rondas (6 páginas, 22,8 s) y terminó en `none`; los dos casos con consulta
en inglés salieron `good` en la primera ronda (5 y 12 s). Tests: 4 nuevos (encuentra en la segunda ronda, solo lee
otros sitios, una primera ronda buena no lee más, una primera ronda lenta se salta la segunda).
