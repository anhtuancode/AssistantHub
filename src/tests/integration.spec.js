const assert = require('assert');
const app = require('../server');

async function testServerIntegration() {
  console.log('--- TEST INTEGRATION: EXPRESS SERVER & AUTOMATION ROUTES ---');
  const server = app.listen(3002, async () => {
    try {
      // 1. Healthcheck
      const healthRes = await fetch('http://localhost:3002/api/health');
      const health = await healthRes.json();
      assert.strictEqual(health.status, 'OK', 'Server healthcheck should be OK');
      console.log('✓ Healthcheck endpoint: OK');

      // 2. Automation Status
      const statusRes = await fetch('http://localhost:3002/api/automation/status');
      const status = await statusRes.json();
      assert.strictEqual(status.success, true, 'Status endpoint should be success');
      assert.strictEqual(status.state, 'IDLE', 'State should be IDLE');
      console.log('✓ Status endpoint: OK (State IDLE)');

      // 3. Logs endpoint
      const logsRes = await fetch('http://localhost:3002/api/automation/logs');
      const logs = await logsRes.json();
      assert.strictEqual(logs.success, true, 'Logs endpoint should return success');
      assert(Array.isArray(logs.logs), 'Logs should be array');
      console.log(`✓ Logs endpoint: OK (${logs.logs.length} log entries retrieved)`);

      console.log('\n--- ALL SERVER INTEGRATION TESTS PASSED ✅ ---');
    } catch (err) {
      console.error('Integration test failed:', err);
      process.exit(1);
    } finally {
      server.close();
    }
  });
}

testServerIntegration();
