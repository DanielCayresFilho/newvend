<template>
  <Layout>
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-white border-b border-borderColor px-6 py-4">
        <h2 class="text-2xl font-bold">Campanhas</h2>
        <p class="text-textSecondary">Crie e gerencie campanhas de envio em massa</p>
      </div>

      <!-- Formulário de Nova Campanha -->
      <div class="p-6 glass-panel rounded-2xl shadow-sm border border-borderColor/60">
        <form @submit.prevent="createCampaign" class="space-y-4">
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium mb-2">Nome da Campanha</label>
              <input
                v-model="form.name"
                type="text"
                required
                class="form-control w-full"
                placeholder="Campanha de Natal"
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-2">Segmento</label>
              <select
                v-model="form.segment"
                required
                class="form-control w-full"
              >
                <option value="">Selecione</option>
                <option v-for="seg in segments" :key="seg.id" :value="seg.id">{{ seg.name }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium mb-2">Velocidade</label>
              <select
                v-model="form.speed"
                required
                class="form-control w-full"
              >
                <option value="fast">Rápida (3 min)</option>
                <option value="medium">Média (6 min)</option>
                <option value="slow">Lenta (10 min)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">Mensagem (opcional)</label>
            <textarea
              v-model="form.message"
              rows="3"
              class="form-control w-full"
              placeholder="Digite a mensagem que será enviada para todos os contatos..."
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">Deixe em branco se for usar template</p>
          </div>

          <div class="p-4 bg-primary/5 rounded-lg border border-primary/20">
            <div class="flex items-center space-x-2 mb-3">
              <input
                v-model="form.useTemplate"
                type="checkbox"
                id="useTemplate"
                class="w-4 h-4"
              />
              <label for="useTemplate" class="text-sm font-medium">Usar Template (Para linhas oficiais)</label>
            </div>

            <div v-if="form.useTemplate" class="space-y-3">
              <div>
                <label class="block text-sm font-medium mb-2">Template</label>
                <select v-model="form.templateId" class="form-control w-full">
                  <option value="">Selecione um template</option>
                  <option v-for="template in templates" :key="template.id" :value="template.id">
                    {{ template.name }} ({{ template.status }})
                  </option>
                </select>
              </div>
              <div v-if="selectedTemplate && selectedTemplate.variables && selectedTemplate.variables.length > 0">
                <label class="block text-sm font-medium mb-2">Variáveis do Template</label>
                <p class="text-xs text-gray-500 mb-2">
                  As variáveis serão preenchidas automaticamente com dados do CSV, ou você pode definir valores padrão abaixo.
                  No CSV, adicione colunas com os nomes das variáveis: {{ selectedTemplate.variables.join(', ') }}
                </p>
              </div>
            </div>
          </div>

          <div class="flex items-center space-x-4">
            <div class="flex-1">
              <label class="block text-sm font-medium mb-2">Arquivo CSV</label>
              <input
                ref="fileInput"
                type="file"
                accept=".csv"
                @change="handleFileChange"
                class="form-control w-full"
              />
              <p class="text-xs text-textSecondary mt-1">Formato: name,phone</p>
            </div>

            <button
              type="submit"
              :disabled="!selectedFile || loading"
              class="mt-6 btn-primary px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              <i class="fas fa-paper-plane"></i>
              <span>{{ loading ? 'Enviando...' : 'Enviar Campanha' }}</span>
            </button>
          </div>

          <div v-if="uploadResult" class="p-4 bg-success bg-opacity-10 border border-success rounded-lg">
            <p class="text-success font-medium">
              <i class="fas fa-check-circle mr-2"></i>
              {{ uploadResult.message }}
            </p>
            <p class="text-sm text-textSecondary mt-2">
              Total de contatos: {{ uploadResult.totalContacts }} |
              Operadores online: {{ uploadResult.operators }} |
              Intervalo: {{ uploadResult.delayMinutes }} minutos
            </p>
          </div>
        </form>
      </div>

      <!-- Lista de Campanhas -->
      <div class="flex-1 overflow-auto p-6">
        <h3 class="text-lg font-bold mb-4">Campanhas Enviadas</h3>

        <div class="bg-white rounded-lg shadow-sm overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-borderColor">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase">Nome</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase">Segmento</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase">Velocidade</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase">Data</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-textSecondary uppercase">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-borderColor">
              <tr v-for="campaign in campaigns" :key="campaign.id" class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="font-medium">{{ campaign.name }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  {{ campaign.segmentRelation?.name || '-' }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 rounded-full text-xs font-medium',
                    campaign.speed === 'fast' ? 'bg-error bg-opacity-20 text-error' :
                    campaign.speed === 'medium' ? 'bg-warning bg-opacity-20 text-warning' :
                    'bg-success bg-opacity-20 text-success'
                  ]">
                    {{ speedLabels[campaign.speed] }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textSecondary">
                  {{ formatDate(campaign.createdAt) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    @click="viewStats(campaign)"
                    class="text-primary hover:text-secondary mr-3"
                  >
                    <i class="fas fa-chart-bar"></i>
                  </button>
                  <button
                    @click="deleteCampaign(campaign)"
                    class="text-error hover:text-red-700"
                  >
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>

              <tr v-if="campaigns.length === 0">
                <td colspan="5" class="px-6 py-8 text-center text-textSecondary">
                  <i class="fas fa-bullhorn text-4xl mb-2 opacity-30"></i>
                  <p>Nenhuma campanha criada</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Layout>

  <!-- Modal de Estatísticas -->
  <div v-if="showStatsModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
    <div class="modal-card p-6 w-full max-w-md">
      <h3 class="text-xl font-bold mb-4">Estatísticas - {{ selectedCampaign?.name }}</h3>

      <div v-if="stats" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-primary bg-opacity-10 rounded-lg">
            <p class="text-sm text-textSecondary">Total</p>
            <p class="text-2xl font-bold text-primary">{{ stats.total }}</p>
          </div>
          <div class="p-4 bg-success bg-opacity-10 rounded-lg">
            <p class="text-sm text-textSecondary">Enviados</p>
            <p class="text-2xl font-bold text-success">{{ stats.sent }}</p>
          </div>
          <div class="p-4 bg-error bg-opacity-10 rounded-lg">
            <p class="text-sm text-textSecondary">Falhas</p>
            <p class="text-2xl font-bold text-error">{{ stats.failed }}</p>
          </div>
          <div class="p-4 bg-warning bg-opacity-10 rounded-lg">
            <p class="text-sm text-textSecondary">Taxa de Sucesso</p>
            <p class="text-2xl font-bold text-warning">{{ stats.successRate }}%</p>
          </div>
        </div>
      </div>

      <button
        @click="showStatsModal = false"
        class="w-full mt-4 btn-secondary"
      >
        Fechar
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import Layout from '../components/layout/Layout.vue'
import api from '../services/api'

const segments = ref([])
const campaigns = ref([])
const templates = ref([])
const selectedFile = ref(null)
const fileInput = ref(null)
const loading = ref(false)
const uploadResult = ref(null)
const showStatsModal = ref(false)
const selectedCampaign = ref(null)
const stats = ref(null)

const form = ref({
  name: '',
  segment: '',
  speed: 'medium',
  message: '',
  useTemplate: false,
  templateId: null,
})

const speedLabels = {
  fast: 'Rápida',
  medium: 'Média',
  slow: 'Lenta',
}

const selectedTemplate = computed(() => {
  if (!form.value.templateId) return null
  return templates.value.find(t => t.id === form.value.templateId)
})

onMounted(async () => {
  const [segResponse, campResponse, templatesResponse] = await Promise.all([
    api.get('/segments'),
    api.get('/campaigns'),
    api.get('/templates', { params: { status: 'APPROVED' } })
  ])
  segments.value = segResponse.data
  campaigns.value = campResponse.data
  templates.value = templatesResponse.data
})

const handleFileChange = (event) => {
  selectedFile.value = event.target.files[0]
}

const createCampaign = async () => {
  if (!selectedFile.value) {
    alert('Selecione um arquivo CSV')
    return
  }

  loading.value = true
  uploadResult.value = null

  try {
    // Criar campanha
    const campaignResponse = await api.post('/campaigns', {
      name: form.value.name,
      segment: form.value.segment,
      speed: form.value.speed,
    })

    // Upload do CSV
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    if (form.value.message) {
      formData.append('message', form.value.message)
    }
    if (form.value.useTemplate && form.value.templateId) {
      formData.append('useTemplate', 'true')
      formData.append('templateId', form.value.templateId.toString())
    }

    const uploadResponse = await api.post(
      `/campaigns/${campaignResponse.data.id}/upload`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )

    uploadResult.value = uploadResponse.data

    // Resetar formulário
    form.value = {
      name: '',
      segment: '',
      speed: 'medium',
      message: '',
      useTemplate: false,
      templateId: null,
    }
    selectedFile.value = null
    if (fileInput.value) {
      fileInput.value.value = ''
    }

    // Recarregar campanhas
    const campResponse = await api.get('/campaigns')
    campaigns.value = campResponse.data
  } catch (error) {
    alert('Erro ao criar campanha: ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

const viewStats = async (campaign) => {
  selectedCampaign.value = campaign
  showStatsModal.value = true

  try {
    const response = await api.get(`/campaigns/stats/${campaign.name}`)
    stats.value = response.data
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error)
  }
}

const deleteCampaign = async (campaign) => {
  if (confirm('Deseja realmente excluir esta campanha?')) {
    await api.delete(`/campaigns/${campaign.id}`)
    const response = await api.get('/campaigns')
    campaigns.value = response.data
  }
}

const formatDate = (date) => {
  return new Date(date).toLocaleString('pt-BR')
}
</script>
