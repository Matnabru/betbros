import { autoResolveBets } from './scheduler/autoresolve';

// Manual test runner for the auto-resolve function
(async () => {
  console.log('Testing auto-resolve function...');
  try {
    await autoResolveBets(); // No client for testing
    console.log('Auto-resolve test completed successfully');
  } catch (err) {
    console.error('Auto-resolve test failed:', err);
  }
  process.exit(0);
})();