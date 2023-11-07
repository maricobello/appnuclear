import streamlit as st
from datetime import datetime, timedelta
import time

# Função para exibir mensagens de sucesso
def exibir_mensagens_sucesso():
    for i in range(1, 6):  # 5 mensagens de sucesso
        st.success(f"Processo {i}/5 de normalização concluído...")
        time.sleep(2)  # Intervalo de 2 segundos entre as mensagens
    st.session_state['normalizacao_completa'] = True  # Estado para mostrar o botão de próxima etapa

# Função para exibir mensagens de erro na usina nuclear a cada 10 segundos
def exibir_mensagens_erro(tempo_decorrido):
    erros = [
        (10, "ALERTA: Flutuações inesperadas na saída de energia!"),
        (20, "CRÍTICO: Vazamento de água pesada detectado no sistema primário!"),
        (30, "PERIGO: Falha no sistema de controle de reatividade!"),
        (40, "ERRO: Perda de coolanteno circuito secundário!"),
    ]
    for tempo, mensagem in erros:
        if tempo_decorrido >= tempo:
            st.error(mensagem)

# Inicializa variáveis de sessão
if 'start_time' not in st.session_state:
    st.session_state['start_time'] = datetime.now()

if 'senha_incorreta' not in st.session_state:
    st.session_state['senha_incorreta'] = False

if 'tentativas' not in st.session_state:
    st.session_state['tentativas'] = 0

if 'senha_correta' not in st.session_state:
    st.session_state['senha_correta'] = False

# Senha correta
senha_correta = "senha123"

# Configuração do aplicativo
st.set_page_config(page_title="Sala de Comando da Usina Nuclear", page_icon="☢️", layout="centered")
st.title("Sala de Comando da Usina Nuclear")

# Barra lateral com descrição do painel de controle
sidebar = st.sidebar
sidebar.title("Painel de Controle")
sidebar.image("https://img.freepik.com/fotos-premium/closeup-do-painel-de-controle-de-botoes-e-interruptores-da-usina-nuclear_191555-6467.jpg", use_column_width=True)
sidebar.write("Este é o painel de controle da usina nuclear. Você precisa inserir a senha correta para evitar um desastre nuclear.")

# Exibe a quantidade de tentativas restantes com destaque
tentativas_restantes = 5 - st.session_state.tentativas
sidebar.markdown(f"<h2 style='text-align: center; color: yellow;'>Tentativas restantes: {tentativas_restantes}</h2>", unsafe_allow_html=True)

# Calcula o tempo restante
tempo_passado = datetime.now() - st.session_state.start_time
tempo_restante = timedelta(minutes=10) - tempo_passado
segundos_restantes = int(tempo_restante.total_seconds())

# Display do contador
if segundos_restantes > 0 and not st.session_state.senha_incorreta:
    st.markdown(f"<h1 style='text-align: center; color: red;'>{tempo_restante // timedelta(minutes=1)}:{tempo_restante.seconds % 60:02d}</h1>", unsafe_allow_html=True)

# Formulário de senha
with st.form("senha_form"):
    senha_digitada = st.text_input("Digite a senha para resfriar o reator:", "")
    enviar_senha = st.form_submit_button("Enviar senha para o controle")

# Verificação da senha
if enviar_senha:
    if senha_digitada == senha_correta:
        st.session_state['senha_correta'] = True
        exibir_mensagens_sucesso()
    else:
        st.session_state.tentativas += 1
        if st.session_state.tentativas >= 5:
            st.session_state.senha_incorreta = True
            st.error("Você perdeu, o reator explodiu")
            st.image("https://i.imgur.com/7Elna2p.gif", use_column_width=True)
        else:
            st.warning(f"Senha incorreta. Você tem {tentativas_restantes} tentativas restantes.")

# Exibe mensagens de erro se a senha correta não foi inserida
if not st.session_state.get('senha_correta', False) and segundos_restantes > 0:
    exibir_mensagens_erro(tempo_passado.seconds)

# Botão para a próxima etapa após a normalização
if st.session_state.get('normalizacao_completa', False):
    if st.button("Próxima etapa", key="next_step"):
        st.markdown("<h1 style='text-align: center;'>MENSAGEM AQUI</h1>", unsafe_allow_html=True)

# Agendar a atualização do contador
if not st.session_state.senha_incorreta and segundos_restantes > 0 and not st.session_state.senha_correta:
    st.experimental_rerun()

# Se todas as tentativas forem esgotadas ou o tempo acabar, exibir "Você perdeu"
if st.session_state.senha_incorreta or segundos_restantes <= 0:
    st.session_state['end_game'] = True
    st.experimental_set_query_params(end_game="true")
    st.balloons()
    time.sleep(2)  # Pausa antes de redirecionar
    st.experimental_rerun()

# Redireciona para a tela de perda
if st.session_state.get('end_game', False):
    st.write("Você perdeu")
    st.image("https://i.imgur.com/7Elna2p.gif", use_column_width=True)
