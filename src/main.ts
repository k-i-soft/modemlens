import { createApp } from 'vue';
import App from './App.vue';

const param = new URLSearchParams(window.location.search).get('demo');
createApp(App, { demo: param === '1' || param === 'noat' || param === 'web', demoNoAt: param === 'noat', demoWeb: param === 'web' }).mount('#app');
