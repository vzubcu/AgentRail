import { initDashboardApp } from './dashboard-app.js';

export async function bootstrapApp() {
  try {
    await initDashboardApp();
  } catch (error) {
    const resultContent = document.getElementById('result-content');
    if (resultContent) {
      resultContent.textContent = error.message;
    } else {
      console.error(error);
    }
    throw error;
  }
}
