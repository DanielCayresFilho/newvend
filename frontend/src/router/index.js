import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/atendimento',
    name: 'Atendimento',
    component: () => import('../views/Atendimento.vue'),
    meta: { requiresAuth: true, roles: ['operator'] },
  },
  {
    path: '/supervisionar',
    name: 'Supervisionar',
    component: () => import('../views/Supervisionar.vue'),
    meta: { requiresAuth: true, roles: ['supervisor'] },
  },
  {
    path: '/users',
    name: 'Users',
    component: () => import('../views/Users.vue'),
    meta: { requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/segments',
    name: 'Segments',
    component: () => import('../views/Segments.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/tabulations',
    name: 'Tabulations',
    component: () => import('../views/Tabulations.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/contacts',
    name: 'Contacts',
    component: () => import('../views/Contacts.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/campaigns',
    name: 'Campaigns',
    component: () => import('../views/Campaigns.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/blocklist',
    name: 'Blocklist',
    component: () => import('../views/Blocklist.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/evolution',
    name: 'Evolution',
    component: () => import('../views/Evolution.vue'),
    meta: { requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/lines',
    name: 'Lines',
    component: () => import('../views/Lines.vue'),
    meta: { requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/tags',
    name: 'Tags',
    component: () => import('../views/Tags.vue'),
    meta: { requiresAuth: true, roles: ['admin'] },
  },
  {
    path: '/templates',
    name: 'Templates',
    component: () => import('../views/Templates.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('../views/Reports.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'supervisor'] },
  },
  {
    path: '/api-logs',
    name: 'ApiLogs',
    component: () => import('../views/ApiLogs.vue'),
    meta: { requiresAuth: true, roles: ['admin'] },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const roles = to.meta.roles

  if (requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/')
  } else if (roles && !roles.includes(authStore.user?.role)) {
    next('/')
  } else {
    next()
  }
})

export default router
