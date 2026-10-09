# Fotos das usinas

Coloque as fotos reais de cada usina em `public/images/usinas/<slug>/` (JPG, PNG ou WebP,
idealmente 1600×900 ou maior). O `<slug>` é o identificador da usina na URL (coluna `slug`
da planilha ou o nome em minúsculas com hífens, ex.: `usina-horizonte-azul`).

Depois rode `npm run usinas:importar -- dados/usinas.xlsx`: o importador associa as fotos
(a primeira vira a capa; a ordem segue a coluna `fotos` da planilha ou a ordem alfabética).
Sem fotos, o site mostra um espaço reservado neutro.
