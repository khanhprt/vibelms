import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'CoursePilot',
    description: 'Trợ lý học trực tuyến có quyền kiểm soát từ người dùng.',
    icons: {
      16: 'icons/coursepilot-16-v2.png',
      32: 'icons/coursepilot-32-v2.png',
      48: 'icons/coursepilot-48-v2.png',
      128: 'icons/coursepilot-128-v2.png',
    },
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://*/*'],
    options_ui: { page: 'options.html', open_in_tab: true },
    action: {
      default_icon: {
        16: 'icons/coursepilot-16-v2.png',
        32: 'icons/coursepilot-32-v2.png',
        48: 'icons/coursepilot-48-v2.png',
        128: 'icons/coursepilot-128-v2.png',
      },
    },
  },
  imports: false,
});

