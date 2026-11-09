import { createApp } from 'vue';
import App from './App.vue';

const demo = new URLSearchParams(window.location.search).get('demo') === '1';
createApp(App, { demo }).mount('#app');
