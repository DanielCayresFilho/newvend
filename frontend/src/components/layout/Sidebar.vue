<template>
  <aside class="sidebar-transition w-72 bg-backgroundDark text-white flex flex-col flex-shrink-0 h-screen">
    <!-- Logo e nome da empresa -->
    <div class="p-6 border-b border-gray-800">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
          <span class="font-bold text-lg">V</span>
        </div>
        <div>
          <h1 class="text-xl font-bold">vend</h1>
          <p class="text-xs text-gray-400">SaaS de Atendimento</p>
        </div>
      </div>
    </div>

    <!-- Menu de navegação por role -->
    <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
      <!-- Operador -->
      <div v-if="authStore.isOperator" class="mb-8">
        <h3 class="text-xs uppercase text-gray-500 font-semibold tracking-wider mb-3">Operador</h3>
        <ul class="space-y-1">
          <li>
            <router-link
              to="/atendimento"
              :class="['nav-link', isActive('/atendimento') && 'nav-link-active']"
            >
              <i class="fas fa-headset text-secondary w-5"></i>
              <span>Atendimento</span>
            </router-link>
          </li>
        </ul>
      </div>

      <!-- Supervisor -->
      <div v-if="authStore.isSupervisor" class="mb-8">
        <h3 class="text-xs uppercase text-gray-500 font-semibold tracking-wider mb-3">Supervisor</h3>
        <ul class="space-y-1">
          <li>
            <router-link
              to="/supervisionar"
              :class="['nav-link', isActive('/supervisionar') && 'nav-link-active']"
            >
              <i class="fas fa-eye text-warning w-5"></i>
              <span>Supervisionar</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/contacts"
              :class="['nav-link', isActive('/contacts') && 'nav-link-active']"
            >
              <i class="fas fa-address-book text-secondary w-5"></i>
              <span>Contatos</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/campaigns"
              :class="['nav-link', isActive('/campaigns') && 'nav-link-active']"
            >
              <i class="fas fa-bullhorn text-primary w-5"></i>
              <span>Campanhas</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/tabulations"
              :class="['nav-link', isActive('/tabulations') && 'nav-link-active']"
            >
              <i class="fas fa-table text-whatsapp w-5"></i>
              <span>Tabulações</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/segments"
              :class="['nav-link', isActive('/segments') && 'nav-link-active']"
            >
              <i class="fas fa-filter text-error w-5"></i>
              <span>Segmentos</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/blocklist"
              :class="['nav-link', isActive('/blocklist') && 'nav-link-active']"
            >
              <i class="fas fa-ban text-gray-400 w-5"></i>
              <span>Blocklist</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/templates"
              :class="['nav-link', isActive('/templates') && 'nav-link-active']"
            >
              <i class="fas fa-file-alt text-primary w-5"></i>
              <span>Templates</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/reports"
              :class="['nav-link', isActive('/reports') && 'nav-link-active']"
            >
              <i class="fas fa-chart-bar text-success w-5"></i>
              <span>Relatórios</span>
            </router-link>
          </li>
        </ul>
      </div>

      <!-- Admin -->
      <div v-if="authStore.isAdmin" class="mb-8">
        <h3 class="text-xs uppercase text-gray-500 font-semibold tracking-wider mb-3">Admin</h3>
        <ul class="space-y-1">
          <li>
            <router-link
              to="/contacts"
              :class="['nav-link', isActive('/contacts') && 'nav-link-active']"
            >
              <i class="fas fa-address-book text-secondary w-5"></i>
              <span>Contatos</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/campaigns"
              :class="['nav-link', isActive('/campaigns') && 'nav-link-active']"
            >
              <i class="fas fa-bullhorn text-primary w-5"></i>
              <span>Campanhas</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/tabulations"
              :class="['nav-link', isActive('/tabulations') && 'nav-link-active']"
            >
              <i class="fas fa-table text-whatsapp w-5"></i>
              <span>Tabulações</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/segments"
              :class="['nav-link', isActive('/segments') && 'nav-link-active']"
            >
              <i class="fas fa-filter text-error w-5"></i>
              <span>Segmentos</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/blocklist"
              :class="['nav-link', isActive('/blocklist') && 'nav-link-active']"
            >
              <i class="fas fa-ban text-gray-400 w-5"></i>
              <span>Blocklist</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/evolution"
              :class="['nav-link', isActive('/evolution') && 'nav-link-active']"
            >
              <i class="fas fa-sync-alt text-primary w-5"></i>
              <span>Evolution</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/lines"
              :class="['nav-link', isActive('/lines') && 'nav-link-active']"
            >
              <i class="fas fa-phone-alt text-success w-5"></i>
              <span>Linhas</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/users"
              :class="['nav-link', isActive('/users') && 'nav-link-active']"
            >
              <i class="fas fa-users text-warning w-5"></i>
              <span>Usuários</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/tags"
              :class="['nav-link', isActive('/tags') && 'nav-link-active']"
            >
              <i class="fas fa-tags text-secondary w-5"></i>
              <span>Tags</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/templates"
              :class="['nav-link', isActive('/templates') && 'nav-link-active']"
            >
              <i class="fas fa-file-alt text-primary w-5"></i>
              <span>Templates</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/reports"
              :class="['nav-link', isActive('/reports') && 'nav-link-active']"
            >
              <i class="fas fa-chart-bar text-success w-5"></i>
              <span>Relatórios</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/api-logs"
              :class="['nav-link', isActive('/api-logs') && 'nav-link-active']"
            >
              <i class="fas fa-code text-error w-5"></i>
              <span>Logs API</span>
            </router-link>
          </li>
        </ul>
      </div>
    </div>

    <!-- Perfil do usuário e botão de logout -->
    <div class="p-4 border-t border-gray-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <span class="font-bold text-white">{{ userInitial }}</span>
          </div>
          <div>
            <p class="text-sm font-medium">{{ authStore.user?.name }}</p>
            <p class="text-xs text-gray-400">{{ roleLabel }}</p>
          </div>
        </div>
        <button
          @click="handleLogout"
          class="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-800 transition-colors duration-200"
        >
          <i class="fas fa-sign-out-alt text-gray-400"></i>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const userInitial = computed(() => {
  return authStore.user?.name?.charAt(0).toUpperCase() || 'U'
})

const roleLabel = computed(() => {
  const roles = {
    admin: 'Admin',
    supervisor: 'Supervisor',
    operator: 'Operador',
  }
  return roles[authStore.user?.role] || 'Usuário'
})

const isActive = (path) => route.path.startsWith(path)

const handleLogout = async () => {
  if (confirm('Tem certeza que deseja sair?')) {
    await authStore.logout()
    router.push('/login')
  }
}
</script>
