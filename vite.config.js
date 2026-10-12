import { PRIVATE_DEV_FILES } from './server/RequestSecurity.js';
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier';
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
};
