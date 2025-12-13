<template>
  <Layout>
    <div class="flex-1 overflow-hidden flex gap-4 xl:gap-6 px-2 md:px-0 flex-col lg:flex-row fade-in-up">
      <!-- Lista de conversas -->
      <div class="w-full lg:w-80 glass-panel rounded-2xl overflow-hidden flex flex-col shadow-lg">
        <div class="p-4 border-b border-borderColor/60">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold">Atendimentos</h3>
            <button
              @click="showNewChatModal = true"
              class="w-9 h-9 btn-primary flex items-center justify-center text-sm"
            >
              <i class="fas fa-plus text-sm"></i>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin">
          <div
            v-for="conv in conversationsStore.activeConversations"
            :key="conv.contactPhone"
            @click="selectConversation(conv)"
            :class="[
              'chat-item p-4 border-b border-borderColor/60 cursor-pointer transition-colors',
              currentConversation?.contactPhone === conv.contactPhone ? 'chat-item-active' : ''
            ]"
          >
            <div class="flex items-start space-x-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
                <span class="font-bold text-white text-sm">{{ conv.contactName?.charAt(0).toUpperCase() }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h4 class="font-semibold truncate">{{ conv.contactName }}</h4>
                  <span class="text-xs text-textSecondary">{{ formatTime(conv.datetime) }}</span>
                </div>
                <p class="text-sm text-textSecondary truncate flex items-center space-x-1">
                  <i v-if="conv.sender === 'operator'" class="fas fa-arrow-right text-xs"></i>
                  <i v-else class="fas fa-arrow-left text-xs"></i>
                  <span>{{ conv.message }}</span>
                </p>
              </div>
            </div>
          </div>

          <div v-if="conversationsStore.activeConversations.length === 0" class="p-8 text-center text-textSecondary">
            <i class="fas fa-inbox text-4xl mb-4 opacity-50"></i>
            <p>Nenhuma conversa ativa</p>
          </div>
        </div>
      </div>

      <!-- Área de conversa -->
      <div v-if="currentConversation" class="flex-1 flex flex-col overflow-hidden glass-panel rounded-2xl shadow-lg">
        <!-- Header da conversa -->
        <div class="bg-white/80 backdrop-blur border-b border-borderColor/60 p-4 sticky top-0 z-10">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <span class="font-bold text-white text-sm">{{ currentConversation.contactName?.charAt(0).toUpperCase() }}</span>
              </div>
              <div>
                <h3 class="font-bold">{{ currentConversation.contactName }}</h3>
                <p class="text-xs text-textSecondary">{{ currentConversation.contactPhone }}</p>
              </div>
            </div>

            <!-- Dropdown de tabulações -->
            <div class="relative">
              <select
                v-model="selectedTabulation"
                @change="handleTabulation"
                class="input-soft px-4 py-2"
              >
                <option value="">Tabular conversa</option>
                <option v-for="tab in tabulations" :key="tab.id" :value="tab.id">
                  {{ tab.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Histórico da conversa -->
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 bg-gray-50 scrollbar-thin">
          <div class="space-y-4">
            <div
              v-for="message in conversationsStore.messages"
              :key="message.id"
              :class="[
                'flex items-start space-x-3',
                message.sender === 'operator' ? 'justify-end' : 'justify-start'
              ]"
            >
              <div
                v-if="message.sender === 'contact'"
                class="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0"
              >
                <span class="font-bold text-white text-xs">{{ currentConversation.contactName?.charAt(0).toUpperCase() }}</span>
              </div>

              <div
                :class="[
                  'chat-bubble rounded-2xl p-4 max-w-xl shadow-sm',
                  message.sender === 'operator'
                    ? 'bg-primary text-white rounded-tr-none'
                    : 'bg-white border border-borderColor rounded-tl-none'
                ]"
              >
                <p class="text-sm">{{ message.message }}</p>
                <span :class="['text-xs mt-2 block', message.sender === 'operator' ? 'text-gray-300' : 'text-textSecondary']">
                  {{ formatTime(message.datetime) }}
                </span>
              </div>

              <div
                v-if="message.sender === 'operator'"
                class="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0"
              >
                <span class="font-bold text-white text-xs">{{ authStore.user?.name?.charAt(0).toUpperCase() }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Área de entrada de mensagem -->
        <div class="bg-white/85 backdrop-blur border-t border-borderColor/60 p-4">
          <div v-if="useTemplate" class="mb-3 p-3 bg-primary/10 rounded-lg">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium">Enviando Template</span>
              <button @click="useTemplate = false" class="text-xs text-primary hover:underline">
                Cancelar
              </button>
            </div>
            <select v-model="selectedTemplate" class="form-control w-full mb-2">
              <option value="">Selecione um template</option>
              <option v-for="template in availableTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </select>
            <div v-if="selectedTemplateObj && selectedTemplateObj.variables && selectedTemplateObj.variables.length > 0" class="space-y-2">
              <div v-for="(varName, index) in selectedTemplateObj.variables" :key="index" class="flex items-center space-x-2">
                <label class="text-xs w-24">{{ varName }}:</label>
                <input
                  v-model="templateVariables[varName]"
                  type="text"
                  class="input-soft flex-1 px-3 py-1 text-sm"
                  :placeholder="`Valor para ${varName}`"
                />
              </div>
            </div>
          </div>
          
          <form @submit.prevent="sendMessage" class="flex items-center space-x-3">
            <button
              type="button"
              @click="toggleTemplateMode"
              class="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              :class="{ 'bg-primary text-white': useTemplate }"
            >
              <i class="fas fa-file-alt text-textSecondary" :class="{ 'text-white': useTemplate }"></i>
            </button>

            <div class="flex-1 relative">
              <input
                v-model="messageText"
                type="text"
                :placeholder="useTemplate ? 'Use o template acima...' : 'Digite sua mensagem...'"
                class="input-soft w-full px-4 py-3"
                :disabled="useTemplate"
              />
            </div>

            <button
              type="submit"
              :disabled="useTemplate ? !selectedTemplate : !messageText.trim()"
              class="btn-primary px-5 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i :class="useTemplate ? 'fas fa-paper-plane' : 'fas fa-paper-plane'"></i>
            </button>
          </form>
        </div>
      </div>

      <!-- Mensagem quando não há conversa selecionada -->
      <div v-else class="flex-1 flex items-center justify-center bg-gray-50">
        <div class="text-center text-textSecondary">
          <i class="fas fa-comments text-6xl mb-4 opacity-30"></i>
          <p class="text-lg">Selecione uma conversa para começar</p>
        </div>
      </div>
    </div>

    <!-- Modal para nova conversa 1x1 -->
    <div v-if="showNewChatModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
      <div class="glass-panel rounded-2xl p-6 w-full max-w-md">
        <h3 class="text-xl font-bold mb-4">Nova Conversa</h3>
        <form @submit.prevent="startNewChat" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-textPrimary mb-2">Nome</label>
            <input
              v-model="newChat.name"
              type="text"
              required
              class="input-soft w-full px-4 py-3"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textPrimary mb-2">Telefone</label>
            <input
              v-model="newChat.phone"
              type="text"
              required
              class="input-soft w-full px-4 py-3"
              placeholder="5511999999999"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textPrimary mb-2">CPF</label>
            <input
              v-model="newChat.cpf"
              type="text"
              class="input-soft w-full px-4 py-3"
            />
          </div>
          <div class="flex space-x-3">
            <button
              type="button"
              @click="showNewChatModal = false"
              class="flex-1 px-4 py-3 btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="flex-1 btn-primary text-center"
            >
              Iniciar Conversa
            </button>
          </div>
        </form>
      </div>
    </div>
  </Layout>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useConversationsStore } from '../stores/conversations'
import Layout from '../components/layout/Layout.vue'
import api from '../services/api'

const authStore = useAuthStore()
const conversationsStore = useConversationsStore()

const currentConversation = ref(null)
const messageText = ref('')
const selectedTabulation = ref('')
const tabulations = ref([])
const showNewChatModal = ref(false)
const messagesContainer = ref(null)
const useTemplate = ref(false)
const selectedTemplate = ref(null)
const availableTemplates = ref([])
const templateVariables = ref({})

const newChat = ref({
  name: '',
  phone: '',
  cpf: '',
})

onMounted(async () => {
  // Inicializar listeners do Socket
  conversationsStore.initializeSocketListeners()

  // Buscar conversas ativas
  await conversationsStore.fetchActiveConversations()

  // Buscar tabulações
  const tabResponse = await api.get('/tabulations')
  tabulations.value = tabResponse.data

  // Buscar templates disponíveis
  await loadTemplates()
})

const selectConversation = async (conv) => {
  currentConversation.value = conv
  conversationsStore.setCurrentConversation(conv)
  await nextTick()
  scrollToBottom()
}

const loadTemplates = async () => {
  try {
    const response = await api.get('/templates', { params: { status: 'APPROVED' } })
    availableTemplates.value = response.data
  } catch (error) {
    console.error('Erro ao carregar templates:', error)
  }
}

const toggleTemplateMode = () => {
  useTemplate.value = !useTemplate.value
  if (!useTemplate.value) {
    selectedTemplate.value = null
    templateVariables.value = {}
  }
}

const selectedTemplateObj = computed(() => {
  if (!selectedTemplate.value) return null
  return availableTemplates.value.find(t => t.id === selectedTemplate.value)
})

const sendMessage = async () => {
  if (!currentConversation.value) return

  try {
    if (useTemplate.value && selectedTemplate.value) {
      // Enviar template
      const variables = selectedTemplateObj.value?.variables?.map(varName => ({
        key: varName,
        value: templateVariables.value[varName] || '',
      })) || []

      await api.post('/templates/send', {
        templateId: selectedTemplate.value,
        phone: currentConversation.value.contactPhone,
        contactName: currentConversation.value.contactName,
        variables: variables,
        lineId: authStore.user?.line,
      })

      // Resetar template
      useTemplate.value = false
      selectedTemplate.value = null
      templateVariables.value = {}
      
      // Recarregar conversas
      await conversationsStore.fetchActiveConversations()
    } else {
      // Enviar mensagem normal
      if (!messageText.value.trim()) return

      await conversationsStore.sendMessage(
        currentConversation.value.contactPhone,
        messageText.value
      )

      messageText.value = ''
    }

    await nextTick()
    scrollToBottom()
  } catch (error) {
    alert('Erro ao enviar mensagem: ' + (error.response?.data?.message || error.message))
  }
}

const handleTabulation = async () => {
  if (!selectedTabulation.value || !currentConversation.value) return

  if (confirm('Deseja realmente tabular e finalizar esta conversa?')) {
    await conversationsStore.tabulateConversation(
      currentConversation.value.contactPhone,
      selectedTabulation.value
    )
    currentConversation.value = null
    selectedTabulation.value = ''
  }
}

const startNewChat = async () => {
  try {
    // Criar contato
    await api.post('/contacts', {
      name: newChat.value.name,
      phone: newChat.value.phone,
      cpf: newChat.value.cpf,
      segment: authStore.user.segment,
    })

    // Criar primeira mensagem
    await api.post('/conversations', {
      contactName: newChat.value.name,
      contactPhone: newChat.value.phone,
      segment: authStore.user.segment,
      userName: authStore.user.name,
      userLine: authStore.user.line,
      message: 'Conversa iniciada',
      sender: 'operator',
    })

    // Recarregar conversas
    await conversationsStore.fetchActiveConversations()

    // Fechar modal
    showNewChatModal.value = false
    newChat.value = { name: '', phone: '', cpf: '' }
  } catch (error) {
    alert('Erro ao iniciar conversa')
  }
}

const formatTime = (datetime) => {
  if (!datetime) return ''
  const date = new Date(datetime)
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

watch(
  () => conversationsStore.messages.length,
  () => {
    nextTick(() => scrollToBottom())
  }
)
</script>
