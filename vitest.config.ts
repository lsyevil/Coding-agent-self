import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑 server 侧测试；前端组件测试需要 jsdom，另开配置
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // 测试里显式给定密钥，避免走 auth.ts 的开发回落逻辑而写出 data/.jwt-secret
    env: {
      JWT_SECRET: 'test-secret-not-used-in-production-0123456789',
      NODE_ENV: 'test',
    },
  },
});
