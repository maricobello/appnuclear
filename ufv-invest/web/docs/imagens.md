# Imagens do site — onde entram e como gerar

Kit de prompts auditados para o FLUX.1 Krea (https://huggingface.co/spaces/mcp-tools/FLUX.1-Krea-dev).
Cada imagem tem um lugar definido no site, um formato e uma área livre para o texto. O prompt fica em
inglês porque o gerador rende melhor assim.

## Já no ar

| Imagem | Onde | Arquivo |
| --- | --- | --- |
| Pôr do sol aéreo (enviada em 10/10/2026) | Fundo da landing, topo da vitrine `/usinas`, imagem de compartilhamento | `src/assets/lp/hero.jpg`, `public/og.jpg` |
| Versão bem desfocada da mesma foto | Cards e galeria das usinas sem foto real | `public/images/ilustrativa/usina-desfocada.jpg` |

## Regras aplicadas em todos os prompts (auditoria)

1. **Mesmo "look" da foto da landing**: luz dourada ou azul de fim de tarde, realces âmbar e sombras
   verde-azuladas, cor natural. O site parece uma única sessão de fotos.
2. **Brasil reconhecível**: cerrado, estrada de terra vermelha, Minas Gerais. Combina com as usinas do
   catálogo (MG, BA, PE).
3. **Espaço livre onde vai o texto**, descrito "em positivo" ("metade de cima é céu calmo"). O gerador
   entende mal pedidos do tipo "sem X".
4. **Escala honesta**: perto das ofertas não entram usinas gigantes (as do catálogo têm 1–4 MWp). Ali só
   detalhe, close ou abstrato, que não podem ser confundidos com a usina ofertada.
5. **Pessoas só de costas e pequenas**: evita rosto e mão deformados e o uso da imagem de alguém real.
6. **Nada que vire letra**: sem placas, logotipos ou telas ligadas (a IA escreve garrancho).
7. **Até 70 palavras, com câmera e lente**: é o formato em que o FLUX Krea entrega foto mais realista.

## Critérios de reprovação (confiro em cada imagem antes de subir)

- Fileiras tortas, derretidas ou se fundindo; painel flutuando sem suporte.
- Dois sóis, ou sombras para lados diferentes do sol.
- Qualquer letra, logotipo ou marca d'água (inclusive no colete do técnico).
- Pessoa com rosto, mão ou corpo deformado.
- Horizonte torto; cara de "HDR" exagerado.
- Área do texto poluída (o título precisa ler bem no celular).

## Configuração no gerador

`width` e `height` como indicado em cada item, `guidance_scale` 4.5 e `num_inference_steps` 28.
Gere 3 ou 4 de cada e mande as melhores com o número do item no nome (ex.: `2a-ambar.png`).

---

## 1. Landing no celular (vertical) — prioridade alta

- **Onde**: fundo da landing em telas verticais. Hoje o celular usa um recorte da foto horizontal.
- **Por quê**: a maior parte do tráfego no Brasil é celular; uma foto vertical põe o céu atrás do título.
- **Formato**: 768 × 1344. **Área livre**: metade de cima (selo, título e botão).

```
Vertical cinematic aerial photograph of a solar farm in rural Minas Gerais at golden hour. Upper half: soft sunset sky and hazy rolling hills, low sun near the upper right edge. Lower half: rows of photovoltaic panels on trackers leading to the horizon, warm amber glints on the glass, red laterite dirt road. 24mm lens, natural colors, editorial color grade, ultra realistic
```

## 2. Cards e galeria sem foto real — prioridade alta (3 imagens)

- **Onde**: capa dos cards da vitrine e da galeria de cada usina, até chegar a foto real dela.
- **Por quê**: hoje os cards repetem a mesma foto desfocada. Imagens de detalhe deixam a vitrine premium e
  não mostram uma usina inteira, então não se passam pela usina ofertada.
- **Formato**: 1280 × 800. **Área livre**: terço de baixo mais escuro (o nome da usina fica ali).

**2a. Âmbar (macro)**
```
Macro photograph of a monocrystalline solar panel surface at golden hour, fine silver cell lines in sharp focus, a warm amber sun reflection sweeping across the glass, shallow depth of field with soft bokeh, tiny dew droplets, darker lower third, 100mm macro lens at f/2.8, natural colors, deep teal shadows, editorial product photography, ultra realistic
```

**2b. Crepúsculo (silhueta)**
```
Low-angle photograph of a single row of solar panels on a tracker, silhouetted against a glowing orange and violet dusk sky, sun just below the horizon, delicate rim light on the aluminum frame, out-of-focus cerrado grass in the foreground, darker lower third, large clean sky, 35mm lens at f/4, calm cinematic mood, natural colors, ultra realistic
```

**2c. Névoa (manhã)**
```
Eye-level photograph of a few rows of solar panels at sunrise with low morning mist drifting between them, soft pink and gold light, dew on the glass, cerrado trees fading into the fog behind, quiet minimal composition, darker lower third, 50mm lens at f/2.8, shallow depth of field, natural colors, editorial documentary photography, ultra realistic
```

## 3. Sobre nós — cartão "Ativos reais… analisados com dados abertos" — prioridade média

- **Onde**: fundo do cartão à direita do texto de apresentação.
- **Por quê**: é a página que mais pesa na confiança institucional e hoje é só texto. A vista de cima,
  geométrica, transmite precisão e dados.
- **Formato**: 1280 × 960. **Área livre**: canto superior esquerdo, uniforme e escuro.

```
Top-down drone photograph looking straight down at parallel rows of dark blue solar panels forming a precise geometric pattern, a single red laterite dirt road cutting diagonally through the lower right, thin strips of green grass between rows, long soft late-afternoon shadows, darker and uniform upper left area, minimalist abstract composition, natural colors, editorial architecture photography, ultra realistic
```

## 4. Como funciona — coluna da direita — prioridade média

- **Onde**: abaixo do cartão "Dúvidas?", hoje um espaço vazio no desktop.
- **Por quê**: mostra que existe equipe de operação cuidando do ativo, sem rosto.
- **Formato**: 1024 × 1280. **Área livre**: terço de cima (céu).

```
Vertical photograph of a solar maintenance technician seen from behind, wearing a white hard hat and high-visibility vest, walking away along a row of solar panels at sunrise, small figure in the lower third, rugged tablet held at the side, warm low sunlight and long shadows, soft haze over the cerrado, calm open sky above, 85mm lens at f/2.8, natural colors, documentary editorial photography, ultra realistic
```

## 5. Página não encontrada (404) — prioridade baixa

- **Onde**: fundo da página de erro 404.
- **Por quê**: transforma um erro em detalhe de marca (a usina à noite: "aqui o sol já se pôs").
- **Formato**: 1344 × 768. **Área livre**: centro (título e botão).

```
Wide photograph of a solar farm at night under a clear starry sky, the Milky Way arching across the upper half, panels faintly reflecting cool moonlight in the lower third, deep blue and black tones, a thin warm glow on the far horizon, calm empty center, long exposure, 20mm lens at f/1.8, tranquil astrophotography, natural colors, ultra realistic
```

## 6. Vídeo da landing (opcional)

- **Onde**: fundo da landing no desktop, por cima da foto atual.
- **Como gerar**: Space "Wan 2.2 image-to-video" (https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster),
  usando a foto atual da landing como primeiro quadro.
- **Regras de desempenho**: 5–6 s, 1280 × 720, até 3 MB, sem som, em loop, com a foto como capa. Só carrega
  no desktop, com boa conexão e sem "reduzir movimento" ativado.

```
Slow cinematic drone push-in gliding forward over the solar panel rows at golden hour, sunlight glints sliding gently across the glass, light haze drifting, steady stabilized camera, no cuts, realistic motion
```

## Onde não entra imagem

Simulador, investir, portfólio, transações, documentos, perfil, segurança e verificar relatório: são telas
de decisão e de números; imagem ali só distrai.

## Cuidados

- Toda imagem de IA que mostra usina leva "Imagem ilustrativa" (a landing já leva no rodapé).
- Quando houver foto real de uma usina, ela substitui a ilustrativa nos cards e na galeria
  (`public/images/usinas/<slug>/`, ver `public/images/README.md`).
- Antes de ir para produção definitiva, confirmar que a ferramenta usada permite uso comercial das imagens.
