<template>
  <Layout>
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="section-header px-6 py-4 mb-4 shadow-sm">
        <div>
          <h2 class="text-2xl font-bold">Logs da API</h2>
          <p class="text-textSecondary">Visualize os logs de requisições da API</p>
        </div>
      </div>

      <!-- Filtros -->
      <div class="glass-panel px-6 py-4 border-b border-borderColor/60 rounded-2xl shadow-sm mb-4">
        <div class="grid grid-cols-5 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">Endpoint</label>
            <input
              v-model="filters.endpoint"
              type="text"
              placeholder="Buscar endpoint..."
              class="input-soft w-full px-4 py-3"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Método</label>
            <select v-model="filters.method" class="form-control w-full">
              <option value="">Todos</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Status Code</label>
            <input
              v-model="filters.statusCode"
              type="number"
              placeholder="Ex: 200"
              class="input-soft w-full px-4 py-3"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Data Inicial</label>
            <input v-model="filters.startDate" type="date" class="form-control w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Data Final</label>
            <input v-model="filters.endDate" type="date" class="form-control w-full" />
          </div>
        </div>
        <div class="mt-4">
          <button @click="loadLogs" class="btn-primary px-4 py-2">
            <i class="fas fa-search mr-2"></i>
            Buscar
          </button>
          <button @click="clearFilters" class="btn-secondary px-4 py-2 ml-2">
            Limpar Filtros
          </button>
        </div>
      </div>

      <!-- Tabela -->
      <div class="flex-1 overflow-auto p-6">
        <div class="glass-panel rounded-2xl shadow-lg overflow-hidden">
          <table class="w-full data-table">
            <thead class="bg-gray-50 border-b border-borderColor/60">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">ID</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Endpoint</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Método</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Status</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">IP</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Data</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody class="bg-white/90 divide-y divide-borderColor/60">
              <tr v-for="log in logs" :key="log.id" class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary">{{ log.id }}</td>
                <td class="px-6 py-4 text-sm text-textPrimary">{{ log.endpoint }}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 rounded text-xs font-medium',
                    log.method === 'GET' ? 'bg-blue-100 text-blue-800' :
                    log.method === 'POST' ? 'bg-green-100 text-green-800' :
                    log.method === 'PATCH' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  ]">
                    {{ log.method }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 rounded-full text-xs font-medium',
                    log.statusCode >= 200 && log.statusCode < 300 ? 'bg-success bg-opacity-20 text-success' :
                    log.statusCode >= 400 ? 'bg-error bg-opacity-20 text-error' :
                    'bg-warning bg-opacity-20 text-warning'
                  ]">
                    {{ log.statusCode }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary">{{ log.ipAddress || '-' }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary">
                  {{ formatDate(log.createdAt) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    @click="viewLog(log)"
                    class="text-primary hover:text-secondary"
                  >
                    <i class="fas fa-eye"></i>
                  </button>
                </td>
              </tr>

              <tr v-if="logs.length === 0 && !loading">
                <td colspan="7" class="px-6 py-8 text-center text-textSecondary">
                  <i class="fas fa-inbox text-4xl mb-2 opacity-30"></i>
                  <p>Nenhum log encontrado</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Layout>

  <!-- Modal de Detalhes -->
  <div v-if="showLogModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4 overflow-y-auto py-8">
    <div class="modal-card p-6 w-full max-w-4xl my-8">
      <h3 class="text-xl font-bold mb-4">Detalhes do Log</h3>
      
      <div v-if="selectedLog" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">ID</label>
            <div class="input-soft px-4 py-2">{{ selectedLog.id }}</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Status Code</label>
            <div class="input-soft px-4 py-2">{{ selectedLog.statusCode }}</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Endpoint</label>
            <div class="input-soft px-4 py-2">{{ selectedLog.endpoint }}</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Método</label>
            <div class="input-soft px-4 py-2">{{ selectedLog.method }}</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">IP Address</label>
            <div class="input-soft px-4 py-2">{{ selectedLog.ipAddress || '-' }}</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Data</label>
            <div class="input-soft px-4 py-2">{{ formatDate(selectedLog.createdAt) }}</div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Request Payload</label>
          <pre class="bg-gray-100 p-4 rounded text-xs overflow-auto max-h-64">{{ formatJSON(selectedLog.requestPayload) }}</pre>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Response Payload</label>
          <pre class="bg-gray-100 p-4 rounded text-xs overflow-auto max-h-64">{{ formatJSON(selectedLog.responsePayload) }}</pre>
        </div>

        <div v-if="selectedLog.userAgent">
          <label class="block text-sm font-medium mb-2">User Agent</label>
          <div class="input-soft px-4 py-2 text-xs">{{ selectedLog.userAgent }}</div>
        </div>
      </div>

      <div class="flex justify-end mt-6">
        <button @click="showLogModal = false" class="btn-secondary px-4 py-2">
          Fechar
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Layout from '../components/layout/Layout.vue'
import api from '../services/api'

const logs = ref([])
const loading = ref(false)
const showLogModal = ref(false)
const selectedLog = ref(null)

const filters = ref({
  endpoint: '',
  method: '',
  statusCode: null,
  startDate: '',
  endDate: '',
})

onMounted(() => {
  loadLogs()
})

const loadLogs = async () => {
  loading.value = true
  try {
    const params = {}
    if (filters.value.endpoint) params.endpoint = filters.value.endpoint
    if (filters.value.method) params.method = filters.value.method
    if (filters.value.statusCode) params.statusCode = parseInt(filters.value.statusCode)
    if (filters.value.startDate) params.startDate = filters.value.startDate
    if (filters.value.endDate) params.endDate = filters.value.endDate

    const response = await api.get('/api-logs', { params })
    logs.value = response.data
  } catch (error) {
    alert('Erro ao carregar logs: ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

const clearFilters = () => {
  filters.value = {
    endpoint: '',
    method: '',
    statusCode: null,
    startDate: '',
    endDate: '',
  }
  loadLogs()
}

const viewLog = async (log) => {
  try {
    const response = await api.get(`/api-logs/${log.id}`)
    selectedLog.value = response.data
    showLogModal.value = true
  } catch (error) {
    alert('Erro ao carregar detalhes do log')
  }
}

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString('pt-BR')
}

const formatJSON = (str) => {
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str
    return JSON.stringify(parsed, null, 2)
  } catch {
    return str || '-'
  }
}
</script>

