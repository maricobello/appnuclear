# Coletor do PLD oficial — passo a passo

O app mostra hoje um PLD **estimado** (a CCEE bloqueia servidores de nuvem, como a Vercel). O coletor roda no
**seu computador**, baixa o PLD **oficial** do portal de Dados Abertos da CCEE e envia para o app. Depois disso o
aviso "Fonte primária indisponível" some, aparece o selo **CCEE** e a Iara passa a usar o número oficial.

Tempo: uns 10 minutos. Custo: zero.

---

## Parte 1 — Cadastrar a chave na Vercel

**1. Gere uma chave.** Abra o PowerShell (tecla Windows, digite `powershell`) e rode:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

Ele imprime 40 letras e números. Copie o resultado (essa é a sua chave). Use só letras e números: símbolos como
`&`, `%` e `^` quebram o arquivo `.bat`. Não compartilhe a chave com ninguém nem cole em conversas.

**2. Abra as variáveis de ambiente do projeto:**
<https://vercel.com/maricobellos-projects/sinos/settings/environment-variables>

**3. Adicione a variável** (botão **Add Environment Variable** / "Adicionar"):

| Campo | Valor |
|---|---|
| Key | `PLD_INGEST_KEY` |
| Value | a chave do passo 1 |
| Environments | só **Production** |
| Sensitive | **ligado** |

Clique em **Save**.

**4. Faça o redeploy** (a variável só vale depois): me avise no chat que eu faço, ou na Vercel vá em
**Deployments**, abra o menu `⋯` do deploy mais recente (Production) e clique em **Redeploy**.

---

## Parte 2 — Rodar o coletor no seu PC (Windows)

**1. Instale o Node.js** (versão **LTS**): <https://nodejs.org>. Aceite as opções padrão.

**2. Crie uma pasta** (por exemplo `C:\coletor-pld`) e baixe os dois arquivos para dentro dela
(clique com o botão direito no link → **Salvar link como…**):

- <https://raw.githubusercontent.com/maricobello/sinos/main/scripts/coletor-ccee.mjs>
- <https://raw.githubusercontent.com/maricobello/sinos/main/scripts/coletor-ccee.bat>

Os dois são arquivos de texto, dá para abrir no Bloco de Notas e conferir o que fazem. Eles só leem a API
pública da CCEE (identificando-se como "SIN-OS-coletor") e enviam os registros para o seu app.

**3. Dê duplo clique em `coletor-ccee.bat`.**

- Se o Windows avisar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.
- Na primeira vez ele pede a chave: **cole a mesma chave da Vercel** e tecle Enter. Ela fica salva em
  `chave.txt` nessa pasta (não envie esse arquivo a ninguém).

**4. Deixe a janela aberta.** Ele coleta agora e depois a cada 60 minutos. Se fechar a janela ou desligar o PC,
o app continua funcionando com os últimos dias oficiais já recebidos e estima o resto.

**Deve aparecer algo como:**

```
[06/10/2026, 08:15:02] 960 registros · dias oficiais aceitos: 2026-09-27, ..., 2026-10-06 · novos gravados: 10
```

---

## Conferir se funcionou

1. <https://sinos-iota.vercel.app/api/pld/coletor> deve mostrar `"configurado": true` e os dias recentes com
   `"oficial": true`.
2. <https://sinos-iota.vercel.app/api/pld> deve mostrar `"oficial": true` em `fonte`.
3. No app, o aviso amarelo/laranja de fonte indisponível some e o selo **CCEE** aparece no PLD.

---

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| `Node.js não encontrado` | Instale o Node LTS (Parte 2, passo 1) e rode o `.bat` de novo. |
| `a CCEE bloqueou esta conexão também (HTTP 403)` | Sua internet também está bloqueada pelo portal. Use o **plano B** abaixo. O coletor não tenta disfarçar o acesso. |
| `SIN OS respondeu HTTP 401: chave do coletor inválida` | A chave do PC é diferente da da Vercel, ou o redeploy não foi feito. Apague `chave.txt` e rode de novo colando a chave certa. |
| `SIN OS respondeu HTTP 503: coletor desligado` | A variável não chegou no deploy: faça o redeploy (Parte 1, passo 4). |
| `chave.txt está vazio` | Apague o `chave.txt` e rode o `.bat` de novo. |

### Plano B — baixar o CSV pelo navegador (agora automático)

Se a CCEE bloquear a API, o coletor mostra o código do bloqueio (use no chamado) e **passa sozinho** para o plano B:
fica vigiando o arquivo `pld.csv` na pasta e envia sempre que ele aparecer ou mudar. Você só precisa baixar o CSV:

1. Abra <https://dadosabertos.ccee.org.br/dataset/pld_horario>, entre no recurso do ano atual e clique em **Baixar**.
2. Salve o arquivo na pasta do coletor com o nome **`pld.csv`**.
3. Deixe o `coletor-ccee.bat` aberto: ele envia o `pld.csv` (só as linhas mais recentes) assim que detectar o arquivo
   e de novo toda vez que você salvar um CSV novo por cima. É um download por dia, com 10 segundos de trabalho.

Se o navegador também mostrar "Acesso bloqueado", anote o **código do erro** e o **IP** que aparecem na página e
abra um chamado na CCEE (0800 591 4185) pedindo acesso programático ao PLD horário.

---

## macOS ou Linux

```bash
SIN_OS_URL=https://sinos-iota.vercel.app PLD_INGEST_KEY=sua-chave node coletor-ccee.mjs --loop 60
```

Para uma coleta só: tire o `--loop 60`. Para enviar um CSV baixado: `--csv pld.csv`.
