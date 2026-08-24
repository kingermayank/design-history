export default {
  devServer: 'http://localhost:3000',
  routes: [
    { path: '/', label: 'Home' },
    { path: '/about', label: 'About' },
  ],
  viewports: [
    { name: 'mobile',  width: 390,  height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],
  waitFor: 'networkidle',
  installCommand: 'true',
  startCommand: 'node server.mjs',
  serverReadyTimeoutMs: 15000,
};
