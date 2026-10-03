import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'CoursePilot',
    description: 'Trợ lý học trực tuyến có quyền kiểm soát từ người dùng.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://*/*'],
    options_ui: { page: 'options.html', open_in_tab: true },
  },
  imports: false,
});

