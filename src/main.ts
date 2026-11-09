import { createApp } from 'vue';
import App from './App.vue';

const param = new URLSearchParams(window.location.search).get('demo');
createApp(App, { demo: param === '1' || param === 'noat', demoNoAt: param === 'noat' }).mount('#app');
