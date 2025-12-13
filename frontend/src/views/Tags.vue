<template>
  <CrudTable
    title="Tags"
    subtitle="Gerencie as tags do sistema"
    :columns="columns"
    :items="tags"
    v-model:search="search"
    @new="openModal()"
    @edit="openModal"
    @delete="deleteTag"
  >
    <template #cell-segment="{ item }">
      <span v-if="item.segment" class="text-sm">
        {{ getSegmentName(item.segment) }}
      </span>
      <span v-else class="text-gray-400 text-sm italic">Nenhum</span>
    </template>
  </CrudTable>

  <div v-if="showModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
    <div class="modal-card p-6 w-full max-w-md">
      <h3 class="text-xl font-bold mb-4">{{ editingItem ? 'Editar' : 'Nova' }} Tag</h3>
      <form @submit.prevent="saveTag" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2">Nome</label>
          <input v-model="form.name" type="text" required class="form-control w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Descrição</label>
          <textarea v-model="form.description" rows="3" class="form-control w-full"></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Segmento</label>
          <select v-model="form.segment" class="form-control w-full">
            <option :value="null">Nenhum</option>
            <option v-for="seg in segments" :key="seg.id" :value="seg.id">
              {{ seg.name }}
            </option>
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
import { ref, onMounted, watch } from 'vue'
import CrudTable from '../components/common/CrudTable.vue'
import api from '../services/api'

const tags = ref([])
const segments = ref([])
const search = ref('')
const showModal = ref(false)
const editingItem = ref(null)
const form = ref({ name: '', description: '', segment: null })

const columns = [
  { key: 'name', label: 'Nome' },
  { key: 'description', label: 'Descrição' },
  { key: 'segment', label: 'Segmento' },
]

onMounted(async () => {
  await loadTags()
  await loadSegments()
})

watch(search, () => loadTags())

const loadTags = async () => {
  const response = await api.get('/tags', { params: { search: search.value } })
  tags.value = response.data
}

const loadSegments = async () => {
  const response = await api.get('/segments')
  segments.value = response.data
}

const getSegmentName = (segmentId) => {
  const segment = segments.value.find(s => s.id === segmentId)
  return segment ? segment.name : 'N/A'
}

const openModal = (item = null) => {
  editingItem.value = item
  form.value = item ? { ...item } : { name: '', description: '', segment: null }
  showModal.value = true
}

const saveTag = async () => {
  try {
    const dataToSend = {
      ...form.value,
      segment: form.value.segment || null,
    }
    
    if (editingItem.value) {
      await api.patch(`/tags/${editingItem.value.id}`, dataToSend)
    } else {
      await api.post('/tags', dataToSend)
    }
    showModal.value = false
    loadTags()
  } catch (error) {
    alert('Erro ao salvar tag: ' + (error.response?.data?.message || error.message))
  }
}

const deleteTag = async (item) => {
  if (confirm('Deseja realmente excluir esta tag?')) {
    try {
      await api.delete(`/tags/${item.id}`)
      loadTags()
    } catch (error) {
      alert('Erro ao excluir tag: ' + (error.response?.data?.message || error.message))
    }
  }
}
</script>

