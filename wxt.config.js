import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Vernal',
    description: 'Trợ lý học trực tuyến có quyền kiểm soát từ người dùng.',
    icons: {
      16: 'icons/vernal-16-v2.png',
      32: 'icons/vernal-32-v2.png',
      48: 'icons/vernal-48-v2.png',
      128: 'icons/vernal-128-v2.png',
    },
    permissions: ['storage', 'activeTab', 'downloads', 'scripting'],
    host_permissions: ['https://*/*'],
    options_ui: { page: 'options.html', open_in_tab: true },
    action: {
      default_icon: {
        16: 'icons/vernal-16-v2.png',
        32: 'icons/vernal-32-v2.png',
        48: 'icons/vernal-48-v2.png',
        128: 'icons/vernal-128-v2.png',
      },
    },
  },
  imports: false,
});

