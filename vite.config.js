import { defineConfig } from 'vite';

export default defineConfig({
  base: '/PDFForge/',
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdfjs-dist')) return 'pdf-reader';
          if (id.includes('node_modules/pdf-lib')) return 'pdf-editor';
          if (id.includes('node_modules/jszip')) return 'zip';
        }
      }
    }
  }
});
