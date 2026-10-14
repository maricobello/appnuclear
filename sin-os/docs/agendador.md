# Agendador externo (alertas a cada 15 min) — passo a passo

O GitHub atrasa agendamentos em repositórios com pouca atividade (na prática roda a cada algumas horas) e
o plano gratuito da Vercel só agenda uma vez por dia. Um agendador externo gratuito resolve: ele chama o
app a cada 15 minutos e o app envia os avisos (PLD publicado, pico, descolamento, janela de bateria, corte de
renováveis) para o seu celular pelo ntfy. Cada aviso sai uma vez só.

Tempo: 5 minutos. Custo: zero.

## 1. Criar a conta

Abra <https://console.cron-job.org/signup>, crie a conta e confirme o e-mail.

## 2. Criar a tarefa

1. Em <https://console.cron-job.org/jobs>, clique em **Create cronjob**.
2. **Title:** `SIN OS alertas`
3. **URL:** `https://sinos-iota.vercel.app/api/alertas/run`
4. **Execution schedule:** *Every 15 minutes*.
5. Abra a aba **Advanced** e, em **Headers**, adicione:

   | Key | Value |
   |---|---|
   | `Authorization` | `Bearer ` + a sua `ADMIN_KEY` (a mesma da Vercel; com um espaço depois de `Bearer`) |

6. **Request method:** `GET`. Clique em **Create**.

## 3. Conferir

Na lista de tarefas, clique em **Test run**. A resposta deve ser algo como
`{"ok":true,"sent":{"pldPublicado":0,"mercado":0}}` (zero = nada novo para avisar agora).

| Resposta | O que fazer |
|---|---|
| `401 não autorizado` | O cabeçalho está errado: confira `Bearer ` + a chave, sem aspas. |
| `skipped: rodou há menos de 5 min` | Normal se você testou duas vezes seguidas. |

## Ajustar os limites (opcional)

Na Vercel (Settings → Environment Variables), em reais por MWh: `ALERT_PLD_MAX` (padrão 300),
`ALERT_SPREAD` (100), `ALERT_INTRADAY` (200); para o corte de renováveis, `ALERT_CURTAIL_FACTOR` (1,5) e
`ALERT_CURTAIL_MIN_GWH` (50). `MARKET_ALERTS=off` desliga os alertas de mercado. Depois de mudar, faça o
redeploy.
