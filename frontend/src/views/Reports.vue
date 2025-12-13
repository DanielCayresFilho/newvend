<template>
  <Layout>
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="section-header px-6 py-4 mb-4 shadow-sm">
        <div>
          <h2 class="text-2xl font-bold">Relatórios</h2>
          <p class="text-textSecondary">Visualize relatórios e estatísticas do sistema</p>
        </div>
      </div>

      <!-- Filtros -->
      <div class="glass-panel px-6 py-4 border-b border-borderColor/60 rounded-2xl shadow-sm mb-4">
        <div class="grid grid-cols-4 gap-4">
          <div>
            <label class="block text-sm font-medium mb-2">Data Inicial</label>
            <input v-model="filters.startDate" type="date" class="form-control w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Data Final</label>
            <input v-model="filters.endDate" type="date" class="form-control w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Segmento</label>
            <select v-model="filters.segment" class="form-control w-full">
              <option :value="null">Todos</option>
              <option v-for="seg in segments" :key="seg.id" :value="seg.id">
                {{ seg.name }}
              </option>
            </select>
          </div>
          <div class="flex items-end">
            <button @click="loadReport" class="btn-primary w-full py-3">
              <i class="fas fa-search mr-2"></i>
              Gerar Relatório
            </button>
          </div>
        </div>
      </div>

      <!-- Seleção de Relatório -->
      <div class="glass-panel px-6 py-4 border-b border-borderColor/60 rounded-2xl shadow-sm mb-4">
        <label class="block text-sm font-medium mb-2">Selecione o Relatório</label>
        <select v-model="selectedReport" class="form-control w-full">
          <option value="">Selecione um relatório</option>
          <option value="op-sintetico">OP Sintético</option>
          <option value="kpi">KPI</option>
          <option value="hsm">HSM (Disparos)</option>
          <option value="line-status">Status de Linha</option>
          <option value="envios">Envios</option>
          <option value="indicadores">Indicadores</option>
          <option value="tempos">Tempos</option>
          <option value="templates">Templates</option>
          <option value="completo-csv">Completo CSV</option>
          <option value="equipe">Equipe</option>
          <option value="dados-transacionados">Dados Transacionados</option>
          <option value="detalhado-conversas">Detalhado Conversas</option>
          <option value="linhas">Linhas</option>
          <option value="resumo-atendimentos">Resumo Atendimentos</option>
          <option value="hiper-personalizado">Hiper Personalizado</option>
          <option value="consolidado">Consolidado (Todos)</option>
        </select>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <i class="fas fa-spinner fa-spin text-4xl text-primary mb-4"></i>
          <p class="text-textSecondary">Gerando relatório...</p>
        </div>
      </div>

      <!-- Resultado -->
      <div v-else-if="reportData" class="flex-1 overflow-auto p-6">
        <div class="glass-panel rounded-2xl shadow-lg p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold">Relatório: {{ getReportName(selectedReport) }}</h3>
            <button @click="exportToCSV" class="btn-secondary px-4 py-2">
              <i class="fas fa-download mr-2"></i>
              Exportar CSV
            </button>
          </div>

          <div v-if="selectedReport === 'consolidado'" class="space-y-6">
            <div v-for="(report, key) in reportData.relatorios" :key="key" class="border-b border-borderColor/60 pb-4">
              <h4 class="font-semibold mb-2">{{ getReportName(key) }}</h4>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="bg-gray-50">
                      <th
                        v-for="(value, headerKey) in report[0] || {}"
                        :key="headerKey"
                        class="px-3 py-2 text-left border"
                      >
                        {{ headerKey }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, index) in report.slice(0, 10)" :key="index">
                      <td
                        v-for="(value, key) in row"
                        :key="key"
                        class="px-3 py-2 border"
                      >
                        {{ value }}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="report.length > 10" class="text-sm text-textSecondary mt-2">
                  Mostrando 10 de {{ report.length }} registros
                </p>
              </div>
            </div>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="bg-gray-50">
                  <th
                    v-for="(value, key) in reportData[0] || {}"
                    :key="key"
                    class="px-4 py-2 text-left border border-borderColor/60 font-medium"
                  >
                    {{ key }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in reportData" :key="index" class="hover:bg-gray-50">
                  <td
                    v-for="(value, key) in row"
                    :key="key"
                    class="px-4 py-2 border border-borderColor/60"
                  >
                    {{ value }}
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="reportData.length === 0" class="text-center py-8 text-textSecondary">
              <i class="fas fa-inbox text-4xl mb-2 opacity-30"></i>
              <p>Nenhum dado encontrado para o período selecionado</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Mensagem inicial -->
      <div v-else class="flex-1 flex items-center justify-center">
        <div class="text-center text-textSecondary">
          <i class="fas fa-chart-bar text-6xl mb-4 opacity-30"></i>
          <p class="text-lg">Selecione um relatório e clique em "Gerar Relatório"</p>
        </div>
      </div>
    </div>
  </Layout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Layout from '../components/layout/Layout.vue'
import api from '../services/api'

const segments = ref([])
const selectedReport = ref('')
const filters = ref({
  startDate: '',
  endDate: '',
  segment: null,
})
const reportData = ref(null)
const loading = ref(false)

const reportNames = {
  'op-sintetico': 'OP Sintético',
  'kpi': 'KPI',
  'hsm': 'HSM (Disparos)',
  'line-status': 'Status de Linha',
  'envios': 'Envios',
  'indicadores': 'Indicadores',
  'tempos': 'Tempos',
  'templates': 'Templates',
  'completo-csv': 'Completo CSV',
  'equipe': 'Equipe',
  'dados-transacionados': 'Dados Transacionados',
  'detalhado-conversas': 'Detalhado Conversas',
  'linhas': 'Linhas',
  'resumo-atendimentos': 'Resumo Atendimentos',
  'hiper-personalizado': 'Hiper Personalizado',
  'consolidado': 'Consolidado',
}

onMounted(async () => {
  const response = await api.get('/segments')
  segments.value = response.data
})

const getReportName = (key) => {
  return reportNames[key] || key
}

const loadReport = async () => {
  if (!selectedReport.value) {
    alert('Selecione um relatório')
    return
  }

  loading.value = true
  reportData.value = null

  try {
    const params = {}
    if (filters.value.startDate) params.startDate = filters.value.startDate
    if (filters.value.endDate) params.endDate = filters.value.endDate
    if (filters.value.segment) params.segment = filters.value.segment

    const endpoint = selectedReport.value === 'consolidado' 
      ? '/reports/consolidado'
      : `/reports/${selectedReport.value}`

    const response = await api.get(endpoint, { params })
    reportData.value = selectedReport.value === 'consolidado' ? response.data : response.data
  } catch (error) {
    alert('Erro ao gerar relatório: ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

const exportToCSV = () => {
  if (!reportData.value || !selectedReport.value) return

  let csv = ''
  let data = reportData.value

  if (selectedReport.value === 'consolidado') {
    // Para consolidado, exportar cada relatório separadamente
    Object.entries(data.relatorios || {}).forEach(([key, report]) => {
      if (Array.isArray(report) && report.length > 0) {
        csv += `\n=== ${getReportName(key)} ===\n`
        const headers = Object.keys(report[0])
        csv += headers.join(',') + '\n'
        report.forEach(row => {
          csv += headers.map(h => `"${row[h] || ''}"`).join(',') + '\n'
        })
      }
    })
  } else {
    // Para relatórios individuais
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0])
      csv = headers.join(',') + '\n'
      data.forEach(row => {
        csv += headers.map(h => `"${row[h] || ''}"`).join(',') + '\n'
      })
    }
  }

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${selectedReport.value}_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  window.URL.revokeObjectURL(url)
}
</script>

