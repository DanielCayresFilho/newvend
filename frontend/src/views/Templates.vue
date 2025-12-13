<template>
  <Layout>
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="section-header px-6 py-4 mb-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold">Templates</h2>
            <p class="text-textSecondary">Gerencie os templates do WhatsApp Cloud API</p>
          </div>
          <button
            @click="openModal()"
            class="btn-primary px-4 py-2 rounded-lg flex items-center space-x-2"
          >
            <i class="fas fa-plus"></i>
            <span>Novo Template</span>
          </button>
        </div>
      </div>

      <!-- Filtro -->
      <div class="glass-panel px-6 py-4 border-b border-borderColor/60 rounded-2xl shadow-sm mb-4">
        <div class="grid grid-cols-3 gap-4">
          <div class="relative">
            <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            <input
              v-model="search"
              type="text"
              placeholder="Buscar por nome..."
              class="input-soft w-full pl-10 pr-4 py-3"
            />
          </div>
          <div>
            <select v-model="filters.lineId" class="form-control w-full">
              <option :value="null">Todas as linhas</option>
              <option v-for="line in lines" :key="line.id" :value="line.id">
                {{ line.phone }}
              </option>
            </select>
          </div>
          <div>
            <select v-model="filters.status" class="form-control w-full">
              <option value="">Todos os status</option>
              <option value="PENDING">Pendente</option>
              <option value="SUBMITTED">Submetido</option>
              <option value="APPROVED">Aprovado</option>
              <option value="REJECTED">Rejeitado</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Tabela -->
      <div class="flex-1 overflow-auto p-6">
        <div class="glass-panel rounded-2xl shadow-lg overflow-hidden">
          <table class="w-full data-table">
            <thead class="bg-gray-50 border-b border-borderColor/60">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Nome</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Linha</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Categoria</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Status</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider">Corpo</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody class="bg-white/90 divide-y divide-borderColor/60">
              <tr v-for="item in templates" :key="item.id" class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary font-medium">{{ item.name }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary">{{ getLineName(item.lineId) }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-textPrimary">{{ item.category }}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 rounded-full text-xs font-medium',
                    item.status === 'APPROVED' ? 'bg-success bg-opacity-20 text-success' :
                    item.status === 'PENDING' ? 'bg-warning bg-opacity-20 text-warning' :
                    item.status === 'REJECTED' ? 'bg-error bg-opacity-20 text-error' :
                    'bg-gray-200 text-gray-600'
                  ]">
                    {{ item.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-textPrimary max-w-xs truncate">{{ item.bodyText }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                  <button
                    @click="openModal(item)"
                    class="text-primary hover:text-secondary"
                  >
                    <i class="fas fa-edit"></i>
                  </button>
                  <button
                    @click="deleteTemplate(item)"
                    class="text-error hover:text-red-700"
                  >
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>

              <tr v-if="templates.length === 0">
                <td colspan="6" class="px-6 py-8 text-center text-textSecondary">
                  <i class="fas fa-inbox text-4xl mb-2 opacity-30"></i>
                  <p>Nenhum template encontrado</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Layout>

  <!-- Modal -->
  <div v-if="showModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4 overflow-y-auto py-8">
    <div class="modal-card p-6 w-full max-w-3xl my-8">
      <h3 class="text-xl font-bold mb-4">{{ editingItem ? 'Editar' : 'Novo' }} Template</h3>
      <form @submit.prevent="saveTemplate" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">Nome *</label>
            <input v-model="form.name" type="text" required class="form-control w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Linha *</label>
            <select v-model="form.lineId" required class="form-control w-full">
              <option value="">Selecione</option>
              <option v-for="line in lines" :key="line.id" :value="line.id">
                {{ line.phone }} {{ line.oficial ? '(Oficial)' : '' }}
              </option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">Idioma</label>
            <input v-model="form.language" type="text" class="form-control w-full" placeholder="pt_BR" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Categoria</label>
            <select v-model="form.category" class="form-control w-full">
              <option value="MARKETING">MARKETING</option>
              <option value="UTILITY">UTILITY</option>
              <option value="AUTHENTICATION">AUTHENTICATION</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Namespace</label>
          <input v-model="form.namespace" type="text" class="form-control w-full" />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">Tipo de Header</label>
            <select v-model="form.headerType" class="form-control w-full">
              <option value="">Nenhum</option>
              <option value="TEXT">TEXT</option>
              <option value="IMAGE">IMAGE</option>
              <option value="VIDEO">VIDEO</option>
              <option value="DOCUMENT">DOCUMENT</option>
            </select>
          </div>
          <div v-if="form.headerType">
            <label class="block text-sm font-medium mb-2">Conteúdo do Header</label>
            <input v-model="form.headerContent" type="text" class="form-control w-full" />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Corpo do Template *</label>
          <textarea
            v-model="form.bodyText"
            rows="5"
            required
            class="form-control w-full"
            placeholder="Use {{1}}, {{2}}, etc. para variáveis"
          ></textarea>
          <p class="text-xs text-gray-500 mt-1">Use {{1}}, {{2}} para variáveis dinâmicas</p>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Rodapé</label>
          <input v-model="form.footerText" type="text" class="form-control w-full" />
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Variáveis (separadas por vírgula)</label>
          <input
            v-model="variablesInput"
            type="text"
            class="form-control w-full"
            placeholder="nome, codigo, telefone"
          />
          <p class="text-xs text-gray-500 mt-1">Variáveis que serão usadas no template</p>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Status</label>
          <select v-model="form.status" class="form-control w-full">
            <option value="PENDING">PENDING</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </div>

        <div class="flex space-x-3">
          <button type="button" @click="showModal = false" class="flex-1 btn-secondary">Cancelar</button>
          <button type="submit" class="flex-1 btn-primary text-center">Salvar</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import Layout from '../components/layout/Layout.vue'
import api from '../services/api'

const templates = ref([])
const lines = ref([])
const search = ref('')
const showModal = ref(false)
const editingItem = ref(null)
const variablesInput = ref('')

const filters = ref({
  lineId: null,
  status: '',
})

const form = ref({
  name: '',
  language: 'pt_BR',
  category: 'MARKETING',
  lineId: null,
  namespace: '',
  headerType: '',
  headerContent: '',
  bodyText: '',
  footerText: '',
  status: 'PENDING',
  variables: [],
})

onMounted(async () => {
  await loadTemplates()
  await loadLines()
})

watch([search, filters], () => loadTemplates(), { deep: true })

const loadTemplates = async () => {
  const params = { search: search.value }
  if (filters.value.lineId) params.lineId = filters.value.lineId
  if (filters.value.status) params.status = filters.value.status

  const response = await api.get('/templates', { params })
  templates.value = response.data
}

const loadLines = async () => {
  const response = await api.get('/lines')
  lines.value = response.data
}

const getLineName = (lineId) => {
  const line = lines.value.find(l => l.id === lineId)
  return line ? line.phone : 'N/A'
}

const openModal = (item = null) => {
  editingItem.value = item
  if (item) {
    form.value = {
      ...item,
      variables: item.variables || [],
    }
    variablesInput.value = Array.isArray(item.variables) ? item.variables.join(', ') : ''
  } else {
    form.value = {
      name: '',
      language: 'pt_BR',
      category: 'MARKETING',
      lineId: null,
      namespace: '',
      headerType: '',
      headerContent: '',
      bodyText: '',
      footerText: '',
      status: 'PENDING',
      variables: [],
    }
    variablesInput.value = ''
  }
  showModal.value = true
}

const saveTemplate = async () => {
  try {
    // Converter variáveis de string para array
    const variables = variablesInput.value
      .split(',')
      .map(v => v.trim())
      .filter(v => v)

    const dataToSend = {
      ...form.value,
      variables: variables.length > 0 ? variables : undefined,
      lineId: parseInt(form.value.lineId),
    }

    if (editingItem.value) {
      await api.patch(`/templates/${editingItem.value.id}`, dataToSend)
    } else {
      await api.post('/templates', dataToSend)
    }
    showModal.value = false
    loadTemplates()
  } catch (error) {
    alert('Erro ao salvar template: ' + (error.response?.data?.message || error.message))
  }
}

const deleteTemplate = async (item) => {
  if (confirm('Deseja realmente excluir este template?')) {
    try {
      await api.delete(`/templates/${item.id}`)
      loadTemplates()
    } catch (error) {
      alert('Erro ao excluir template: ' + (error.response?.data?.message || error.message))
    }
  }
}
</script>

